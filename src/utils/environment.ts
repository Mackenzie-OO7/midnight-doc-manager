import fs from "fs";
import path from "path";
import { NetworkConfig } from "../providers/midnight-providers.js";

/**
 * Storage provider configuration
 */
export interface StorageConfig {
  provider: "ipfs" | "arweave";
  // IPFS/Pinata settings
  pinataJwt?: string;
  pinataGateway: string;
  // Arweave settings
  arweaveWalletPath?: string;
  arweaveGateway: string;
}

/**
 * Complete application configuration
 */
export interface AppConfig {
  network: NetworkConfig;
  storage: StorageConfig;
  contractName: string;
  contractAddress?: string;
  walletSeed: string;
  debugLevel: string;
}

/**
 * Environment configuration manager
 */
export class EnvironmentManager {
  /**
   * Get network configuration based on MIDNIGHT_NETWORK env var
   */
  static getNetworkConfig(): NetworkConfig {
    const network = process.env.MIDNIGHT_NETWORK || "preview";

    const networks: Record<string, NetworkConfig> = {
      preview: {
        indexer:
          process.env.MIDNIGHT_INDEXER_URL ||
          "https://indexer.preview.midnight.network/api/v3/graphql",
        indexerWS:
          process.env.MIDNIGHT_INDEXER_WS_URL ||
          "wss://indexer.preview.midnight.network/api/v3/graphql",
        node:
          process.env.MIDNIGHT_NODE_URL ||
          "https://rpc.preview.midnight.network",
        proofServer: process.env.PROOF_SERVER_URL || "http://127.0.0.1:6300",
        name: "Preview",
      },
      undeployed: {
        indexer:
          process.env.MIDNIGHT_INDEXER_URL ||
          "http://127.0.0.1:8088/api/v1/graphql",
        indexerWS:
          process.env.MIDNIGHT_INDEXER_WS_URL ||
          "ws://127.0.0.1:8088/api/v1/graphql/ws",
        node: process.env.MIDNIGHT_NODE_URL || "http://127.0.0.1:9944",
        proofServer: process.env.PROOF_SERVER_URL || "http://127.0.0.1:6300",
        name: "Undeployed (Local)",
      },
    };

    return networks[network] || networks.testnet;
  }

  /**
   * Get storage provider configuration
   */
  static getStorageConfig(): StorageConfig {
    const provider = (process.env.STORAGE_PROVIDER || "ipfs") as
      | "ipfs"
      | "arweave";

    return {
      provider,
      // IPFS/Pinata
      pinataJwt: process.env.PINATA_JWT,
      pinataGateway:
        process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud/ipfs",
      // Arweave
      arweaveWalletPath: process.env.ARWEAVE_WALLET_PATH,
      arweaveGateway: process.env.ARWEAVE_GATEWAY || "https://arweave.net",
    };
  }

  /**
   * Get complete application configuration
   */
  static getAppConfig(): AppConfig {
    return {
      network: this.getNetworkConfig(),
      storage: this.getStorageConfig(),
      contractName: process.env.CONTRACT_NAME || "document-manager",
      contractAddress: process.env.CONTRACT_ADDRESS || undefined,
      walletSeed: process.env.WALLET_SEED || "",
      debugLevel: process.env.DEBUG_LEVEL || "info",
    };
  }

  /**
   * Validate required environment variables
   */
  static validateEnvironment(): void {
    const required = ["WALLET_SEED"];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`
      );
    }

    const walletSeed = process.env.WALLET_SEED!;
    if (!/^[a-fA-F0-9]{64}$/.test(walletSeed)) {
      throw new Error("WALLET_SEED must be a 64-character hexadecimal string");
    }
  }

  /**
   * Validate storage configuration
   */
  static validateStorageConfig(): void {
    const config = this.getStorageConfig();

    if (config.provider === "ipfs" && !config.pinataJwt) {
      throw new Error(
        "PINATA_JWT is required when using IPFS storage provider"
      );
    }

    if (config.provider === "arweave") {
      if (!config.arweaveWalletPath) {
        throw new Error(
          "ARWEAVE_WALLET_PATH is required when using Arweave storage provider"
        );
      }
      if (!fs.existsSync(config.arweaveWalletPath)) {
        throw new Error(
          `Arweave wallet file not found: ${config.arweaveWalletPath}`
        );
      }
    }
  }

  /**
   * Check if a contract is compiled
   */
  static checkContractCompiled(contractName: string): boolean {
    const contractPath = path.join(
      process.cwd(),
      "contracts",
      "managed",
      contractName
    );
    const keysPath = path.join(contractPath, "keys");
    const contractModulePath = path.join(contractPath, "contract", "index.js");

    return fs.existsSync(keysPath) && fs.existsSync(contractModulePath);
  }

  /**
   * Get deployment info if exists
   */
  static getDeploymentInfo(): {
    contractAddress: string;
    deployedAt: string;
    network: string;
    contractName: string;
  } | null {
    const deploymentPath = path.join(process.cwd(), "deployment.json");
    if (!fs.existsSync(deploymentPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  }

  /**
   * Print configuration summary (for debugging)
   */
  static printConfig(): void {
    const config = this.getAppConfig();
    console.log("┌─ Configuration ─────────────────────────────────────");
    console.log(`│ Network:    ${config.network.name}`);
    console.log(`│ Storage:    ${config.storage.provider.toUpperCase()}`);
    console.log(`│ Contract:   ${config.contractName}`);
    if (config.contractAddress) {
      console.log(`│ Address:    ${config.contractAddress}`);
    }
    console.log("└─────────────────────────────────────────────────────");
  }
}
