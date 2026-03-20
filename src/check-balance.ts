#!/usr/bin/env tsx
/**
 * Check wallet balance and address.
 * Usage: npm run check-balance "your 24 word mnemonic phrase here"
 */
import 'dotenv/config';
import * as Rx from 'rxjs';
import chalk from 'chalk';
import {
  initWalletWithSeed,
  mnemonicToSeed,
  getShieldedAddress,
  getUnshieldedAddress,
  getDustBalance,
  NETWORK_ID,
} from './utils/wallet.js';
import { nativeToken } from '@midnight-ntwrk/ledger-v7';

async function main(): Promise<void> {
  console.log();
  console.log(chalk.blue.bold('='.repeat(60)));
  console.log(chalk.blue.bold('  Midnight Wallet - Balance Check'));
  console.log(chalk.blue.bold('='.repeat(60)));
  console.log();

  const mnemonic = process.argv.slice(2).join(' ').trim();
  if (!mnemonic) {
    console.error(chalk.red('Usage: npm run check-balance "your twelve or twenty four mnemonic words"'));
    process.exit(2);
  }

  console.log(chalk.gray(`Network: ${NETWORK_ID}`));
  console.log(chalk.gray('Syncing with network...'));

  const seed = await mnemonicToSeed(mnemonic);
  const walletCtx = await initWalletWithSeed(seed);

  try {
    const state = await Rx.firstValueFrom(
      walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
    );

    const shieldedAddress = getShieldedAddress(walletCtx.shieldedSecretKeys);
    const unshieldedAddress = getUnshieldedAddress(walletCtx.unshieldedKeystore);
    const unshieldedBalance: bigint = state.unshielded?.balances?.[nativeToken().raw] ?? 0n;
    const dustBalance = getDustBalance(state);

    console.log();
    console.log(chalk.cyan.bold('Shielded Address:'));
    console.log(chalk.white(`  ${shieldedAddress}`));
    console.log();
    console.log(chalk.cyan.bold('Unshielded Address:'));
    console.log(chalk.white(`  ${unshieldedAddress}`));
    console.log();
    console.log(
      chalk.yellow.bold('NIGHT Balance:  ') +
      (unshieldedBalance > 0n ? chalk.green.bold(unshieldedBalance.toString()) : chalk.red.bold('0')),
    );
    console.log(
      chalk.yellow.bold('DUST Balance:   ') +
      (dustBalance > 0n ? chalk.green.bold(dustBalance.toString()) : chalk.red.bold('0')),
    );
    console.log();

    if (unshieldedBalance === 0n && NETWORK_ID === 'undeployed') {
      console.log(chalk.gray('Fund this wallet using midnight-local-dev option [1] with this mnemonic in accounts.json'));
      console.log();
    } else if (unshieldedBalance === 0n) {
      console.log(chalk.gray('Get preprod tokens from the faucet: https://midnight.network/faucet'));
      console.log();
    }
  } finally {
    await walletCtx.wallet.stop();
  }
}

main().catch((err) => {
  console.error(chalk.red('Error:'), err);
  process.exit(1);
});
