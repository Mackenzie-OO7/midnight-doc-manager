import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { persistentHash, CompactTypeBytes } from "@midnight-ntwrk/compact-runtime";

export interface DocumentManagerPrivateState {
    secretKey: Uint8Array;
}

// Matches the compiled contract's _descriptor_0: CompactTypeBytes(32)
const BYTES32_DESCRIPTOR = new CompactTypeBytes(32);

/**
 * Create witnesses for the Document Manager contract.
 * The secretKey witness returns the wallet-derived key used for ownership proofs.
 */
export function createWitnesses(secretKey: Uint8Array) {
    if (secretKey.length !== 32) throw new Error("Secret key must be 32 bytes");
    return {
        secretKey(context: WitnessContext<any, DocumentManagerPrivateState>): [DocumentManagerPrivateState, Uint8Array] {
            return [context.privateState, secretKey];
        },
    };
}

/**
 * Compute an ownership commitment matching the contract's on-chain check:
 *   assert(persistentHash<Bytes<32>>(secretKey()) == ownerCommitment)
 *
 * Must use compact-runtime's persistentHash — plain SHA-256 produces a different result.
 */
export function computeOwnerCommitment(secretKey: Uint8Array): Uint8Array {
    if (secretKey.length !== 32) throw new Error("Secret key must be 32 bytes");
    return persistentHash(BYTES32_DESCRIPTOR, secretKey);
}

export function createInitialPrivateState(secretKey: Uint8Array): DocumentManagerPrivateState {
    return { secretKey };
}
