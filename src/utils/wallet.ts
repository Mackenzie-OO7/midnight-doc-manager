/**
 * Wallet utilities for seed-based wallet initialization.
 * Mirrors midnight-local-dev's wallet initialization pattern exactly,
 * ensuring address derivation is consistent across both repos.
 */
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { type DefaultConfiguration, WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import type { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as Rx from 'rxjs';
import { Buffer } from 'buffer';

export const NETWORK_ID = (process.env.MIDNIGHT_NETWORK ?? 'undeployed') as NetworkId.NetworkId;

setNetworkId(NETWORK_ID as Parameters<typeof setNetworkId>[0]);

export const INDEXER_HTTP = process.env.MIDNIGHT_INDEXER_URL ?? (
  NETWORK_ID === 'preprod'
    ? 'https://indexer.preprod.midnight.network/api/v3/graphql'
    : 'http://localhost:8088/api/v3/graphql'
);
export const INDEXER_WS = process.env.MIDNIGHT_INDEXER_WS_URL ?? (
  NETWORK_ID === 'preprod'
    ? 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws'
    : 'ws://localhost:8088/api/v3/graphql/ws'
);
export const NODE_URL = process.env.MIDNIGHT_NODE_URL ?? (
  NETWORK_ID === 'preprod'
    ? 'https://rpc.preprod.midnight.network'
    : 'http://localhost:9944'
);
export const PROOF_SERVER_URL = process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300';

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

/**
 * Convert a BIP39 mnemonic to a seed buffer.
 * Uses the full 64-byte seed, matching midnight-local-dev exactly.
 */
export const mnemonicToSeed = async (mnemonic: string): Promise<Buffer> => {
  const words = mnemonic.trim().split(/\s+/).join(' ');
  if (!bip39.validateMnemonic(words, english)) {
    throw new Error('Invalid mnemonic phrase');
  }
  return Buffer.from(await bip39.mnemonicToSeed(words));
};

/**
 * Initialize a wallet from a seed buffer.
 * Uses the same HD derivation and WalletFacade.init() pattern as midnight-local-dev.
 */
export const initWalletWithSeed = async (seed: Buffer): Promise<WalletContext> => {
  const hdResult = HDWallet.fromSeed(seed);
  if (hdResult.type !== 'seedOk') {
    throw new Error(`Failed to initialize HDWallet: ${String((hdResult as any).error)}`);
  }

  const derivation = hdResult.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivation.type !== 'keysDerived') throw new Error('Failed to derive keys from HDWallet');

  hdResult.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derivation.keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(derivation.keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(derivation.keys[Roles.NightExternal], NETWORK_ID);

  const configuration: DefaultConfiguration = {
    networkId: NETWORK_ID,
    indexerClientConnection: { indexerHttpUrl: INDEXER_HTTP, indexerWsUrl: INDEXER_WS },
    provingServerUrl: new URL(PROOF_SERVER_URL),
    relayURL: new URL(NODE_URL.replace(/^http/, 'ws')),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };

  const facade = await WalletFacade.init({
    configuration,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);

  return { wallet: facade, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const getUnshieldedAddress = (unshieldedKeystore: UnshieldedKeystore): string =>
  unshieldedKeystore.getBech32Address().asString();

export const getShieldedAddress = (shieldedSecretKeys: ledger.ZswapSecretKeys): string =>
  MidnightBech32m.encode(
    NETWORK_ID,
    new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(shieldedSecretKeys.coinPublicKey),
      ShieldedEncryptionPublicKey.fromHexString(shieldedSecretKeys.encryptionPublicKey),
    ),
  ).asString();

export const getDustBalance = (state: any): bigint =>
  state.dust?.balance(new Date()) ?? 0n;

/**
 * Register all available unshielded UTXOs for dust generation.
 * Idempotent — safe to call even if already registered.
 */
export const registerForDustGeneration = async (walletCtx: WalletContext): Promise<void> => {
  const state = await Rx.firstValueFrom(
    walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const coins = (state.unshielded as any)?.availableCoins?.filter(
    (coin: any) => coin.meta?.registeredForDustGeneration === false,
  ) ?? [];

  if (coins.length === 0) return;

  const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
    coins,
    walletCtx.unshieldedKeystore.getPublicKey(),
    (payload: Uint8Array) => walletCtx.unshieldedKeystore.signData(payload),
  );

  await walletCtx.wallet.submitTransaction(await walletCtx.wallet.finalizeRecipe(recipe));
};
