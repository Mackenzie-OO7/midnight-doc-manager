/**
 * Document Manager Contract API
 * 
 * Note: Full wallet SDK integration pending. Can't find much info on v3.0.0.
 * Current implementation supports off-chain operations (encryption, IPFS upload).
 * On-chain operations will be fixed as soon as i can find resources.
 */
import "dotenv/config";
import {
    findDeployedContract,
    deployContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import { EnvironmentManager } from "../utils/environment.js";
import {
    createWitnesses,
    createInitialPrivateState,
    deriveSecretKeyFromWalletSeed,
} from "./witnesses.js";

// @ts-ignore
globalThis.WebSocket = WebSocket;

const CONTRACT_NAME = "document-manager";

/**
 * Deployment info
 */
export interface DeploymentInfo {
    contractAddress: string;
    deployedAt: string;
    network: string;
    contractName: string;
}

/**
 * Document Manager contract wrapper
 */
export class DocumentManagerContract {
    private contract: any = null;
    private secretKey: Uint8Array;
    private networkConfig: ReturnType<typeof EnvironmentManager.getNetworkConfig>;
    private walletAddress: string = "";
    private isConnected: boolean = false;

    constructor(secretKey: Uint8Array) {
        this.secretKey = secretKey;
        this.networkConfig = EnvironmentManager.getNetworkConfig();
    }

    /**
     * Initialize and connect to the network
     */
    async connect(): Promise<string> {
        const network = process.env.MIDNIGHT_NETWORK || "preview";
        setNetworkId(network as any);

        const walletSeed = process.env.WALLET_SEED;
        if (!walletSeed) {
            throw new Error("WALLET_SEED not set");
        }

        const prefix = network === "preview"
            ? "mn_shield-addr_preview"
            : "mn_shield-addr_undeployed";

        this.walletAddress = `${prefix}${walletSeed.slice(0, 24)}...`;
        this.isConnected = true;

        return this.walletAddress;
    }

    /**
     * Get wallet balance (this needs full wallet SDK)
     */
    async getBalance(): Promise<bigint> {
        return 1000000n; // Placeholder
    }

    /**
     * Wait for sync
     */
    async waitForSync(): Promise<void> {
        if (!this.isConnected) throw new Error("Not connected");
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    /**
     * Deploy contract (placeholder) needs wallet SDK)
     */
    async deploy(): Promise<DeploymentInfo> {
        if (!this.isConnected) throw new Error("Not connected");

        console.log("Note: Full deployment requires wallet SDK integration (pending v3.0.0 examples)");
        const contractAddress = `contract_${Date.now().toString(36)}`;

        const info: DeploymentInfo = {
            contractAddress,
            deployedAt: new Date().toISOString(),
            network: this.networkConfig.name,
            contractName: CONTRACT_NAME,
        };

        fs.writeFileSync("deployment.json", JSON.stringify(info, null, 2));
        return info;
    }

    /**
     * Connect to deployed contract
     */
    async connectToDeployed(contractAddress: string): Promise<void> {
        if (!this.isConnected) throw new Error("Not connected");

        const contractModulePath = path.join(
            process.cwd(), "contracts", "managed", CONTRACT_NAME, "contract", "index.js"
        );

        try {
            const ContractModule = await import(contractModulePath);
            const witnesses = createWitnesses(this.secretKey);
            this.contract = new ContractModule.Contract(witnesses);
            console.log("Contract loaded (off-chain mode)");
        } catch (error) {
            console.error("Failed to load contract:", error);
            throw error;
        }
    }

    loadDeploymentInfo(): DeploymentInfo | null {
        const deploymentPath = path.join(process.cwd(), "deployment.json");
        if (!fs.existsSync(deploymentPath)) return null;
        return JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
    }

    // Contract methods (placeholders needs wallet SDK)
    async registerDocument(documentId: Uint8Array, contentHash: Uint8Array, storageCid: string, ownerCommitment: Uint8Array, fileType: string): Promise<void> {
        if (!this.contract) throw new Error("Contract not connected");
        console.log(`[Off-chain] Would register document: ${Buffer.from(documentId).toString('hex').slice(0, 16)}...`);
    }

    async verifyDocument(documentId: Uint8Array, providedHash: Uint8Array): Promise<boolean> {
        if (!this.contract) throw new Error("Contract not connected");
        return true;
    }

    async updateDocument(documentId: Uint8Array, newContentHash: Uint8Array, newStorageCid: string): Promise<void> {
        if (!this.contract) throw new Error("Contract not connected");
    }

    async deactivateDocument(documentId: Uint8Array): Promise<void> {
        if (!this.contract) throw new Error("Contract not connected");
    }

    async grantAccess(documentId: Uint8Array, recipientCommitment: Uint8Array, encryptedKey: string, nonce: string, senderPublicKey: string): Promise<void> {
        if (!this.contract) throw new Error("Contract not connected");
    }

    async revokeAccess(documentId: Uint8Array, recipientCommitment: Uint8Array): Promise<void> {
        if (!this.contract) throw new Error("Contract not connected");
    }

    async hasAccess(documentId: Uint8Array, recipientCommitment: Uint8Array): Promise<boolean> {
        if (!this.contract) throw new Error("Contract not connected");
        return false;
    }

    async getAccessGrant(documentId: Uint8Array, recipientCommitment: Uint8Array): Promise<any> {
        if (!this.contract) throw new Error("Contract not connected");
        return null;
    }

    async getDocument(documentId: Uint8Array): Promise<any> {
        if (!this.contract) throw new Error("Contract not connected");
        return null;
    }

    async close(): Promise<void> {
        this.isConnected = false;
        this.contract = null;
    }
}

/**
 * Create a contract instance
 */
export function createDocumentManager(): DocumentManagerContract {
    const walletSeed = process.env.WALLET_SEED;
    if (!walletSeed) {
        throw new Error("WALLET_SEED not set in environment");
    }
    const secretKey = deriveSecretKeyFromWalletSeed(walletSeed);
    return new DocumentManagerContract(secretKey);
}
