import fs from 'fs';

export interface NetworkConfig {
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  name: string;
}

export interface StorageConfig {
  provider: 'ipfs' | 'arweave';
  pinataJwt?: string;
  pinataGateway: string;
  arweaveWalletPath?: string;
  arweaveGateway: string;
}

/**
 * Strip the legacy /ipfs suffix from a Pinata gateway URL.
 * The Pinata v3 Files API expects just the domain.
 */
function normalisePinataGateway(url: string): string {
  return url.replace(/\/ipfs\/?$/, '').replace(/\/$/, '');
}

export class EnvironmentManager {
  static getNetworkConfig(): NetworkConfig {
    const network = process.env.MIDNIGHT_NETWORK ?? 'undeployed';

    const networks: Record<string, NetworkConfig> = {
      preprod: {
        indexer: process.env.MIDNIGHT_INDEXER_URL ?? 'https://indexer.preprod.midnight.network/api/v3/graphql',
        indexerWS: process.env.MIDNIGHT_INDEXER_WS_URL ?? 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
        node: process.env.MIDNIGHT_NODE_URL ?? 'https://rpc.preprod.midnight.network',
        proofServer: process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
        name: 'Preprod',
      },
      undeployed: {
        indexer: process.env.MIDNIGHT_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v3/graphql',
        indexerWS: process.env.MIDNIGHT_INDEXER_WS_URL ?? 'ws://127.0.0.1:8088/api/v3/graphql/ws',
        node: process.env.MIDNIGHT_NODE_URL ?? 'http://127.0.0.1:9944',
        proofServer: process.env.PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
        name: 'Undeployed (Local)',
      },
    };

    return networks[network] ?? networks['undeployed'];
  }

  static getStorageConfig(): StorageConfig {
    const provider = (process.env.STORAGE_PROVIDER ?? 'ipfs') as 'ipfs' | 'arweave';
    return {
      provider,
      pinataJwt: process.env.PINATA_JWT,
      pinataGateway: normalisePinataGateway(
        process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud'
      ),
      arweaveWalletPath: process.env.ARWEAVE_WALLET_PATH,
      arweaveGateway: process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net',
    };
  }

  static validateStorageConfig(): void {
    const config = this.getStorageConfig();
    if (config.provider === 'ipfs' && !config.pinataJwt) {
      throw new Error('PINATA_JWT is required when using IPFS storage provider');
    }
    if (config.provider === 'arweave') {
      if (!config.arweaveWalletPath) {
        throw new Error('ARWEAVE_WALLET_PATH is required when using Arweave storage provider');
      }
      if (!fs.existsSync(config.arweaveWalletPath)) {
        throw new Error(`Arweave wallet file not found: ${config.arweaveWalletPath}`);
      }
    }
  }
}
