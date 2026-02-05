// Wallet utilities for mnemonic-based wallet initialization
// Based on midnight-playground by Shagun Prasad
// Licensed under Apache-2.0

import * as ledger from '@midnight-ntwrk/ledger-v6';
import type { DefaultV1Configuration as DustConfiguration } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import type { DefaultV1Configuration as ShieldedConfiguration } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import {
    createKeystore,
    InMemoryTransactionHistoryStorage,
    PublicKey as UnshieldedPublicKey,
    type UnshieldedKeystore,
    UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Buffer } from 'buffer';

// Network configuration from environment or defaults (for undeployed local network)
const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);

const INDEXER_HTTP_URL = process.env['MIDNIGHT_INDEXER_URL'] ?? `http://localhost:${INDEXER_PORT}/api/v3/graphql`;
const INDEXER_WS_URL = process.env['MIDNIGHT_INDEXER_WS_URL'] ?? `ws://localhost:${INDEXER_PORT}/api/v3/graphql/ws`;

export const NETWORK_ID = 'undeployed';

export const configuration: ShieldedConfiguration & DustConfiguration & { indexerUrl: string } = {
    networkId: NETWORK_ID,
    costParameters: {
        additionalFeeOverhead: 300_000_000_000_000_000n,
        feeBlocksMargin: 5,
    },
    relayURL: new URL(`ws://localhost:${NODE_PORT}`),
    provingServerUrl: new URL(`http://localhost:${PROOF_SERVER_PORT}`),
    indexerClientConnection: {
        indexerHttpUrl: INDEXER_HTTP_URL,
        indexerWsUrl: INDEXER_WS_URL,
    },
    indexerUrl: INDEXER_WS_URL,
};

export interface WalletContext {
    wallet: WalletFacade;
    shieldedSecretKeys: ledger.ZswapSecretKeys;
    dustSecretKey: ledger.DustSecretKey;
    unshieldedKeystore: UnshieldedKeystore;
}

/**
 * Initialize a wallet from a 32-byte seed (first 32 bytes of BIP-39 derived seed)
 * Uses the same HD derivation path as Lace wallet
 */
export const initWalletWithSeed = async (seed: Buffer): Promise<WalletContext> => {
    const hdWallet = HDWallet.fromSeed(Uint8Array.from(seed));

    if (hdWallet.type !== 'seedOk') {
        throw new Error('Failed to initialize HDWallet');
    }

    // Derive keys at account 0, index 0 for roles: Zswap (shielded), NightExternal (unshielded), Dust
    const derivationResult = hdWallet.hdWallet
        .selectAccount(0)
        .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
        .deriveKeysAt(0);

    if (derivationResult.type !== 'keysDerived') {
        throw new Error('Failed to derive keys');
    }

    // Clear the HD wallet from memory after derivation
    hdWallet.hdWallet.clear();

    // Create secret keys from derived seeds
    const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivationResult.keys[Roles.Zswap]);
    const dustSecretKey = ledger.DustSecretKey.fromSeed(derivationResult.keys[Roles.Dust]);
    const unshieldedKeystore = createKeystore(derivationResult.keys[Roles.NightExternal], configuration.networkId);

    // Initialize the three wallet types
    const shieldedWallet = ShieldedWallet(configuration).startWithSecretKeys(shieldedSecretKeys);
    const dustWallet = DustWallet(configuration).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
    );
    const unshieldedWallet = UnshieldedWallet({
        ...configuration,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    }).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore));

    // Create and start the facade
    const facade: WalletFacade = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
    await facade.start(shieldedSecretKeys, dustSecretKey);

    return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};
