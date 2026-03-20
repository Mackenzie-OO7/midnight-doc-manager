import 'dotenv/config';
import * as Rx from 'rxjs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { WebSocket } from 'ws';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
  initWalletWithSeed,
  mnemonicToSeed,
  getShieldedAddress,
} from '../utils/wallet.js';
import { EnvironmentManager } from '../utils/environment.js';
import { configureProviders } from '../providers/midnight-providers.js';
import {
  createWitnesses,
  createInitialPrivateState,
  computeOwnerCommitment,
  type DocumentManagerPrivateState,
} from './witnesses.js';

// @ts-expect-error: enable WebSocket for GraphQL subscriptions in Node
globalThis.WebSocket = WebSocket;

const CONTRACT_NAME = 'document-manager';
const CONTRACT_TAG = 'document-manager';
const PRIVATE_STATE_ID = 'doc-manager-private-state';

export interface DeploymentInfo {
  contractAddress: string;
  deployedAt: string;
  network?: string;
  contractName?: string;
}

export class DocumentManagerContract {
  private deployedContract: any = null;
  private walletCtx: Awaited<ReturnType<typeof initWalletWithSeed>> | null = null;
  private secretKeyBytes: Uint8Array;
  private mnemonic: string;
  private walletAddress: string = '';
  private contractAddress: string = '';
  private ledgerFn: ((state: any) => any) | null = null;
  private pureCircuits: any = null;
  private publicDataProvider: any = null;

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic;
    this.secretKeyBytes = new Uint8Array(32);
  }

  async connect(): Promise<string> {
    const seed = await mnemonicToSeed(this.mnemonic);

    // Derive a stable 32-byte key from the mnemonic for on-chain ownership
    // proofs. Must match what the contract witness returns — not the X25519 key.
    this.secretKeyBytes = new Uint8Array(
      createHash('sha256')
        .update('midnight-doc-manager:owner-key:')
        .update(seed)
        .digest(),
    );

    this.walletCtx = await initWalletWithSeed(seed);
    await Rx.firstValueFrom(
      this.walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
    );

    this.walletAddress = getShieldedAddress(this.walletCtx.shieldedSecretKeys);
    return this.walletAddress;
  }

  getOwnerCommitment(): Uint8Array {
    return computeOwnerCommitment(this.secretKeyBytes);
  }

  async waitForSync(): Promise<void> {
    if (!this.walletCtx) throw new Error('Not connected. Call connect() first.');
    await Rx.firstValueFrom(
      this.walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
    );
  }

  loadDeploymentInfo(): DeploymentInfo | null {
    const deploymentPath = path.join(process.cwd(), 'deployment.json');
    if (!fs.existsSync(deploymentPath)) return null;
    return JSON.parse(fs.readFileSync(deploymentPath, 'utf-8'));
  }

  /**
   * Load the compiled contract module and create an indexer provider without
   * initializing a wallet. Used for read-only state checks (grant existence
   * pre-check before revoke) that require no DUST or network sync.
   */
  async initForRead(contractAddress: string): Promise<void> {
    this.contractAddress = contractAddress;

    const contractModulePath = path.join(
      process.cwd(), 'contracts', 'managed', CONTRACT_NAME, 'contract', 'index.js',
    );
    if (!fs.existsSync(contractModulePath)) {
      throw new Error('Contract not compiled. Run: npm run compile');
    }

    const { ledger, pureCircuits } = await import(pathToFileURL(contractModulePath).href);
    this.ledgerFn = ledger;
    this.pureCircuits = pureCircuits;

    const networkConfig = EnvironmentManager.getNetworkConfig();
    this.publicDataProvider = indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS);
  }

  async connectToDeployed(contractAddress: string): Promise<void> {
    if (!this.walletCtx) throw new Error('Not connected. Call connect() first.');

    this.contractAddress = contractAddress;

    const networkConfig = EnvironmentManager.getNetworkConfig();
    const providers = await configureProviders(this.walletCtx, networkConfig);

    // Store the provider so readAccessGrant uses the same Apollo client —
    // guaranteed to reflect the state that findDeployedContract saw.
    this.publicDataProvider = providers.publicDataProvider;

    const contractModulePath = path.join(
      process.cwd(), 'contracts', 'managed', CONTRACT_NAME, 'contract', 'index.js',
    );
    if (!fs.existsSync(contractModulePath)) {
      throw new Error('Contract not compiled. Run: npm run compile');
    }

    const zkConfigPath = path.join(process.cwd(), 'contracts', 'managed', CONTRACT_NAME);
    const { Contract, ledger, pureCircuits } = await import(pathToFileURL(contractModulePath).href);

    this.ledgerFn = ledger;
    this.pureCircuits = pureCircuits;

    const compiledContract = CompiledContract.make(CONTRACT_TAG, Contract).pipe(
      CompiledContract.withWitnesses(createWitnesses(this.secretKeyBytes)),
      CompiledContract.withCompiledFileAssets(zkConfigPath),
    );

    const initialPrivateState: DocumentManagerPrivateState = createInitialPrivateState(this.secretKeyBytes);

    this.deployedContract = await findDeployedContract(providers as any, {
      compiledContract: compiledContract as any,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });
  }

  async registerDocument(
    documentId: Uint8Array,
    contentHash: Uint8Array,
    storageCid: string,
    ownerCommitment: Uint8Array,
    fileType: string,
  ): Promise<string> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.registerDocument(
      documentId, contentHash, storageCid, ownerCommitment, fileType,
    );
    return result.public.txId as string;
  }

  async verifyDocument(documentId: Uint8Array, providedHash: Uint8Array): Promise<boolean> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.verifyDocument(documentId, providedHash);
    return result.private.result as boolean;
  }

  async updateDocument(
    documentId: Uint8Array,
    newContentHash: Uint8Array,
    newStorageCid: string,
  ): Promise<string> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.updateDocument(
      documentId, newContentHash, newStorageCid,
    );
    return result.public.txId as string;
  }

  async deactivateDocument(documentId: Uint8Array): Promise<string> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.deactivateDocument(documentId);
    return result.public.txId as string;
  }

  async grantAccess(
    documentId: Uint8Array,
    recipientCommitment: Uint8Array,
    encryptedKey: string,
    nonce: string,
    senderPublicKey: string,
  ): Promise<string> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.grantAccess(
      documentId, recipientCommitment, encryptedKey, nonce, senderPublicKey,
    );
    return result.public.txId as string;
  }

  async revokeAccess(documentId: Uint8Array, recipientCommitment: Uint8Array): Promise<string> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.revokeAccess(documentId, recipientCommitment);
    return result.public.txId as string;
  }

  async hasAccess(documentId: Uint8Array, recipientCommitment: Uint8Array): Promise<boolean> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    const result = await this.deployedContract.callTx.hasAccess(documentId, recipientCommitment);
    return result.private.result as boolean;
  }

  /**
   * Read an access grant directly from the indexer — no DUST or callTx required.
   * Works after initForRead() or connectToDeployed(). Re-calling connectToDeployed()
   * before each read ensures the state reflects the latest indexed block.
   */
  async readAccessGrant(
    documentId: Uint8Array,
    recipientCommitment: Uint8Array,
  ): Promise<{ encryptedKey: string; nonce: string; senderPublicKey: string } | null> {
    if (!this.publicDataProvider || !this.ledgerFn || !this.pureCircuits) {
      throw new Error('Contract not initialized. Call initForRead() or connectToDeployed() first.');
    }

    const contractState = await this.publicDataProvider.queryContractState(this.contractAddress as any);
    if (!contractState) return null;

    // queryContractState returns a ContractState — ledger() expects its .data (ChargedState)
    const ledgerState = this.ledgerFn((contractState as any).data);
    const grantKey = this.pureCircuits.computeGrantKey(documentId, recipientCommitment);

    if (!ledgerState.accessGrants.member(grantKey)) return null;
    return ledgerState.accessGrants.lookup(grantKey) as {
      encryptedKey: string;
      nonce: string;
      senderPublicKey: string;
    };
  }

  async getDocument(documentId: Uint8Array): Promise<{
    contentHash: Uint8Array;
    storageCid: string;
    ownerCommitment: Uint8Array;
    fileType: string;
    isActive: boolean;
  } | null> {
    if (!this.deployedContract) throw new Error('Contract not connected');
    try {
      const result = await this.deployedContract.callTx.getDocument(documentId);
      return result.private.result as any;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.walletCtx) await this.walletCtx.wallet.stop();
    this.deployedContract = null;
    this.walletCtx = null;
    this.publicDataProvider = null;
  }
}

export function createDocumentManager(mnemonic?: string): DocumentManagerContract {
  const phrase = mnemonic || process.env.WALLET_MNEMONIC;
  if (!phrase) {
    throw new Error('Mnemonic not provided and WALLET_MNEMONIC not set in environment');
  }
  return new DocumentManagerContract(phrase);
}
