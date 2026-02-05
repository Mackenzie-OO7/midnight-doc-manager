#!/usr/bin/env tsx
/**
 * Deploy script - uses mnemonic argument for Lace-compatible wallet
 * Run: npm run deploy "your 24 word mnemonic"
 */
import "dotenv/config";
import * as bip39 from 'bip39';
import * as rx from 'rxjs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import * as fs from 'fs';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { initWalletWithSeed, NETWORK_ID } from './utils/wallet.js';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import chalk from 'chalk';

const SHIELDED_NATIVE_RAW = ledger.shieldedToken().raw;
const TTL_MS = 30 * 60 * 1000;
const WAIT_FOR_FUNDS_MS = 90_000;
const WAIT_POLL_MS = 3_000;
const CONTRACT_NAME = "document-manager";

async function main(): Promise<void> {
    console.log();
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log(chalk.blue.bold("🌙  Midnight Document Manager - Deployment"));
    console.log(chalk.blue.bold("━".repeat(60)));
    console.log();

    // Get mnemonic from CLI argument
    const mnemonic = process.argv.slice(2).join(' ').trim();
    if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
        console.error(chalk.red('Usage: npm run deploy "your twelve or twenty four mnemonic words"'));
        console.error(chalk.gray('Get your mnemonic from Lace wallet: Settings → Recovery Phrase'));
        process.exit(2);
    }

    // Derive seed from mnemonic
    const seed = bip39.mnemonicToSeedSync(mnemonic).subarray(0, 32);
    console.log(chalk.gray('🔐 Building wallet (same derivation as Lace)...'));

    const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await initWalletWithSeed(seed);
    await wallet.start(shieldedSecretKeys, dustSecretKey);

    // Wait for wallet to sync
    await rx.firstValueFrom(wallet.state().pipe(rx.filter((s) => s.isSynced)));
    let state = await rx.firstValueFrom(wallet.state());

    const shieldedAddress = MidnightBech32m.encode('undeployed', state.shielded.address).toString();
    console.log(chalk.cyan.bold('📍 Wallet Address (matches Lace):'));
    console.log(chalk.white(`   ${shieldedAddress}`));
    console.log();

    // Check balance
    let balance = state.shielded.balances[SHIELDED_NATIVE_RAW] ?? 0n;
    if (balance === 0n) {
        console.log(chalk.yellow('💰 Balance is 0. Waiting for funds...'));
        console.log(chalk.gray(`   Run: npm run fund "${mnemonic.split(' ').slice(0, 3).join(' ')}..."`));

        const deadline = Date.now() + WAIT_FOR_FUNDS_MS;
        while (balance === 0n && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
            state = await rx.firstValueFrom(wallet.state());
            balance = state.shielded.balances[SHIELDED_NATIVE_RAW] ?? 0n;
        }
    }

    if (balance === 0n) {
        console.error(chalk.red('❌ Balance is still 0. Fund your wallet first:'));
        console.error(chalk.cyan(`   npm run fund "your mnemonic words"`));
        await wallet.stop();
        process.exit(1);
    }

    console.log(chalk.green.bold(`💰 Balance: ${balance.toString()}`));
    console.log();

    // Load compiled contract
    const contractPath = path.join(process.cwd(), 'contracts', 'managed', CONTRACT_NAME, 'contract', 'index.js');
    const verifierKeyDir = path.join(process.cwd(), 'contracts', 'managed', CONTRACT_NAME, 'keys');

    if (!fs.existsSync(contractPath)) {
        console.error(chalk.red('❌ Contract not found at', contractPath));
        console.error(chalk.gray('   Run: npm run compile'));
        await wallet.stop();
        process.exit(1);
    }

    // Find verifier keys
    const verifierFiles = fs.existsSync(verifierKeyDir)
        ? fs.readdirSync(verifierKeyDir).filter(f => f.endsWith('.verifier'))
        : [];

    if (verifierFiles.length === 0) {
        console.error(chalk.red('❌ No verifier keys found in', verifierKeyDir));
        await wallet.stop();
        process.exit(1);
    }

    console.log(chalk.gray('📦 Loading contract...'));
    const ContractModule = await import(pathToFileURL(contractPath).href);
    const ContractClass = ContractModule.Contract;
    // The contract requires a secretKey witness function
    // It receives witnessContext and must return [nextPrivateState, Bytes<32>]
    const secretKeyBytes = shieldedSecretKeys.coinSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize();
    const contractInstance = new ContractClass({
        secretKey: (witnessContext: any) => [witnessContext.privateState, secretKeyBytes],
    });

    // Create constructor context
    const coinPublicKeyHex = state.shielded.coinPublicKey.toHexString();
    const constructorContext = createConstructorContext({}, coinPublicKeyHex);
    const constructorResult = contractInstance.initialState(constructorContext);

    // Build ledger state
    const cs = constructorResult.currentContractState as {
        data: { state: { encode: () => ledger.EncodedStateValue } };
        operation: (name: string) => { serialize: () => Uint8Array } | undefined;
    };

    const ledgerState = new ledger.ContractState();
    try {
        const encoded = cs.data.state.encode();
        ledgerState.data = new ledger.ChargedState(ledger.StateValue.decode(encoded));
    } catch {
        ledgerState.data = new ledger.ChargedState(
            ledger.StateValue.newArray().arrayPush(ledger.StateValue.newNull())
        );
    }

    // Add verifier keys for all operations
    const V6_HEADER = new TextEncoder().encode('midnight:verifier-key[v6]:');
    const V4_HEADER = new TextEncoder().encode('midnight:verifier-key[v4]:');

    for (const verifierFile of verifierFiles) {
        const opName = verifierFile.replace('.verifier', '');
        let verifierKeyBytes = new Uint8Array(fs.readFileSync(path.join(verifierKeyDir, verifierFile)));

        // Rewrite v6 -> v4 header if needed
        if (verifierKeyBytes.length >= V6_HEADER.length &&
            V6_HEADER.every((b, i) => verifierKeyBytes[i] === b)) {
            verifierKeyBytes = verifierKeyBytes.slice(0);
            verifierKeyBytes.set(V4_HEADER.subarray(0, V4_HEADER.length), 0);
        }

        const contractOp = cs.operation(opName);
        let op: ledger.ContractOperation;
        if (contractOp) {
            try {
                op = ledger.ContractOperation.deserialize(contractOp.serialize());
            } catch {
                op = new ledger.ContractOperation();
            }
        } else {
            op = new ledger.ContractOperation();
        }
        op.verifierKey = verifierKeyBytes;
        ledgerState.setOperation(opName, op);
        console.log(chalk.gray(`   Added verifier: ${opName}`));
    }

    ledgerState.balance = new Map();

    // Create deploy transaction
    const deploy = new ledger.ContractDeploy(ledgerState);
    const ttl = new Date(Date.now() + TTL_MS);
    const intent = ledger.Intent.new(ttl).addDeploy(deploy);
    const tx = ledger.Transaction.fromParts(NETWORK_ID, undefined, undefined, intent);

    console.log();
    console.log(chalk.blue('🚀 Deploying contract (this may take 30-60 seconds)...'));

    // Balance and prove
    const recipe = await wallet.balanceTransaction(shieldedSecretKeys, dustSecretKey, tx, ttl);

    // Handle different recipe types
    let txHash: string;
    const signSegment = (payload: Uint8Array): ledger.Signature => unshieldedKeystore.signData(payload);

    if (recipe.type === 'TransactionToProve') {
        const signedTx = await wallet.signTransaction(recipe.transaction, signSegment);
        const finalizedTx = await wallet.finalizeTransaction({
            type: 'TransactionToProve' as const,
            transaction: signedTx
        });
        txHash = await wallet.submitTransaction(finalizedTx);
    } else if (recipe.type === 'BalanceTransactionToProve') {
        const signedTx = await wallet.signTransaction(recipe.transactionToProve, signSegment);
        const finalizedTx = await wallet.finalizeTransaction({
            ...recipe,
            transactionToProve: signedTx
        });
        txHash = await wallet.submitTransaction(finalizedTx);
    } else {
        // NothingToProve - transaction is already complete
        txHash = await wallet.submitTransaction(recipe.transaction);
    }


    console.log(chalk.gray(`   Transaction submitted: ${txHash}`));

    const contractAddress = deploy.address.toString();

    // Save deployment info
    const deploymentInfo = {
        contractAddress,
        deployedAt: new Date().toISOString(),
        txHash,
        network: NETWORK_ID,
        contractName: CONTRACT_NAME
    };

    fs.writeFileSync('deployment.json', JSON.stringify(deploymentInfo, null, 2));

    console.log();
    console.log(chalk.green.bold("━".repeat(60)));
    console.log(chalk.green.bold("🎉 CONTRACT DEPLOYED SUCCESSFULLY!"));
    console.log(chalk.green.bold("━".repeat(60)));
    console.log();
    console.log(chalk.cyan.bold("📍 Contract Address:"));
    console.log(chalk.white(`   ${contractAddress}`));
    console.log();
    console.log(chalk.gray("✅ Saved to deployment.json"));
    console.log();

    await wallet.stop();
}

main().catch((err) => {
    console.error(chalk.red('❌ Deployment failed:'), err);
    process.exit(1);
});
