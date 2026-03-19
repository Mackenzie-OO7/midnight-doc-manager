import path from 'path';
import { createHash } from 'crypto';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { type MidnightProvider, type WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { type WalletContext } from '../utils/wallet.js';
import { type NetworkConfig } from '../utils/environment.js';

const CONTRACT_NAME = 'document-manager';

const zkConfigPath = path.join(
  process.cwd(),
  'contracts',
  'managed',
  CONTRACT_NAME,
);

export const createWalletAndMidnightProvider = (
  ctx: WalletContext,
): WalletProvider & MidnightProvider => {
  return {
    getCoinPublicKey: () => ctx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => ctx.shieldedSecretKeys.encryptionPublicKey,

    balanceTx: async (tx: any, ttl?: Date) => {
      const deadline = ttl ?? new Date(Date.now() + 30 * 60_000);
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: ctx.shieldedSecretKeys,
          dustSecretKey: ctx.dustSecretKey,
        },
        { ttl: deadline },
      );
      return ctx.wallet.finalizeRecipe(recipe);
    },

    submitTx: (tx: any) => ctx.wallet.submitTransaction(tx),
  };
};

/**
 * Build all providers needed by deployContract / findDeployedContract.
 *
 * Each wallet gets its own LevelDB database, keyed by a short hash of the
 * wallet's encryption public key. This prevents wallets from colliding on
 * the same encrypted database — the LevelDB provider encrypts entries with
 * getEncryptionPublicKey() as the password, so a different wallet would fail
 * to decrypt entries written by another wallet even in a differently-named store.
 */
export const configureProviders = async (
  ctx: WalletContext,
  networkConfig: NetworkConfig,
  _privateStateStoreName?: string, // kept for API compatibility, ignored
) => {
  const walletAndMidnightProvider = createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);

  const encPubKey = typeof ctx.shieldedSecretKeys.encryptionPublicKey === 'string'
    ? ctx.shieldedSecretKeys.encryptionPublicKey
    : Buffer.from(ctx.shieldedSecretKeys.encryptionPublicKey as Uint8Array).toString('hex');

  const walletDbId = createHash('sha256').update(encPubKey).digest('hex').slice(0, 16);
  const midnightDbName = `midnight-level-db-${walletDbId}`;

  return {
    privateStateProvider: levelPrivateStateProvider({
      midnightDbName,
      walletProvider: walletAndMidnightProvider,
    }),
    publicDataProvider: indexerPublicDataProvider(
      networkConfig.indexer,
      networkConfig.indexerWS,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};
