import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

/**
 * Encryption result containing the encrypted data, IV, and auth tag
 */
export interface EncryptedData {
    ciphertext: Buffer;
    /** Initialization vector (12 bytes for AES-GCM) */
    iv: Buffer;
    /** Authentication tag (16 bytes) */
    authTag: Buffer;
}

/**
 * Serialized encrypted data for storage
 */
export interface SerializedEncryptedData {
    ciphertext: string;
    iv: string;
    authTag: string;
}

/**
 * Generate a random AES-256 document encryption key
 * @returns Random 256-bit key as Buffer
 */
export function generateDocumentKey(): Buffer {
    return randomBytes(32);
}

/**
 * Encrypt data using AES-256-GCM
 * @param data - The plaintext data to encrypt
 * @param key - The 256-bit encryption key
 * @returns Encrypted data with IV and auth tag
 */
export function encryptData(data: Buffer, key: Buffer): EncryptedData {
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes (256 bits)");
    }

    const iv = randomBytes(12);

    const cipher = createCipheriv("aes-256-gcm", key, iv);

    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return { ciphertext, iv, authTag };
}

/**
 * Decrypt data using AES-256-GCM
 * @param encryptedData - The encrypted data with IV and auth tag
 * @param key - The 256-bit decryption key
 * @returns Decrypted plaintext data
 */
export function decryptData(encryptedData: EncryptedData, key: Buffer): Buffer {
    if (key.length !== 32) {
        throw new Error("Decryption key must be 32 bytes (256 bits)");
    }

    const decipher = createDecipheriv("aes-256-gcm", key, encryptedData.iv);

    decipher.setAuthTag(encryptedData.authTag);

    const plaintext = Buffer.concat([
        decipher.update(encryptedData.ciphertext),
        decipher.final(),
    ]);

    return plaintext;
}

/**
 * Encrypt a file's contents
 * @param fileData - The file data as Buffer
 * @param key - The 256-bit encryption key
 * @returns Encrypted file data
 */
export function encryptFile(fileData: Buffer, key: Buffer): EncryptedData {
    return encryptData(fileData, key);
}

/**
 * Decrypt a file's contents
 * @param encryptedData - The encrypted file data
 * @param key - The 256-bit decryption key
 * @returns Decrypted file data
 */
export function decryptFile(encryptedData: EncryptedData, key: Buffer): Buffer {
    return decryptData(encryptedData, key);
}

/**
 * Compute SHA-256 content hash of data
 * For onchain verification of document integrity
 * @param data - The data to hash
 * @returns SHA-256 hash as Buffer (32 bytes)
 */
export function computeContentHash(data: Buffer): Buffer {
    return createHash("sha256").update(data).digest();
}

/**
 * Compute content hash and return as hex string
 * @param data - The data to hash
 * @returns SHA-256 hash as hex string
 */
export function computeContentHashHex(data: Buffer): string {
    return computeContentHash(data).toString("hex");
}

/**
 * Serialize encrypted data for storage/transmission
 * @param encryptedData - The encrypted data to serialize
 * @returns Serialized data with base64 encoding
 */
export function serializeEncryptedData(
    encryptedData: EncryptedData
): SerializedEncryptedData {
    return {
        ciphertext: encryptedData.ciphertext.toString("base64"),
        iv: encryptedData.iv.toString("base64"),
        authTag: encryptedData.authTag.toString("base64"),
    };
}

/**
 * Deserialize encrypted data from storage
 * @param serialized - The serialized encrypted data
 * @returns Deserialized encrypted data
 */
export function deserializeEncryptedData(
    serialized: SerializedEncryptedData
): EncryptedData {
    return {
        ciphertext: Buffer.from(serialized.ciphertext, "base64"),
        iv: Buffer.from(serialized.iv, "base64"),
        authTag: Buffer.from(serialized.authTag, "base64"),
    };
}

/**
 * Pack encrypted data into a single Buffer for storage
 * Format: [IV (12 bytes)][Auth Tag (16 bytes)][Ciphertext (variable)]
 * @param encryptedData - The encrypted data to pack
 * @returns Single Buffer containing all encrypted data
 */
export function packEncryptedData(encryptedData: EncryptedData): Buffer {
    return Buffer.concat([
        encryptedData.iv,
        encryptedData.authTag,
        encryptedData.ciphertext,
    ]);
}

/**
 * Unpack encrypted data from a single Buffer
 * @param packed - Packed encrypted data
 * @returns Unpacked encrypted data
 */
export function unpackEncryptedData(packed: Buffer): EncryptedData {
    if (packed.length < 28) {
        throw new Error("Packed data too short (minimum 28 bytes for IV + authTag)");
    }

    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);

    return { iv, authTag, ciphertext };
}
