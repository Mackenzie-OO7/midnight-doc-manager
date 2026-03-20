import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

export interface EncryptedData {
    ciphertext: Buffer;
    iv: Buffer;
    authTag: Buffer;
}

export function generateDocumentKey(): Buffer {
    return randomBytes(32);
}

export function encryptFile(fileData: Buffer, key: Buffer): EncryptedData {
    if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(fileData), cipher.final()]);
    return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

export function decryptFile(encryptedData: EncryptedData, key: Buffer): Buffer {
    if (key.length !== 32) throw new Error("Decryption key must be 32 bytes");
    const decipher = createDecipheriv("aes-256-gcm", key, encryptedData.iv);
    decipher.setAuthTag(encryptedData.authTag);
    return Buffer.concat([decipher.update(encryptedData.ciphertext), decipher.final()]);
}

export function computeContentHash(data: Buffer): Buffer {
    return createHash("sha256").update(data).digest();
}

/**
 * Pack encrypted data into a single Buffer for storage.
 * Format: [IV (12 bytes)][Auth Tag (16 bytes)][Ciphertext (variable)]
 */
export function packEncryptedData(encryptedData: EncryptedData): Buffer {
    return Buffer.concat([encryptedData.iv, encryptedData.authTag, encryptedData.ciphertext]);
}

export function unpackEncryptedData(packed: Buffer): EncryptedData {
    if (packed.length < 28) throw new Error("Packed data too short");
    return {
        iv: packed.subarray(0, 12),
        authTag: packed.subarray(12, 28),
        ciphertext: packed.subarray(28),
    };
}
