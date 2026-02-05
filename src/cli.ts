#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomBytes } from "crypto";

// Utils imports

import {
  generateDocumentKey,
  encryptFile,
  decryptFile,
  computeContentHash,
  packEncryptedData,
  unpackEncryptedData,
} from "./utils/encryption.js";
import {
  generateKeyPair,
  saveKeyPair,
  loadKeyPair,
  getPublicKeyHex,
  parsePublicKeyHex,
  wrapDocumentKey,
  unwrapDocumentKey,
  serializeWrappedKey,
  deserializeWrappedKey,
} from "./utils/keys.js";
import { uploadToStorage, downloadFromStorage } from "./storage.js";
import { createDocumentManager } from "./api/contract.js";
import { computeOwnerCommitment } from "./api/witnesses.js";
import { EnvironmentManager } from "./utils/environment.js";

// Constants & Utilities

const DEFAULT_KEYPAIR_PATH = ".midnight-doc-keys.json";

function getFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
    ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findMetadataFile(documentIdHex: string): string | null {
  const shortId = documentIdHex.slice(0, 16);
  const metaPath = `${shortId}.doc.json`;
  return fs.existsSync(metaPath) ? metaPath : null;
}

// Main Program

const program = new Command();
program
  .name("midnight-doc")
  .description(chalk.cyan("🌙 Midnight Document Manager\n\n") +
    "  Privacy-preserving document management on the Midnight blockchain.")
  .version("1.0.0");

// Keys

const keys = program.command("keys").description("Manage keypairs");

keys.command("generate")
  .description("Generate a new X25519 keypair")
  .option("-o, --output <path>", "Output file", DEFAULT_KEYPAIR_PATH)
  .option("-f, --force", "Overwrite existing", false)
  .action(async (options) => {
    try {
      const outputPath = path.resolve(options.output);
      if (fs.existsSync(outputPath) && !options.force) {
        console.log(chalk.yellow("⚠️ Keypair exists. Use --force to overwrite"));
        return;
      }
      const keypair = generateKeyPair();
      saveKeyPair(keypair, outputPath);
      const publicKeyHex = getPublicKeyHex(keypair);
      const commitment = computeOwnerCommitment(keypair.secretKey);
      console.log(chalk.green("\n✅ Keypair generated!\n"));
      console.log(chalk.cyan("Public Key:"), publicKeyHex);
      console.log(chalk.cyan("Commitment:"), Buffer.from(commitment).toString("hex"));
      console.log(chalk.gray("\nSaved to:"), outputPath, "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

keys.command("show")
  .description("Display keypair info")
  .option("-i, --input <path>", "Keypair file", DEFAULT_KEYPAIR_PATH)
  .action(async (options) => {
    try {
      const inputPath = path.resolve(options.input);
      if (!fs.existsSync(inputPath)) {
        console.log(chalk.red("❌ Not found:"), inputPath);
        return;
      }
      const keypair = loadKeyPair(inputPath);
      console.log(chalk.cyan("\n🔑 Public Key:"), getPublicKeyHex(keypair));
      console.log(chalk.cyan("🔒 Commitment:"), Buffer.from(computeOwnerCommitment(keypair.secretKey)).toString("hex"), "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

keys.command("address")
  .description("Show your wallet address (requires network connection)")
  .action(async () => {
    try {
      console.log(chalk.blue("\n🔍 Getting wallet address...\n"));
      const contract = createDocumentManager();
      const address = await contract.connect();
      console.log(chalk.cyan("Your wallet address:"));
      console.log(address);
      console.log("");
      await contract.close();
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// Deploy

program.command("deploy")
  .description("Deploy the contract")
  .action(async () => {
    console.log(chalk.blue.bold("\n🚀 Contract Deployment\n"));
    console.log(chalk.yellow("Use the deploy script with your mnemonic:"));
    console.log(chalk.cyan('\n  npm run deploy "your twelve or twenty four word mnemonic"\n'));
    console.log(chalk.gray("This ensures proper wallet initialization and transaction signing."));
    console.log(chalk.gray("After deployment, the contract address is saved to deployment.json\n"));
  });

// Upload

program.command("upload")
  .description("Upload a document")
  .argument("<file>", "File path")
  .argument("<seed>", "Wallet mnemonic phrase")
  .option("-k, --keypair <path>", "Keypair file", DEFAULT_KEYPAIR_PATH)
  .option("--dry-run", "Simulate only", false)
  .action(async (filePath: string, seed: string, options) => {
    try {
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) { console.error(chalk.red("❌ File not found")); process.exit(1); }
      const keypair = loadKeyPair(path.resolve(options.keypair));

      console.log(chalk.blue.bold("\n📄 Uploading Document...\n"));
      const fileData = fs.readFileSync(absPath);
      const fileName = path.basename(absPath);
      console.log(chalk.gray("File:"), fileName, `(${formatBytes(fileData.length)})`);

      const contentHash = computeContentHash(fileData);
      const documentKey = generateDocumentKey();
      const encrypted = encryptFile(fileData, documentKey);
      const packed = packEncryptedData(encrypted);
      console.log(chalk.gray("Encrypted:"), formatBytes(packed.length));

      EnvironmentManager.validateStorageConfig();
      const upload = await uploadToStorage(packed, { name: fileName, contentType: "application/octet-stream" });
      console.log(chalk.gray("Storage:"), upload.storageId);

      const documentId = createHash("sha256").update(contentHash).update(randomBytes(16)).digest();
      const ownerCommitment = computeOwnerCommitment(keypair.secretKey);
      const wrappedKey = wrapDocumentKey(documentKey, keypair.publicKey, keypair);

      if (!options.dryRun) {
        const contract = createDocumentManager(seed);
        await contract.connect();
        await contract.waitForSync();
        const info = contract.loadDeploymentInfo();
        if (!info) { console.error(chalk.red("❌ Deploy first")); await contract.close(); process.exit(1); }
        await contract.connectToDeployed(info.contractAddress);
        await contract.registerDocument(new Uint8Array(documentId), new Uint8Array(contentHash), upload.storageId, new Uint8Array(ownerCommitment), getFileType(absPath));
        await contract.close();
      }

      const meta = { documentId: documentId.toString("hex"), fileName, contentHash: contentHash.toString("hex"), storageCid: upload.storageId, gatewayUrl: upload.gatewayUrl, wrappedKey: serializeWrappedKey(wrappedKey), uploadedAt: new Date().toISOString() };
      const metaPath = `${documentId.toString("hex").slice(0, 16)}.doc.json`;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      console.log(chalk.green.bold("\n✅ Uploaded!\n"));
      console.log(chalk.cyan("Document ID:"), documentId.toString("hex"));
      console.log(chalk.cyan("Metadata:"), metaPath, "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// Verify

program.command("verify")
  .description("Verify a document")
  .argument("<file>", "File to verify")
  .argument("<doc-id>", "Document ID (hex)")
  .argument("<seed>", "Wallet mnemonic phrase")
  .action(async (filePath: string, docId: string, seed: string) => {
    try {
      const fileData = fs.readFileSync(path.resolve(filePath));
      const hash = computeContentHash(fileData);
      const contract = createDocumentManager(seed);
      await contract.connect();
      await contract.waitForSync();
      const info = contract.loadDeploymentInfo();
      if (!info) { console.error(chalk.red("❌ Not deployed")); await contract.close(); process.exit(1); }
      await contract.connectToDeployed(info.contractAddress);
      const valid = await contract.verifyDocument(new Uint8Array(Buffer.from(docId, "hex")), new Uint8Array(hash));
      await contract.close();
      console.log(valid ? chalk.green("\n✅ VERIFIED\n") : chalk.red("\n❌ FAILED\n"));
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// Download  

program.command("download")
  .description("Download and decrypt a document")
  .argument("<doc-id>", "Document ID (hex)")
  .argument("<seed>", "Wallet mnemonic phrase")
  .option("-k, --keypair <path>", "Keypair file", DEFAULT_KEYPAIR_PATH)
  .option("-o, --output <path>", "Output file")
  .action(async (docId: string, seed: string, options) => {
    try {
      const metaPath = findMetadataFile(docId);
      if (!metaPath) { console.error(chalk.red("❌ Metadata not found")); process.exit(1); }
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const keypair = loadKeyPair(path.resolve(options.keypair));

      const encrypted = await downloadFromStorage(meta.storageCid);
      const unpacked = unpackEncryptedData(encrypted);
      const docKey = unwrapDocumentKey(deserializeWrappedKey(meta.wrappedKey), keypair.secretKey);
      if (!docKey) { console.error(chalk.red("❌ Wrong keypair")); process.exit(1); }

      const decrypted = decryptFile(unpacked, docKey);
      if (!decrypted) { console.error(chalk.red("❌ Decryption failed")); process.exit(1); }

      const outPath = options.output || meta.fileName;
      fs.writeFileSync(outPath, decrypted);
      console.log(chalk.green("\n✅ Downloaded:"), outPath, "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// Share

const share = program.command("share").description("Share access");

share.command("grant")
  .description("Grant access")
  .argument("<doc-id>", "Document ID")
  .argument("<pubkey>", "Recipient public key (hex)")
  .argument("<seed>", "Wallet mnemonic phrase")
  .option("-k, --keypair <path>", "Your keypair", DEFAULT_KEYPAIR_PATH)
  .action(async (docId: string, pubkey: string, seed: string, options) => {
    try {
      const metaPath = findMetadataFile(docId);
      if (!metaPath) { console.error(chalk.red("❌ Metadata not found")); process.exit(1); }
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const ownerKp = loadKeyPair(path.resolve(options.keypair));

      const docKey = unwrapDocumentKey(deserializeWrappedKey(meta.wrappedKey), ownerKp.secretKey);
      if (!docKey) { console.error(chalk.red("❌ Not owner")); process.exit(1); }

      const recipientPk = parsePublicKeyHex(pubkey);
      const wrapped = wrapDocumentKey(docKey, recipientPk, ownerKp);
      const commitment = computeOwnerCommitment(recipientPk);

      const contract = createDocumentManager(seed);
      await contract.connect();
      await contract.waitForSync();
      const info = contract.loadDeploymentInfo();
      if (!info) { await contract.close(); process.exit(1); }
      await contract.connectToDeployed(info.contractAddress);
      const ser = serializeWrappedKey(wrapped);
      await contract.grantAccess(new Uint8Array(Buffer.from(docId, "hex")), new Uint8Array(commitment), ser.encryptedKey, ser.nonce, ser.senderPublicKey);
      await contract.close();
      console.log(chalk.green("\n✅ Access granted!\n"));
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

share.command("revoke")
  .description("Revoke access")
  .argument("<doc-id>", "Document ID")
  .argument("<pubkey>", "Recipient public key (hex)")
  .argument("<seed>", "Wallet mnemonic phrase")
  .action(async (docId: string, pubkey: string, seed: string) => {
    try {
      const commitment = computeOwnerCommitment(parsePublicKeyHex(pubkey));
      const contract = createDocumentManager(seed);
      await contract.connect();
      await contract.waitForSync();
      const info = contract.loadDeploymentInfo();
      if (!info) { await contract.close(); process.exit(1); }
      await contract.connectToDeployed(info.contractAddress);
      await contract.revokeAccess(new Uint8Array(Buffer.from(docId, "hex")), new Uint8Array(commitment));
      await contract.close();
      console.log(chalk.yellow("\n✅ Access revoked!\n"));
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// List

program.command("list")
  .description("List local documents")
  .action(() => {
    const files = fs.readdirSync(".").filter(f => f.endsWith(".doc.json"));
    if (files.length === 0) { console.log(chalk.gray("\nNo documents. Use 'upload' first.\n")); return; }
    console.log(chalk.blue.bold("\n📋 Documents\n"));
    for (const f of files) {
      try {
        const m = JSON.parse(fs.readFileSync(f, "utf-8"));
        console.log(chalk.cyan(m.fileName), chalk.gray(`- ${m.documentId.slice(0, 24)}...`));
      } catch { /* skip */ }
    }
    console.log();
  });

program.parse();
