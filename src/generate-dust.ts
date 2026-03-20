#!/usr/bin/env tsx
/**
 * Generate dust from unshielded tokens. For preprod use only —
 * midnight-local-dev handles dust registration automatically on local.
 *
 * Usage: npm run generate-dust "your mnemonic words"
 */
import 'dotenv/config';
import * as Rx from 'rxjs';
import chalk from 'chalk';
import { initWalletWithSeed, mnemonicToSeed, getDustBalance, NETWORK_ID, registerForDustGeneration } from './utils/wallet.js';
import { nativeToken } from '@midnight-ntwrk/ledger-v7';

async function main() {
  const mnemonic = process.argv.slice(2).join(' ').trim();

  if (!mnemonic) {
    console.log(chalk.red('Usage: npm run generate-dust "your mnemonic words..."'));
    process.exit(1);
  }

  console.log(chalk.cyan.bold('\n' + '='.repeat(57)));
  console.log(chalk.cyan.bold('  Generating Dust from Unshielded Tokens'));
  console.log(chalk.cyan.bold('='.repeat(57) + '\n'));
  console.log(chalk.gray(`Network: ${NETWORK_ID}`));
  console.log();

  console.log(chalk.yellow('1. Initializing wallet...'));
  const seed = await mnemonicToSeed(mnemonic);
  const walletCtx = await initWalletWithSeed(seed);

  try {
    console.log(chalk.yellow('2. Waiting for sync...'));
    const state = await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
    );
    console.log(chalk.green('   Synced\n'));

    const unshieldedBalance: bigint = state.unshielded?.balances?.[nativeToken().raw] ?? 0n;
    const dustBalance = getDustBalance(state);

    console.log(chalk.white('Unshielded balance: ') +
      (unshieldedBalance > 0n ? chalk.green(unshieldedBalance.toString()) : chalk.red('0')));
    console.log(chalk.white('Dust balance:       ') +
      (dustBalance > 0n ? chalk.green(dustBalance.toString()) : chalk.red('0')));
    console.log();

    if (dustBalance > 0n) {
      console.log(chalk.green('You already have dust. Ready to deploy.'));
      return;
    }

    if (unshieldedBalance === 0n) {
      console.log(chalk.red('No unshielded tokens found. Fund this wallet first.'));
      process.exit(1);
    }

    console.log(chalk.yellow('3. Registering UTXOs for dust generation...'));
    await registerForDustGeneration(walletCtx);
    console.log(chalk.green('   Registration submitted'));
    console.log();

    console.log(chalk.yellow('Waiting for dust to appear (up to 60 seconds)...'));
    const dustState = await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(
        Rx.filter((s) => getDustBalance(s) > 0n),
        Rx.timeout(60_000),
      ),
    );

    const finalDust = getDustBalance(dustState);
    console.log(chalk.green.bold(`\nDust balance: ${finalDust}`));
    console.log(chalk.green('Ready to deploy.'));

  } catch (e: any) {
    if (e?.name === 'TimeoutError') {
      console.log(chalk.yellow('\nDust not yet visible - it may take a few more blocks.'));
      console.log(chalk.gray('Try running deploy in a moment.'));
    } else {
      console.error(chalk.red('\nError:'), e?.message ?? e);
    }
  } finally {
    await walletCtx.wallet.stop();
  }

  console.log(chalk.cyan.bold('\n' + '='.repeat(57) + '\n'));
}

main().catch(console.error);
