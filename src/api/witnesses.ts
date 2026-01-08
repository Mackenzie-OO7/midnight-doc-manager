import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { createHash } from "crypto";

/**
 * Private state type for the Document Manager contract
 * Stores the user's secret key for document ownership verification
 */
export interface DocumentManagerPrivateState {
    secretKey: Uint8Array;
}

/**
 * Ledger type from the compiled contract
 */
export interface DocumentManagerLedger {
    documents: {
        lookup(key: Uint8Array): {
            contentHash: Uint8Array;
            storageCid: string;
            ownerCommitment: Uint8Array;
            fileType: string;
            isActive: boolean;
        };
        member(key: Uint8Array): boolean;
    };
    accessGrants: {
        lookup(key: Uint8Array): {
            encryptedKey: string;
            nonce: string;
            senderPublicKey: string;
        };
        member(key: Uint8Array): boolean;
    };
    documentCount: bigint;
}

/**
 * Create witnesses for the Document Manager contract
 * @param secretKey - The user's secret key for ownership proofs
 */
export function createWitnesses(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
        throw new Error("Secret key must be 32 bytes");
    }

    return {
        /**
         * Witness function that returns the caller's secret key
         * Used for ownership verification in the contract
         */
        secretKey(
            context: WitnessContext<DocumentManagerLedger, DocumentManagerPrivateState>
        ): [DocumentManagerPrivateState, Uint8Array] {
            // Return the private state and the secret key
            return [context.privateState, secretKey];
        },
    };
}

/**
 * Generate owner commitment from secret key
 */
export function computeOwnerCommitment(secretKey: Uint8Array): Uint8Array {
    if (secretKey.length !== 32) {
        throw new Error("Secret key must be 32 bytes");
    }
    // persistentHash in Compact is a SHA-256 based hash
    const hash = createHash("sha256").update(secretKey).digest();
    return new Uint8Array(hash);
}

/**
 * Create initial private state for the contract
 * @param secretKey - The user's secret key
 */
export function createInitialPrivateState(
    secretKey: Uint8Array
): DocumentManagerPrivateState {
    return { secretKey };
}

/**
 * Derive a secret key from a wallet seed (mostly for convenience)
 * Uses a domain-separated hash to derive a document-specific key
 * @param walletSeed - The wallet seed (hex string)
 * @returns 32-byte secret key for document ownership
 */
export function deriveSecretKeyFromWalletSeed(walletSeed: string): Uint8Array {
    const seedBuffer = Buffer.from(walletSeed, "hex");
    const hash = createHash("sha256")
        .update(Buffer.from("midnight-doc-manager:owner-key:"))
        .update(seedBuffer)
        .digest();
    return new Uint8Array(hash);
}
