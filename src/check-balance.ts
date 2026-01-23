import "dotenv/config";
import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { NetworkId as ZswapNetworkId } from "@midnight-ntwrk/zswap";
import { nativeToken } from "@midnight-ntwrk/ledger";
import { WebSocket } from "ws";
import * as Rx from "rxjs";
import chalk from "chalk";
import { EnvironmentManager } from "./utils/environment.js";

// Fix WebSocket for Node.js environment
// @ts-ignore
globalThis.WebSocket = WebSocket;

async function checkBalance() {
    try {
        console.log();
        console.log(chalk.blue.bold("━".repeat(60)));
        console.log(chalk.blue.bold("🌙  Wallet Balance Checker"));
        console.log(chalk.blue.bold("━".repeat(60)));
        console.log();

        const seed = process.env.WALLET_SEED;
        if (!seed) {
            throw new Error("WALLET_SEED not found in .env file");
        }

        console.log(chalk.gray("Building wallet..."));
        console.log();

        // Get network configuration
        const networkConfig = EnvironmentManager.getNetworkConfig();

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
            seed,
            zswapNetworkId,
            "info"
        );

        wallet.start();

        const state = await Rx.firstValueFrom(wallet.state());

        console.log(chalk.cyan.bold("📍 Wallet Address:"));
        console.log(chalk.white(`   ${state.address}`));
        console.log();

        const balance = state.balances[nativeToken()] || 0n;

        if (balance === 0n) {
            console.log(chalk.yellow.bold("💰 Balance: ") + chalk.red.bold("0 DUST"));
            console.log();
            console.log(chalk.red("❌ No funds detected."));
            console.log();
            console.log(chalk.magenta.bold("━".repeat(60)));
            console.log(chalk.magenta.bold("📝 How to Get Test Tokens:"));
            console.log(chalk.magenta.bold("━".repeat(60)));
            console.log();
            console.log(chalk.white("   1. ") + chalk.cyan("Visit: ") + chalk.underline("https://midnight.network/test-faucet"));
            console.log(chalk.white("   2. ") + chalk.cyan("Paste your wallet address (shown above)"));
            console.log(chalk.white("   3. ") + chalk.cyan("Request tokens from the faucet"));
            console.log(chalk.white("   4. ") + chalk.cyan("Wait 2-5 minutes for processing"));
            console.log(chalk.white("   5. ") + chalk.cyan("Run ") + chalk.yellow.bold("'npm run check-balance'") + chalk.cyan(" again"));
            console.log();
            console.log(chalk.gray("━".repeat(60)));
            console.log(chalk.gray("💡 Tip: Faucet transactions typically take 2-5 minutes to process."));
            console.log(chalk.gray("━".repeat(60)));
        } else {
            console.log(chalk.yellow.bold("💰 Balance: ") + chalk.green.bold(`${balance} DUST`));
            console.log();
            console.log(chalk.green.bold("✅ Wallet is funded and ready!"));
            console.log();
            console.log(chalk.magenta.bold("━".repeat(60)));
            console.log(chalk.magenta.bold("🚀 Next Step:"));
            console.log(chalk.magenta.bold("━".repeat(60)));
            console.log();
            console.log(chalk.cyan("   Deploy your contract with:"));
            console.log(chalk.yellow.bold("   npm run deploy"));
            console.log();
            console.log(chalk.gray("━".repeat(60)));
        }

        console.log();
        wallet.close();
        process.exit(0);
    } catch (error) {
        console.log();
        console.log(chalk.red.bold("❌ Error checking balance:"));
        console.error(chalk.red(error instanceof Error ? error.message : String(error)));
        console.log();
        process.exit(1);
    }
}

checkBalance();
