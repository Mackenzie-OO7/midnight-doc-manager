#!/usr/bin/env tsx
/**
 * Deploy script
 * Usage: npm run deploy "your 24 word mnemonic"
 *        npm run preprod "your 24 word mnemonic"   (sets MIDNIGHT_NETWORK=preprod)
 */
import 'dotenv/config';
import * as path from 'path';
import * as fs from 'fs';
import * as Rx from 'rxjs';
import chalk from 'chalk';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  initWalletWithSeed,
  mnemonicToSeed,
  NETWORK_ID,
  getShieldedAddress,
  registerForDustGeneration,
} from './utils/wallet.js';
import { EnvironmentManager } from './utils/environment.js';
import { configureProviders } from './providers/midnight-providers.js';
import { createWitnesses, createInitialPrivateState } from './api/witnesses.js';
import { createHash } from 'crypto';

const CONTRACT_NAME = 'document-manager';
const CONTRACT_TAG = 'document-manager';
const PRIVATE_STATE_ID = 'doc-manager-private-state';

async function main(): Promise<void> {
  console.log();
  console.log(chalk.blue.bold('='.repeat(60)));
  console.log(chalk.blue.bold('  Midnight Document Manager - Deployment'));
  console.log(chalk.blue.bold('='.repeat(60)));
  console.log();

  const mnemonic = process.argv.slice(2).join(' ').trim();
  if (!mnemonic) {
    console.error(chalk.red('Usage: npm run deploy "your twelve or twenty four mnemonic words"'));
    process.exit(2);
  }

  const networkConfig = EnvironmentManager.getNetworkConfig();
  console.log(chalk.gray(`Network: ${networkConfig.name}`));
  console.log();

  // Verify contract is compiled
  const contractModulePath = path.join(
    process.cwd(), 'contracts', 'managed', CONTRACT_NAME, 'contract', 'index.js',
  );
  if (!fs.existsSync(contractModulePath)) {
    console.error(chalk.red('Contract not compiled. Run: npm run compile'));
    process.exit(1);
  }

  const zkConfigPath = path.join(process.cwd(), 'contracts', 'managed', CONTRACT_NAME);

  // Build wallet from mnemonic
  console.log(chalk.gray('Building wallet...'));
  const seed = await mnemonicToSeed(mnemonic);
  const walletCtx = await initWalletWithSeed(seed);

  try {
    // Wait for sync
    console.log(chalk.gray('Syncing with network...'));
    await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));

    const shieldedAddress = getShieldedAddress(walletCtx.shieldedSecretKeys);
    console.log(chalk.cyan('Wallet address: ') + chalk.white(shieldedAddress));
    console.log();

    // Register UTXOs for dust generation (idempotent)
    console.log(chalk.gray('Registering for dust generation...'));
    await registerForDustGeneration(walletCtx);
    console.log(chalk.green('Dust registration complete'));
    console.log();

    // Configure providers
    const providers = await configureProviders(walletCtx, networkConfig, PRIVATE_STATE_ID);

    // Load compiled contract module
    const { Contract } = await import(contractModulePath);

    // Derive a stable 32-byte secret key from the mnemonic for ownership proofs
    const secretKeyBytes = new Uint8Array(
      createHash('sha256')
        .update('midnight-doc-manager:owner-key:')
        .update(seed)
        .digest(),
    );

    // Build CompiledContract with witnesses and ZK asset path
    const compiledContract = CompiledContract.make(CONTRACT_TAG, Contract).pipe(
      CompiledContract.withWitnesses(createWitnesses(secretKeyBytes)),
      CompiledContract.withCompiledFileAssets(zkConfigPath),
    );

    const initialPrivateState = createInitialPrivateState(secretKeyBytes);

    // Deploy using the SDK
    console.log(chalk.blue('Deploying contract (this may take 30-60 seconds)...'));

    const deployed = await deployContract(providers as any, {
      compiledContract: compiledContract as any,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState,
    });

    const contractAddress = deployed.deployTxData.public.contractAddress;

    // Save deployment info
    const deploymentInfo = {
      contractAddress,
      deployedAt: new Date().toISOString(),
      network: NETWORK_ID,
      contractName: CONTRACT_NAME,
    };

    fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));

    console.log();
    console.log(chalk.green.bold('='.repeat(60)));
    console.log(chalk.green.bold('  CONTRACT DEPLOYED SUCCESSFULLY!'));
    console.log(chalk.green.bold('='.repeat(60)));
    console.log();
    console.log(chalk.cyan('Contract Address:'));
    console.log(chalk.white(`  ${contractAddress}`));
    console.log();
    console.log(chalk.gray('Saved to deployment.json'));
    console.log();
  } finally {
    await walletCtx.wallet.stop();
  }
}

main().catch((err) => {
  console.error(chalk.red('Deployment failed:'), err);
  process.exit(1);
});
