#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import { createHash, randomBytes } from "crypto";

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
import { createDocumentManager, DocumentManagerContract } from "./api/contract.js";
import { computeOwnerCommitment } from "./api/witnesses.js";

const DEFAULT_KEYPAIR_PATH = ".midnight-doc-keys.json";

function getFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
    ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".gif": "image/gif", ".mp4": "video/mp4",
    ".zip": "application/zip",
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

function loadDeploymentInfo(): { contractAddress: string } | null {
  const deploymentPath = path.join(process.cwd(), "deployment.json");
  if (!fs.existsSync(deploymentPath)) return null;
  return JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
}

function resolveOutputPath(requested: string | undefined, originalFileName: string): {
  outPath: string;
  corrected: boolean;
} {
  const originalExt = path.extname(originalFileName);
  if (!requested) return { outPath: originalFileName, corrected: false };
  const requestedExt = path.extname(requested);
  const stem = requested.replace(/\.[^/.]+$/, "") || requested;
  const outPath = originalExt ? stem + originalExt : requested;
  const corrected = requestedExt !== "" && requestedExt.toLowerCase() !== originalExt.toLowerCase();
  return { outPath, corrected };
}

// ── Program ──────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name("midnight-doc")
  .description(chalk.cyan("🌙 Midnight Document Manager\n\n") +
    "  Privacy-preserving document management on the Midnight blockchain.")
  .version("1.0.0");

// ── Keys ─────────────────────────────────────────────────────────────────────

const keys = program.command("keys").description("Manage keypairs");

keys.command("generate")
  .description("Generate a new X25519 keypair")
  .option("-o, --output <path>", "Output file", DEFAULT_KEYPAIR_PATH)
  .option("-f, --force", "Overwrite existing", false)
  .action(async (options) => {
    try {
      const outputPath = path.resolve(options.output);
      if (fs.existsSync(outputPath) && !options.force) {
        console.log(chalk.yellow("⚠️  Keypair exists. Use --force to overwrite"));
        return;
      }
      const keypair = generateKeyPair();
      saveKeyPair(keypair, outputPath);
      console.log(chalk.green("\n✅ Keypair generated!\n"));
      console.log(chalk.cyan("Public Key:"), getPublicKeyHex(keypair));
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
      console.log(chalk.cyan("\n🔑 Public Key:"), getPublicKeyHex(keypair), "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// ── Deploy ────────────────────────────────────────────────────────────────────

program.command("deploy")
  .description("Deploy the contract")
  .action(async () => {
    console.log(chalk.blue.bold("\n🚀 Contract Deployment\n"));
    console.log(chalk.yellow("Use the deploy script with your mnemonic:"));
    console.log(chalk.cyan('\n  npm run deploy "your twelve or twenty four word mnemonic"\n'));
    console.log(chalk.gray("This ensures proper wallet initialization and transaction signing."));
    console.log(chalk.gray("After deployment, the contract address is saved to deployment.json\n"));
  });

// ── Upload ────────────────────────────────────────────────────────────────────

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

      const upload = await uploadToStorage(packed, { name: fileName, contentType: "application/octet-stream" });
      console.log(chalk.gray("Storage:"), upload.storageId);

      const documentId = createHash("sha256").update(contentHash).update(randomBytes(16)).digest();
      const wrappedKey = wrapDocumentKey(documentKey, keypair.publicKey, keypair);

      if (!options.dryRun) {
        const contract = createDocumentManager(seed);
        await contract.connect();
        await contract.waitForSync();
        const info = loadDeploymentInfo();
        if (!info) { console.error(chalk.red("❌ Deploy first")); await contract.close(); process.exit(1); }
        await contract.connectToDeployed(info.contractAddress);
        const ownerCommitment = contract.getOwnerCommitment();
        await contract.registerDocument(
          new Uint8Array(documentId),
          new Uint8Array(contentHash),
          upload.storageId,
          ownerCommitment,
          getFileType(absPath),
        );
        await contract.close();
      }

      const meta = {
        documentId: documentId.toString("hex"),
        fileName,
        contentHash: contentHash.toString("hex"),
        storageCid: upload.storageId,
        gatewayUrl: upload.gatewayUrl,
        wrappedKey: serializeWrappedKey(wrappedKey),
        uploadedAt: new Date().toISOString(),
      };
      const metaPath = `${documentId.toString("hex").slice(0, 16)}.doc.json`;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      console.log(chalk.green.bold("\n✅ Uploaded!\n"));
      console.log(chalk.cyan("Document ID:"), documentId.toString("hex"));
      console.log(chalk.cyan("Metadata:"), metaPath, "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// ── Verify ────────────────────────────────────────────────────────────────────

program.command("verify")
  .description("Verify a document against its on-chain hash")
  .argument("<file>", "Local file to verify")
  .argument("<doc-id>", "Document ID (hex)")
  .argument("<seed>", "Wallet mnemonic phrase")
  .action(async (filePath: string, docId: string, seed: string) => {
    try {
      const fileData = fs.readFileSync(path.resolve(filePath));
      const hash = computeContentHash(fileData);
      const contract = createDocumentManager(seed);
      await contract.connect();
      await contract.waitForSync();
      const info = loadDeploymentInfo();
      if (!info) { console.error(chalk.red("❌ Not deployed")); await contract.close(); process.exit(1); }
      await contract.connectToDeployed(info.contractAddress);
      const valid = await contract.verifyDocument(new Uint8Array(Buffer.from(docId, "hex")), new Uint8Array(hash));
      await contract.close();
      console.log(valid ? chalk.green("\n✅ VERIFIED\n") : chalk.red("\n❌ HASH MISMATCH — file has changed since upload\n"));
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// ── Download ──────────────────────────────────────────────────────────────────

program.command("download")
  .description("Download and decrypt a document")
  .argument("<doc-id>", "Document ID (hex)")
  .argument("<seed>", "Wallet mnemonic phrase")
  .option("-k, --keypair <path>", "Keypair file", DEFAULT_KEYPAIR_PATH)
  .option("-o, --output <path>", "Output path (extension is always set to match the original file)")
  .action(async (docId: string, seed: string, options) => {
    try {
      const metaPath = findMetadataFile(docId);
      if (!metaPath) {
        console.error(chalk.red("❌ Metadata file not found. Share the .doc.json file along with the document ID."));
        process.exit(1);
      }
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const keypair = loadKeyPair(path.resolve(options.keypair));

      const encrypted = await downloadFromStorage(meta.storageCid);
      const unpacked = unpackEncryptedData(encrypted);

      // Try the local wrapped key first (owner path).
      let docKey: Buffer | null = null;
      try {
        docKey = unwrapDocumentKey(deserializeWrappedKey(meta.wrappedKey), keypair.secretKey);
      } catch {
        // Not the owner — fall through to chain lookup.
      }

      if (!docKey) {
        const info = loadDeploymentInfo();
        if (!info) { console.error(chalk.red("❌ Not deployed")); process.exit(1); }

        // Sync the recipient's wallet (no DUST needed), then read the access
        // grant directly from the indexer via connectToDeployed — no callTx.
        // Re-connect on each attempt to read the latest indexed state.
        const contract = createDocumentManager(seed);
        await contract.connect();
        await contract.waitForSync();

        const recipientCommitment = computeOwnerCommitment(keypair.publicKey);
        const docIdBytes = new Uint8Array(Buffer.from(docId, "hex"));

        let grant = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          if (attempt > 0) await new Promise(res => setTimeout(res, 2000));
          await contract.connectToDeployed(info.contractAddress);
          grant = await contract.readAccessGrant(docIdBytes, new Uint8Array(recipientCommitment));
          if (grant) break;
        }

        await contract.close();

        if (!grant) {
          console.error(chalk.red("❌ No access grant found on-chain for this keypair."));
          process.exit(1);
        }

        try {
          docKey = unwrapDocumentKey(deserializeWrappedKey(grant), keypair.secretKey);
        } catch {
          console.error(chalk.red("❌ Access grant found but key could not be decrypted. Wrong keypair."));
          process.exit(1);
        }
      }

      const decrypted = decryptFile(unpacked, docKey!);
      if (!decrypted) { console.error(chalk.red("❌ Decryption failed")); process.exit(1); }

      const { outPath, corrected } = resolveOutputPath(options.output, meta.fileName);
      fs.writeFileSync(outPath, decrypted);
      console.log(chalk.green("\n✅ Downloaded:"), outPath);
      if (corrected) console.log(chalk.yellow("ℹ️  Extension corrected to match original:"), meta.fileName);
      console.log(chalk.gray("Original file:"), meta.fileName, "\n");
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// ── Share ─────────────────────────────────────────────────────────────────────

const share = program.command("share").description("Share document access");

share.command("grant")
  .description("Grant another user access to a document")
  .argument("<doc-id>", "Document ID")
  .argument("<pubkey>", "Recipient X25519 public key (hex) from their keys generate command")
  .argument("<seed>", "Your wallet mnemonic phrase")
  .option("-k, --keypair <path>", "Your keypair file", DEFAULT_KEYPAIR_PATH)
  .action(async (docId: string, pubkey: string, seed: string, options) => {
    try {
      const metaPath = findMetadataFile(docId);
      if (!metaPath) { console.error(chalk.red("❌ Metadata not found")); process.exit(1); }
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      const ownerKp = loadKeyPair(path.resolve(options.keypair));

      const docKey = unwrapDocumentKey(deserializeWrappedKey(meta.wrappedKey), ownerKp.secretKey);
      const recipientPk = parsePublicKeyHex(pubkey);
      const wrapped = wrapDocumentKey(docKey, recipientPk, ownerKp);
      const recipientCommitment = computeOwnerCommitment(recipientPk);

      const contract = createDocumentManager(seed);
      await contract.connect();
      await contract.waitForSync();
      const info = loadDeploymentInfo();
      if (!info) { await contract.close(); process.exit(1); }
      await contract.connectToDeployed(info.contractAddress);
      const ser = serializeWrappedKey(wrapped);
      await contract.grantAccess(
        new Uint8Array(Buffer.from(docId, "hex")),
        new Uint8Array(recipientCommitment),
        ser.encryptedKey,
        ser.nonce,
        ser.senderPublicKey,
      );
      await contract.close();
      console.log(chalk.green("\n✅ Access granted!\n"));
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

share.command("revoke")
  .description("Revoke a user's access to a document")
  .argument("<doc-id>", "Document ID")
  .argument("<pubkey>", "Recipient X25519 public key (hex)")
  .argument("<seed>", "Your wallet mnemonic phrase")
  .action(async (docId: string, pubkey: string, seed: string) => {
    try {
      const recipientPk = parsePublicKeyHex(pubkey);
      const recipientCommitment = computeOwnerCommitment(recipientPk);
      const docIdBytes = new Uint8Array(Buffer.from(docId, "hex"));

      const info = loadDeploymentInfo();
      if (!info) { console.error(chalk.red("❌ Not deployed")); process.exit(1); }

      // Pre-check that the grant exists. Revoking an already-revoked grant
      // causes a cryptic node-level failure rather than a contract assertion.
      const readContract = new DocumentManagerContract("");
      await readContract.initForRead(info.contractAddress);
      if (!await readContract.readAccessGrant(docIdBytes, new Uint8Array(recipientCommitment))) {
        console.error(chalk.red("❌ No active grant found for this keypair — already revoked?"));
        process.exit(1);
      }

      const contract = createDocumentManager(seed);
      await contract.connect();
      await contract.waitForSync();
      await contract.connectToDeployed(info.contractAddress);
      await contract.revokeAccess(docIdBytes, new Uint8Array(recipientCommitment));
      await contract.close();
      console.log(chalk.yellow("\n✅ Access revoked!\n"));
      console.log(chalk.gray("The recipient can no longer fetch the document key from the chain."));
      console.log(chalk.gray("Note: any copy they already decrypted and saved remains on their machine.\n"));
    } catch (e) { console.error(chalk.red("❌"), e); process.exit(1); }
  });

// ── List ──────────────────────────────────────────────────────────────────────

program.command("list")
  .description("List all documents registered from this machine")
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
