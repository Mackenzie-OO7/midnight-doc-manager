#!/usr/bin/env node
/**
 * Deploy script
 */
import "dotenv/config";
import { deployContract } from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { nativeToken, Transaction } from "@midnight-ntwrk/ledger";
import { NetworkId as ZswapNetworkId } from "@midnight-ntwrk/zswap";
import { WebSocket } from "ws";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { MidnightProviders } from "./providers/midnight-providers.js";
import { EnvironmentManager } from "./utils/environment.js";
import { createInitialPrivateState, deriveSecretKeyFromWalletSeed } from "./api/witnesses.js";

// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

const CONTRACT_NAME = "document-manager";

async function main() {
    console.log();
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log(chalk.blue.bold("🌙  Midnight Document Manager - Deployment"));
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log();

    try {
        // Validate environment
        EnvironmentManager.validateEnvironment();

        const networkConfig = EnvironmentManager.getNetworkConfig();
        const network = process.env.MIDNIGHT_NETWORK || "preview";

        setNetworkId(network as any);

        // Check if contract is compiled
        if (!EnvironmentManager.checkContractCompiled(CONTRACT_NAME)) {
            console.error(chalk.red("❌ Contract not compiled! Run: npm run compile"));
            process.exit(1);
        }

        const walletSeed = process.env.WALLET_SEED!;

        console.log(chalk.gray("🔐 Initializing wallet..."));

        const walletModule = await import("@midnight-ntwrk/wallet");
        const { WalletBuilder } = walletModule;

        // Determine the correct network ID based on MIDNIGHT_NETWORK
        const networkType = process.env.MIDNIGHT_NETWORK || "preview";
        const zswapNetworkId = networkType === "undeployed"
            ? ZswapNetworkId.Undeployed
            : ZswapNetworkId.TestNet;

        // Build wallet from seed
        const wallet = await WalletBuilder.buildFromSeed(
            networkConfig.indexer,
            networkConfig.indexerWS,
            networkConfig.proofServer,
            networkConfig.node,
            walletSeed,
            zswapNetworkId,
            "info"
        );

        wallet.start();

        // Wait for initial state
        const waitForState = () => new Promise<any>((resolve) => {
            const sub = wallet.state().subscribe((state: any) => {
                if (state.syncProgress?.synced) {
                    sub.unsubscribe();
                    resolve(state);
                }
            });
        });

        console.log(chalk.gray("⏳ Syncing wallet..."));
        const state = await waitForState();

        console.log(chalk.cyan.bold("📍 Wallet Address:"));
        console.log(chalk.white(`   ${state.address}`));
        console.log();

        let balance = state.balances[nativeToken()] || 0n;

        if (balance === 0n) {
            console.log(chalk.yellow.bold("💰 Balance: ") + chalk.red.bold("0 tDUST"));
            console.log();
            console.log(chalk.red.bold("❌ Wallet needs funding to deploy contracts."));
            console.log();
            console.log(chalk.magenta.bold("📝 Get test tokens:"));
            console.log(chalk.cyan("   https://faucet.midnight.network"));
            console.log();
            console.log(chalk.blue("⏳ Waiting for funds..."));

            // Wait for funds
            await new Promise<void>((resolve) => {
                const sub = wallet.state().subscribe((s: any) => {
                    const bal = s.balances[nativeToken()] || 0n;
                    if (bal > 0n) {
                        balance = bal;
                        sub.unsubscribe();
                        resolve();
                    }
                });
            });
        }

        console.log(chalk.yellow.bold("💰 Balance: ") + chalk.green.bold(`${balance} tDUST`));
        console.log();

        // Load compiled contract
        console.log(chalk.gray("📦 Loading contract..."));
        const contractPath = path.join(process.cwd(), "contracts");
        const contractModulePath = path.join(
            contractPath,
            "managed",
            CONTRACT_NAME,
            "contract",
            "index.js"
        );

        const DocumentManagerModule = await import(contractModulePath);

        // Create initial private state with derived secret key
        const secretKey = deriveSecretKeyFromWalletSeed(walletSeed);
        const initialPrivateState = createInitialPrivateState(secretKey);

        const contractInstance = new DocumentManagerModule.Contract({
            secretKey: () => secretKey,
        });

        // Create wallet provider
        const walletState = await new Promise<any>((resolve) => {
            wallet.state().subscribe((s: any) => resolve(s)).unsubscribe();
        });

        const walletProvider = {
            coinPublicKey: walletState.coinPublicKey,
            encryptionPublicKey: walletState.encryptionPublicKey,
            async balanceTx(tx: any, newCoins: any) {
                const balanced = await wallet.balanceTransaction(tx, newCoins);
                return balanced;
            },
            async submitTx(tx: any) {
                return wallet.submitTransaction(tx);
            },
        };

        // Configure providers
        console.log(chalk.gray("⚙️  Setting up providers..."));
        const providers = MidnightProviders.create({
            contractName: CONTRACT_NAME,
            walletProvider,
            networkConfig,
            privateStateStoreName: "document-manager-state",
        });

        // Deploy contract
        console.log(chalk.blue("🚀 Deploying contract (30-60 seconds)..."));
        console.log();

        const deployed = await deployContract(providers, {
            contract: contractInstance,
            privateStateId: "documentManagerState",
            initialPrivateState,
        });

        const contractAddress = deployed.deployTxData.public.contractAddress;

        // Save deployment info
        console.log();
        console.log(chalk.green.bold("━".repeat(60)));
        console.log(chalk.green.bold("🎉 CONTRACT DEPLOYED SUCCESSFULLY!"));
        console.log(chalk.green.bold("━".repeat(60)));
        console.log();
        console.log(chalk.cyan.bold("📍 Contract Address:"));
        console.log(chalk.white(`   ${contractAddress}`));
        console.log();

        const info = {
            contractAddress,
            deployedAt: new Date().toISOString(),
            network: networkConfig.name,
            contractName: CONTRACT_NAME,
        };

        fs.writeFileSync("deployment.json", JSON.stringify(info, null, 2));
        console.log(chalk.gray("✅ Saved to deployment.json"));
        console.log();

        // Close wallet
        await wallet.close();
    } catch (error) {
        console.log();
        console.log(chalk.red.bold("❌ Deployment Failed:"));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        if (error instanceof Error && error.stack) {
            console.error(chalk.gray(error.stack));
        }
        console.log();
        process.exit(1);
    }
}

main().catch(console.error);
