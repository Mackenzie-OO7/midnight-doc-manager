import nacl from "tweetnacl";
import { randomBytes, createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * X25519 keypair for document key exchange
 */
export interface DocumentKeyPair {
    /** Public key (32 bytes)*/
    publicKey: Uint8Array;
    /** Secret key (32 bytes). please keep private */
    secretKey: Uint8Array;
}

/**
 * Serialized keypair for storage
 */
export interface SerializedKeyPair {
    publicKey: string;
    secretKey: string;
}

/**
 * Wrapped (encrypted) document key for sharing
 */
export interface WrappedKey {
    /** Encrypted document key */
    encryptedKey: Uint8Array;
    /** Nonce used for encryption */
    nonce: Uint8Array;
    /** Sender's public key (for decryption) */
    senderPublicKey: Uint8Array;
}

/**
 * Serialized wrapped key for storage
 */
export interface SerializedWrappedKey {
    encryptedKey: string;
    nonce: string;
    senderPublicKey: string;
}

/**
 * Generate a new X25519 keypair for document encryption key exchange
 * @returns New keypair
 */
export function generateKeyPair(): DocumentKeyPair {
    const keypair = nacl.box.keyPair();
    return {
        publicKey: keypair.publicKey,
        secretKey: keypair.secretKey,
    };
}

/**
 * Generate keypair from a seed
 * @param seed - 32-byte seed
 * @returns Deterministic keypair
 */
export function generateKeyPairFromSeed(seed: Uint8Array): DocumentKeyPair {
    if (seed.length !== 32) {
        throw new Error("Seed must be 32 bytes");
    }
    const keypair = nacl.box.keyPair.fromSecretKey(seed);
    return {
        publicKey: keypair.publicKey,
        secretKey: keypair.secretKey,
    };
}

/**
 * Serialize keypair for storage
 * @param keypair - The keypair to serialize
 * @returns Hex-encoded keypair
 */
export function serializeKeyPair(keypair: DocumentKeyPair): SerializedKeyPair {
    return {
        publicKey: Buffer.from(keypair.publicKey).toString("hex"),
        secretKey: Buffer.from(keypair.secretKey).toString("hex"),
    };
}

/**
 * Deserialize keypair from storage
 * @param serialized - Hex-encoded keypair
 * @returns Keypair
 */
export function deserializeKeyPair(serialized: SerializedKeyPair): DocumentKeyPair {
    return {
        publicKey: new Uint8Array(Buffer.from(serialized.publicKey, "hex")),
        secretKey: new Uint8Array(Buffer.from(serialized.secretKey, "hex")),
    };
}

/**
 * Save keypair to file
 * @param keypair - The keypair to save
 * @param filePath - Path to save the keypair
 */
export function saveKeyPair(keypair: DocumentKeyPair, filePath: string): void {
    const serialized = serializeKeyPair(keypair);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2));
}

/**
 * Load keypair from file
 * @param filePath - Path to load the keypair from
 * @returns Keypair
 */
export function loadKeyPair(filePath: string): DocumentKeyPair {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Keypair file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const serialized: SerializedKeyPair = JSON.parse(content);
    return deserializeKeyPair(serialized);
}

/**
 * Get or create keypair at path
 * @param filePath - Path to the keypair file
 * @returns Existing or newly generated keypair
 */
export function getOrCreateKeyPair(filePath: string): DocumentKeyPair {
    if (fs.existsSync(filePath)) {
        return loadKeyPair(filePath);
    }
    const keypair = generateKeyPair();
    saveKeyPair(keypair, filePath);
    return keypair;
}

/**
 * Wrap (encrypt) a document key for a recipient
 * Uses X25519 key exchange + XSalsa20-Poly1305
 * @param documentKey - The AES document key to wrap (32 bytes)
 * @param recipientPublicKey - Recipient's X25519 public key
 * @param senderSecretKey - Sender's X25519 secret key
 * @returns Wrapped key with nonce and sender public key
 */
export function wrapDocumentKey(
    documentKey: Buffer,
    recipientPublicKey: Uint8Array,
    senderKeypair: DocumentKeyPair
): WrappedKey {
    if (documentKey.length !== 32) {
        throw new Error("Document key must be 32 bytes");
    }

    // Generate random nonce
    const nonce = new Uint8Array(randomBytes(nacl.box.nonceLength));

    // Encrypt the document key
    const encryptedKey = nacl.box(
        new Uint8Array(documentKey),
        nonce,
        recipientPublicKey,
        senderKeypair.secretKey
    );

    return {
        encryptedKey,
        nonce,
        senderPublicKey: senderKeypair.publicKey,
    };
}

/**
 * Unwrap (decrypt) a document key
 * @param wrappedKey - The wrapped key
 * @param recipientSecretKey - Recipient's X25519 secret key
 * @returns Decrypted document key (32 bytes)
 */
export function unwrapDocumentKey(
    wrappedKey: WrappedKey,
    recipientSecretKey: Uint8Array
): Buffer {
    const decrypted = nacl.box.open(
        wrappedKey.encryptedKey,
        wrappedKey.nonce,
        wrappedKey.senderPublicKey,
        recipientSecretKey
    );

    if (!decrypted) {
        throw new Error("Failed to decrypt document key - invalid key or corrupted data");
    }

    return Buffer.from(decrypted);
}

/**
 * Serialize wrapped key for storage
 * @param wrappedKey - The wrapped key to serialize
 * @returns Hex-encoded wrapped key
 */
export function serializeWrappedKey(wrappedKey: WrappedKey): SerializedWrappedKey {
    return {
        encryptedKey: Buffer.from(wrappedKey.encryptedKey).toString("hex"),
        nonce: Buffer.from(wrappedKey.nonce).toString("hex"),
        senderPublicKey: Buffer.from(wrappedKey.senderPublicKey).toString("hex"),
    };
}

/**
 * Deserialize wrapped key from storage
 * @param serialized - Hex-encoded wrapped key
 * @returns Wrapped key
 */
export function deserializeWrappedKey(serialized: SerializedWrappedKey): WrappedKey {
    return {
        encryptedKey: new Uint8Array(Buffer.from(serialized.encryptedKey, "hex")),
        nonce: new Uint8Array(Buffer.from(serialized.nonce, "hex")),
        senderPublicKey: new Uint8Array(Buffer.from(serialized.senderPublicKey, "hex")),
    };
}

/**
 * Get public key as hex string (for display/sharing)
 * @param keypair - The keypair
 * @returns Hex-encoded public key
 */
export function getPublicKeyHex(keypair: DocumentKeyPair): string {
    return Buffer.from(keypair.publicKey).toString("hex");
}

/**
 * Parse public key from hex string
 * @param hex - Hex-encoded public key
 * @returns Public key as Uint8Array
 */
export function parsePublicKeyHex(hex: string): Uint8Array {
    if (hex.length !== 64) {
        throw new Error("Invalid public key: must be 64 hex characters (32 bytes)");
    }
    return new Uint8Array(Buffer.from(hex, "hex"));
}

/**
 * Compute a commitment to a public key (for onchain storage)
 * This is a simple SHA-256 hash and it matches what we use in Compact
 * @param publicKey - The public key to commit
 * @returns 32-byte commitment
 */
export function computePublicKeyCommitment(publicKey: Uint8Array): Buffer {
    return createHash("sha256").update(publicKey).digest();
}
