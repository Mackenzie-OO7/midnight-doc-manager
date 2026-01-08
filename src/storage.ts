import { PinataSDK } from "pinata";
import Arweave from "arweave";
import * as fs from "fs";
import { EnvironmentManager, StorageConfig } from "./utils/environment.js";

/**
 * Storage provider interface
 */
export interface StorageProvider {
    /** Upload data and return the storage ID (CID for IPFS, TxId for Arweave) */
    upload(data: Buffer, metadata?: Record<string, string>): Promise<string>;
    /** Download data by storage ID */
    download(storageId: string): Promise<Buffer>;
    /** Get the gateway URL for a storage ID */
    getGatewayUrl(storageId: string): string;
    /** Delete/unpin data (not supported by Arweave) */
    delete?(storageId: string): Promise<void>;
}

/**
 * Upload result with additional metadata
 */
export interface UploadResult {
    storageId: string;
    gatewayUrl: string;
    provider: "ipfs" | "arweave";
}

/**
 * Pinata (IPFS)
 */
export class PinataStorage implements StorageProvider {
    private sdk: PinataSDK;
    private gatewayUrl: string;

    constructor(jwt: string, gatewayUrl: string) {
        this.sdk = new PinataSDK({ pinataJwt: jwt });
        this.gatewayUrl = gatewayUrl.replace(/\/$/, "");
    }

    async upload(
        data: Buffer,
        metadata?: Record<string, string>
    ): Promise<string> {
        try {
            // Create a Blob from the buffer data
            const blob = new Blob([new Uint8Array(data)], {
                type: metadata?.contentType || "application/octet-stream"
            });

            // Create a File from the Blob
            const file = new File([blob], metadata?.filename || "document", {
                type: metadata?.contentType || "application/octet-stream",
            });

            const result = await this.sdk.upload.file(file, {
                metadata: {
                    name: metadata?.name || "Encrypted Document",
                    keyvalues: metadata || {},
                },
            });

            return result.cid;
        } catch (error) {
            throw new Error(
                `Failed to upload to IPFS: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    async download(cid: string): Promise<Buffer> {
        try {
            const response = await fetch(`${this.gatewayUrl}/${cid}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);
        } catch (error) {
            throw new Error(
                `Failed to download from IPFS: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    getGatewayUrl(cid: string): string {
        return `${this.gatewayUrl}/${cid}`;
    }

    async delete(cid: string): Promise<void> {
        try {
            await this.sdk.files.delete([cid]);
        } catch (error) {
            throw new Error(
                `Failed to unpin from IPFS: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

/**
 * Arweave
 */
export class ArweaveStorage implements StorageProvider {
    private arweave: Arweave;
    private wallet: any;
    private gatewayUrl: string;

    constructor(walletPath: string, gatewayUrl: string) {
        this.arweave = Arweave.init({
            host: "arweave.net",
            port: 443,
            protocol: "https",
        });
        this.gatewayUrl = gatewayUrl.replace(/\/$/, "");

        // Load wallet from file
        if (fs.existsSync(walletPath)) {
            const walletData = fs.readFileSync(walletPath, "utf-8");
            this.wallet = JSON.parse(walletData);
        } else {
            throw new Error(`Arweave wallet not found: ${walletPath}`);
        }
    }

    async upload(
        data: Buffer,
        metadata?: Record<string, string>
    ): Promise<string> {
        try {
            const transaction = await this.arweave.createTransaction(
                { data },
                this.wallet
            );

            transaction.addTag("Content-Type", metadata?.contentType || "application/octet-stream");
            transaction.addTag("App-Name", "Midnight-Doc-Manager");
            if (metadata?.name) {
                transaction.addTag("Document-Name", metadata.name);
            }

            await this.arweave.transactions.sign(transaction, this.wallet);
            const response = await this.arweave.transactions.post(transaction);

            if (response.status !== 200 && response.status !== 202) {
                throw new Error(`Arweave returned status ${response.status}`);
            }

            return transaction.id;
        } catch (error) {
            throw new Error(
                `Failed to upload to Arweave: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    async download(txId: string): Promise<Buffer> {
        try {
            const data = await this.arweave.transactions.getData(txId, {
                decode: true,
            });

            if (typeof data === "string") {
                return Buffer.from(data);
            }
            return Buffer.from(data as Uint8Array);
        } catch (error) {
            throw new Error(
                `Failed to download from Arweave: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    getGatewayUrl(txId: string): string {
        return `${this.gatewayUrl}/${txId}`;
    }

    // Arweave is permanent storage so delete is not supported
    // delete method is intentionally not implemented
}

/**
 * Get storage provider based on environment configuration
 */
export function getStorageProvider(config?: StorageConfig): StorageProvider {
    const storageConfig = config || EnvironmentManager.getStorageConfig();

    if (storageConfig.provider === "arweave") {
        if (!storageConfig.arweaveWalletPath) {
            throw new Error("ARWEAVE_WALLET_PATH is required for Arweave storage");
        }
        return new ArweaveStorage(
            storageConfig.arweaveWalletPath,
            storageConfig.arweaveGateway
        );
    }

    // Default to IPFS/Pinata
    if (!storageConfig.pinataJwt) {
        throw new Error("PINATA_JWT is required for IPFS storage");
    }
    return new PinataStorage(storageConfig.pinataJwt, storageConfig.pinataGateway);
}

/**
 * Upload data to configured storage provider
 * @param data - Data to upload
 * @param metadata - Optional metadata
 * @returns Upload result with storage ID and gateway URL
 */
export async function uploadToStorage(
    data: Buffer,
    metadata?: Record<string, string>
): Promise<UploadResult> {
    const config = EnvironmentManager.getStorageConfig();
    const provider = getStorageProvider(config);
    const storageId = await provider.upload(data, metadata);

    return {
        storageId,
        gatewayUrl: provider.getGatewayUrl(storageId),
        provider: config.provider,
    };
}

/**
 * Download data from configured storage provider
 * @param storageId - Storage ID (CID or TxId)
 * @returns Downloaded data
 */
export async function downloadFromStorage(storageId: string): Promise<Buffer> {
    const provider = getStorageProvider();
    return provider.download(storageId);
}

/**
 * Get gateway URL for a storage ID
 * @param storageId - Storage ID
 * @returns Gateway URL
 */
export function getGatewayUrl(storageId: string): string {
    const provider = getStorageProvider();
    return provider.getGatewayUrl(storageId);
}
