#!/usr/bin/env tsx
/**
 * Fund script - funds a wallet on the undeployed local network
 * Uses the genesis wallet to transfer funds to the user's wallet
 * 
 * Usage:
 *   npm run fund "your twelve or twenty four mnemonic words"
 *   npm run fund mn_shield-addr_undeployed1...
 *   npm run fund mn_addr_undeployed1...
 */
import "dotenv/config";
import pino from 'pino';
import pinoPretty from 'pino-pretty';
import { initWalletWithSeed } from "./utils/wallet.js";
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import * as bip39 from 'bip39';
import { CombinedTokenTransfer } from "@midnight-ntwrk/wallet-sdk-facade";

const DEFAULT_LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';
const TRANSFER_AMOUNT = 31_337_000_000n; // Amount to transfer

interface CliInput {
    mnemonic?: string;
    shieldedAddress?: string;
    unshieldedAddress?: string;
}

function getReceiverFromArgs(): CliInput {
    const arg = process.argv.slice(2).join(' ').trim();

    const printUsage = () => {
        console.error(`
Usage:
  npm run fund "<mnemonic words>"
  npm run fund mn_shield-addr_undeployed...
  npm run fund mn_addr_undeployed...

Accepted inputs:
  • BIP-39 mnemonic (space-separated words) - funds both shielded and unshielded
  • Shielded address for the 'undeployed' network
  • Unshielded address for the 'undeployed' network

Examples:
  npm run fund "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
  npm run fund mn_shield-addr_undeployed1...
`);
    };

    if (!arg) {
        console.error('No argument provided.');
        printUsage();
        process.exit(2);
    }

    // Check if it's a mnemonic
    if (bip39.validateMnemonic(arg)) {
        return { mnemonic: arg };
    }

    // Check if it's an address
    const isShielded = arg.startsWith('mn_shield-addr');
    const isUnshielded = arg.startsWith('mn_addr_');

    if (isShielded || isUnshielded) {
        const expectedPrefix = isShielded
            ? 'mn_shield-addr_undeployed'
            : 'mn_addr_undeployed';

        if (!arg.startsWith(expectedPrefix)) {
            const providedNetwork = arg
                .replace(isShielded ? 'mn_shield-addr_' : 'mn_addr_', '')
                .split('1')[0];

            console.error(
                `Unsupported network in address: '${providedNetwork}'.\n` +
                `This script supports ONLY the 'undeployed' network.\n` +
                `Expected prefix: ${expectedPrefix}...`
            );
            process.exit(2);
        }

        return isShielded
            ? { shieldedAddress: arg }
            : { unshieldedAddress: arg };
    }

    console.error(`Invalid argument provided.\n\nReceived:\n  ${arg.slice(0, 60)}${arg.length > 60 ? '...' : ''}`);
    printUsage();
    process.exit(2);
}

function createLogger() {
    const pretty = pinoPretty({
        colorize: true,
        sync: true,
    });

    return pino({ level: DEFAULT_LOG_LEVEL }, pretty);
}

interface Stoppable {
    stop(): Promise<void>;
}

async function main(): Promise<void> {
    const logger = createLogger();
    let cliInput = getReceiverFromArgs();
    let stoppable: Stoppable[] = [];

    // If mnemonic provided, derive the addresses
    if (cliInput.mnemonic) {
        const seed: Buffer = await bip39.mnemonicToSeed(cliInput.mnemonic);
        // Take first 32 bytes to match Lace Wallet derivation
        const takeSeed = seed.subarray(0, 32);
        const receiver = await initWalletWithSeed(takeSeed);
        stoppable.push(receiver.wallet);

        const shieldedAddress: string = await rx.firstValueFrom(
            receiver.wallet.state().pipe(
                rx.filter((s) => s.isSynced),
                rx.map((s) => MidnightBech32m.encode('undeployed', s.shielded.address).toString()),
            ),
        );
        const unshieldedAddress: string = receiver.unshieldedKeystore.getBech32Address().toString();

        cliInput.shieldedAddress = shieldedAddress;
        cliInput.unshieldedAddress = unshieldedAddress;
        logger.info({ shieldedAddress, unshieldedAddress }, 'Derived receiver addresses from mnemonic');
    }

    try {
        // Genesis wallet seed (pre-funded on local network)
        const genesisWalletSeed = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
        const sender = await initWalletWithSeed(genesisWalletSeed);
        await rx.firstValueFrom(sender.wallet.state().pipe(rx.filter((s) => s.isSynced)));
        stoppable.push(sender.wallet);

        logger.info('Wallet setup complete');

        // Build transfer outputs
        const outputs: CombinedTokenTransfer[] = [];

        if (cliInput.unshieldedAddress) {
            outputs.push({
                type: 'unshielded',
                outputs: [
                    {
                        amount: TRANSFER_AMOUNT,
                        receiverAddress: cliInput.unshieldedAddress,
                        type: ledger.unshieldedToken().raw,
                    },
                ],
            });
        }

        if (cliInput.shieldedAddress) {
            outputs.push({
                type: 'shielded',
                outputs: [
                    {
                        amount: TRANSFER_AMOUNT,
                        receiverAddress: cliInput.shieldedAddress,
                        type: ledger.shieldedToken().raw,
                    },
                ],
            });
        }

        // Create and submit transfer transaction
        const recipe = await sender.wallet.transferTransaction(
            sender.shieldedSecretKeys,
            sender.dustSecretKey,
            outputs,
            new Date(Date.now() + 30 * 60 * 1000),
        );

        const tx = await sender.wallet.signTransaction(
            recipe.transaction,
            (payload) => sender.unshieldedKeystore.signData(payload)
        );

        logger.info('Transfer recipe created');

        const transaction = await sender.wallet.finalizeTransaction({
            type: 'TransactionToProve',
            transaction: tx
        });

        logger.info('Transaction proof generated');

        const txHash = await sender.wallet.submitTransaction(transaction);
        logger.info({ txHash }, 'Transaction submitted');

    } catch (err) {
        logger.error({ err }, 'Error while preparing/submitting transfer transaction');
        process.exitCode = 1;
    } finally {
        for (const wallet of stoppable) {
            if (wallet) {
                await wallet.stop();
            }
        }
    }
}

main().catch((err) => {
    console.error('Unhandled error in main:', err);
    process.exit(1);
});
