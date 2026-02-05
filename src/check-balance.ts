#!/usr/bin/env tsx
/**
 * Check wallet balance and address
 * Usage: npm run check-balance "your mnemonic words"
 */
import "dotenv/config";
import * as bip39 from 'bip39';
import * as rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { initWalletWithSeed } from './utils/wallet.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import chalk from 'chalk';

const SHIELDED_NATIVE_RAW = ledger.shieldedToken().raw;

async function main(): Promise<void> {
    console.log();
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log(chalk.blue.bold("🌙  Midnight Wallet - Balance Check"));
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log();

    // Get mnemonic from CLI argument
    const mnemonic = process.argv.slice(2).join(' ').trim();
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        console.error(chalk.red('Usage: npm run check-balance "your twelve or twenty four mnemonic words"'));
        console.error(chalk.gray('Get your mnemonic from Lace wallet: Settings → Recovery Phrase'));
        process.exit(2);
    }

    // Derive seed from mnemonic (first 32 bytes, same as Lace)
    const seed = bip39.mnemonicToSeedSync(mnemonic).subarray(0, 32);
    console.log(chalk.gray('🔐 Building wallet (same derivation as Lace)...'));

    const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await initWalletWithSeed(seed);
    await wallet.start(shieldedSecretKeys, dustSecretKey);

    // Wait for wallet to sync
    console.log(chalk.gray('⏳ Syncing with network...'));
    await rx.firstValueFrom(wallet.state().pipe(rx.filter((s) => s.isSynced)));
    const state = await rx.firstValueFrom(wallet.state());

    // Get addresses
    const shieldedAddress = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
    const unshieldedAddress = unshieldedKeystore.getBech32Address().toString();

    // Get balance
    const balance = state.shielded.balances[SHIELDED_NATIVE_RAW] ?? 0n;

    console.log();
    console.log(chalk.cyan.bold('📍 Shielded Address (for funding):'));
    console.log(chalk.white(`   ${shieldedAddress}`));
    console.log();
    console.log(chalk.cyan.bold('📍 Unshielded Address:'));
    console.log(chalk.white(`   ${unshieldedAddress}`));
    console.log();
    console.log(chalk.yellow.bold('💰 Shielded Balance: ') +
        (balance > 0n ? chalk.green.bold(balance.toString()) : chalk.red.bold('0')));
    console.log();

    if (balance === 0n) {
        console.log(chalk.gray('💡 To fund your wallet, run:'));
        console.log(chalk.cyan(`   npm run fund "${mnemonic.split(' ').slice(0, 3).join(' ')}..."`));
        console.log();
    }

    await wallet.stop();
}

main().catch((err) => {
    console.error(chalk.red('❌ Error:'), err);
    process.exit(1);
});
