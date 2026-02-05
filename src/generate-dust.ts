#!/usr/bin/env tsx
/**
 * Generate dust from unshielded tokens
 * 
 * Dust is NOT transferred - it's generated from registering unshielded UTXOs.
 * This script registers your unshielded coins for dust generation.
 */
import 'dotenv/config';
import * as bip39 from 'bip39';
import * as rx from 'rxjs';
import chalk from 'chalk';
import { initWalletWithSeed } from './utils/wallet.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';

async function main() {
    const mnemonic = process.argv.slice(2).join(' ').trim();

    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        console.log(chalk.red('Usage: npm run generate-dust "your mnemonic words..."'));
        process.exit(1);
    }

    console.log(chalk.cyan.bold('\n═══════════════════════════════════════════════════════'));
    console.log(chalk.cyan.bold('  Generating Dust from Unshielded Tokens'));
    console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════\n'));

    const seed = bip39.mnemonicToSeedSync(mnemonic).subarray(0, 32);

    console.log(chalk.yellow('1. Initializing wallet...'));
    const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await initWalletWithSeed(seed);

    try {
        console.log(chalk.yellow('2. Waiting for sync...'));
        await rx.firstValueFrom(wallet.state().pipe(rx.filter((s) => s.isSynced)));
        let state = await rx.firstValueFrom(wallet.state());
        console.log(chalk.green('   ✓ Synced\n'));

        // Check balances
        console.log(chalk.cyan('─── Current State ───'));
        const dustCoins = state.dust.totalCoins;
        const unshieldedCoins = state.unshielded.totalCoins;

        console.log(chalk.white('Dust coins:       ') +
            (dustCoins.length > 0 ? chalk.green(dustCoins.length.toString()) : chalk.red('0')));
        console.log(chalk.white('Unshielded UTXOs: ') +
            (unshieldedCoins.length > 0 ? chalk.green(unshieldedCoins.length.toString()) : chalk.red('0')));
        console.log(chalk.white('Dust address:     ') + chalk.gray(state.dust.dustAddress));
        console.log();

        if (dustCoins.length > 0) {
            console.log(chalk.green('✓ You already have dust! Ready to deploy.'));
            await wallet.stop();
            return;
        }

        if (unshieldedCoins.length === 0) {
            console.log(chalk.red('✗ No unshielded tokens to convert to dust.'));
            console.log(chalk.yellow('  Run: npm run fund "your mnemonic"'));
            await wallet.stop();
            process.exit(1);
        }

        // Register for dust generation
        console.log(chalk.yellow('3. Registering unshielded coins for dust generation...'));

        const availableCoins = state.unshielded.availableCoins;
        console.log(chalk.gray(`   Found ${availableCoins.length} available unshielded coins`));

        // Get the verifying key from the keystore
        const verifyingKey = unshieldedKeystore.getPublicKey();

        // Create the signing function
        const signDustRegistration = (payload: Uint8Array) => {
            return unshieldedKeystore.signData(payload);
        };

        try {
            // Register the UTXOs for dust generation
            const recipe = await wallet.registerNightUtxosForDustGeneration(
                availableCoins,
                verifyingKey,
                signDustRegistration,
                state.dust.dustAddress
            );

            console.log(chalk.yellow('4. Finalizing transaction...'));
            const finalizedTx = await wallet.finalizeTransaction(recipe);

            console.log(chalk.yellow('5. Submitting transaction...'));
            const txHash = await wallet.submitTransaction(finalizedTx);

            console.log(chalk.green.bold('\n✓ Dust generation registered!'));
            console.log(chalk.white('Transaction: ') + chalk.gray(txHash));
            console.log();
            console.log(chalk.yellow('⏳ Dust will accumulate over time. Wait a few seconds, then try deploying.'));

        } catch (err: any) {
            console.log(chalk.red('\n✗ Registration failed:'), err.message);

            if (err.message?.includes('139')) {
                console.log(chalk.yellow('\nError 139 usually means the transaction structure is invalid.'));
                console.log(chalk.gray('This might be a network/SDK version mismatch.'));
            }

            // Alternative: Try using the low-level dust wallet API
            console.log(chalk.yellow('\n→ Trying alternative approach via dust wallet directly...'));

            const ttl = new Date(Date.now() + 60 * 60 * 1000);
            const dustWallet = wallet.dust;

            // Get coins in the format dust wallet expects
            const coinsForDust = availableCoins.map(coin => ({
                ...coin.utxo,
                ctime: coin.meta.ctime
            }));

            const unprovenTx = await dustWallet.createDustGenerationTransaction(
                undefined,  // currentTime
                ttl,
                coinsForDust,
                verifyingKey,
                state.dust.dustAddress
            );

            // Get the intent and sign it
            const intent = unprovenTx.intents?.get(1);
            if (!intent) {
                throw new Error('Dust generation transaction missing intent segment 1');
            }

            const signatureData = intent.signatureData(1);
            const signature = signDustRegistration(signatureData);

            const provingRecipe = await dustWallet.addDustGenerationSignature(unprovenTx, signature);

            if (provingRecipe.type !== 'TransactionToProve') {
                throw new Error('Unexpected recipe type: ' + provingRecipe.type);
            }

            const finalized = await dustWallet.finalizeTransaction(provingRecipe);
            const txHash2 = await wallet.submitTransaction(finalized);

            console.log(chalk.green.bold('\n✓ Dust generation registered (alternative method)!'));
            console.log(chalk.white('Transaction: ') + chalk.gray(txHash2));
        }

    } catch (e: any) {
        console.log(chalk.red('\n❌ Error:'), e.message || e);
        console.error(e);
    } finally {
        await wallet.stop();
    }

    console.log(chalk.cyan.bold('\n═══════════════════════════════════════════════════════\n'));
}

main().catch(console.error);
