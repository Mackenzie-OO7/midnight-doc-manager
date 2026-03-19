import nacl from "tweetnacl";
import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface DocumentKeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
}

export interface WrappedKey {
    encryptedKey: Uint8Array;
    nonce: Uint8Array;
    senderPublicKey: Uint8Array;
}

export interface SerializedWrappedKey {
    encryptedKey: string;
    nonce: string;
    senderPublicKey: string;
}

export function generateKeyPair(): DocumentKeyPair {
    const keypair = nacl.box.keyPair();
    return { publicKey: keypair.publicKey, secretKey: keypair.secretKey };
}

export function saveKeyPair(keypair: DocumentKeyPair, filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
        publicKey: Buffer.from(keypair.publicKey).toString("hex"),
        secretKey: Buffer.from(keypair.secretKey).toString("hex"),
    }, null, 2));
}

export function loadKeyPair(filePath: string): DocumentKeyPair {
    if (!fs.existsSync(filePath)) throw new Error(`Keypair file not found: ${filePath}`);
    const { publicKey, secretKey } = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
        publicKey: new Uint8Array(Buffer.from(publicKey, "hex")),
        secretKey: new Uint8Array(Buffer.from(secretKey, "hex")),
    };
}

/**
 * Wrap (encrypt) a document key for a recipient using X25519 + XSalsa20-Poly1305.
 */
export function wrapDocumentKey(
    documentKey: Buffer,
    recipientPublicKey: Uint8Array,
    senderKeypair: DocumentKeyPair,
): WrappedKey {
    if (documentKey.length !== 32) throw new Error("Document key must be 32 bytes");
    const nonce = new Uint8Array(randomBytes(nacl.box.nonceLength));
    const encryptedKey = nacl.box(new Uint8Array(documentKey), nonce, recipientPublicKey, senderKeypair.secretKey);
    return { encryptedKey, nonce, senderPublicKey: senderKeypair.publicKey };
}

/**
 * Unwrap (decrypt) a document key. Throws if decryption fails.
 */
export function unwrapDocumentKey(wrappedKey: WrappedKey, recipientSecretKey: Uint8Array): Buffer {
    const decrypted = nacl.box.open(
        wrappedKey.encryptedKey,
        wrappedKey.nonce,
        wrappedKey.senderPublicKey,
        recipientSecretKey,
    );
    if (!decrypted) throw new Error("Failed to decrypt document key - invalid key or corrupted data");
    return Buffer.from(decrypted);
}

export function serializeWrappedKey(wrappedKey: WrappedKey): SerializedWrappedKey {
    return {
        encryptedKey: Buffer.from(wrappedKey.encryptedKey).toString("hex"),
        nonce: Buffer.from(wrappedKey.nonce).toString("hex"),
        senderPublicKey: Buffer.from(wrappedKey.senderPublicKey).toString("hex"),
    };
}

export function deserializeWrappedKey(serialized: SerializedWrappedKey): WrappedKey {
    return {
        encryptedKey: new Uint8Array(Buffer.from(serialized.encryptedKey, "hex")),
        nonce: new Uint8Array(Buffer.from(serialized.nonce, "hex")),
        senderPublicKey: new Uint8Array(Buffer.from(serialized.senderPublicKey, "hex")),
    };
}

export function getPublicKeyHex(keypair: DocumentKeyPair): string {
    return Buffer.from(keypair.publicKey).toString("hex");
}

export function parsePublicKeyHex(hex: string): Uint8Array {
    if (hex.length !== 64) throw new Error("Invalid public key: must be 64 hex characters");
    return new Uint8Array(Buffer.from(hex, "hex"));
}
