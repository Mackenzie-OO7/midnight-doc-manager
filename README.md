# Midnight Document Manager

A privacy-preserving document management system built on the Midnight Network. Files are encrypted client-side, stored on IPFS, and access control is enforced on-chain using Midnight's shielded state.

## Prerequisites

- Node.js 22+
- Docker
- Pinata account (for IPFS) - [Get free API key](https://app.pinata.cloud)
- [Compact Compiler](https://docs.midnight.network/getting-started/installation#install-compact)

## Setup

```bash
git clone https://github.com/your-org/midnight-doc-manager
cd midnight-doc-manager
npm install
cp .env.example .env
npm run compile
```

Edit `.env` and set your Pinata credentials:
- **PINATA_JWT**: Get from [Pinata Dashboard](https://app.pinata.cloud) → Developer → API Keys → New Key → Copy JWT
- **PINATA_GATEWAY**: Get from [Pinata Dashboard](https://app.pinata.cloud) → Gateways. Use your dedicated gateway URL — it looks like `https://your-name.mypinata.cloud`. Do not use `https://gateway.pinata.cloud` — that is the shared gateway and does not support authenticated file downloads.

---

## Deployment

There are two ways to run this project: against a local Docker network, or against the public Preprod testnet. Choose one.

The mnemonic you use for one network cannot be used on the other. Each network is separate and requires its own funded wallet.

---

### Option A: Local Network

The local network runs entirely in Docker and includes the node, indexer, and proof server. You will need two terminals open.

**Terminal 1 - start the local network (keep running):**

Clone and start [`midnight-local-dev`](https://github.com/midnightntwrk/midnight-local-dev):

```bash
git clone https://github.com/midnightntwrk/midnight-local-dev
cd midnight-local-dev
npm install
npm start
```

Once the network is up, you will see the genesis master wallet logged. This is the network's internal funding source, not your wallet. You will then see the funding menu:

```
  [1] Fund accounts from config file (NIGHT + DUST registration)
  [2] Fund accounts by public key (NIGHT transfer only)
  [3] Display wallets
  [4] Exit
```

Select `[1]`. When prompted for a path, enter `./accounts.json`. The repo ships with an `accounts.json` containing a pre-configured development wallet. You can use the mnemonic already there or replace it with your own. Note the mnemonic down as you will need it in Terminal 2.

The tool transfers NIGHT and registers DUST in one step, leaving the wallet fully ready to submit transactions. Leave Terminal 1 running once funding is complete.

**Terminal 2 - deploy the contract:**

Open a new terminal in the `midnight-doc-manager` directory.

Confirm the wallet was funded. The mnemonic to use is the one from `accounts.json` — either the pre-configured one that shipped with the repo, or the one you replaced it with earlier:

```bash
npm run check-balance "your mnemonic phrase here"
```

You should see a non-zero NIGHT and DUST balance. Then deploy:

```bash
npm run deploy "your mnemonic phrase here"
```

On success, the contract address is printed and saved to `deployment.json`.

> If deployment fails, confirm containers are healthy from the `midnight-local-dev` directory:
> ```bash
> docker compose -f standalone.yml ps
> ```

---

### Option B: Preprod Testnet

Preprod is Midnight's public testnet. You will need two terminals open.

**Terminal 1 - start the proof server (keep running):**

```bash
npm run proof-server
```

**Terminal 2 - deploy the contract:**

Set `.env` to target preprod:

```
MIDNIGHT_NETWORK=preprod
```

Install [Lace](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk), create a new wallet, and select **Preprod** in Settings → Network. Lace will show you a 24-word mnemonic when you create the wallet — save it, as this is what you will pass to all CLI commands.

Lace also handles dust registration automatically after your wallet receives funds, so no separate dust step is needed.

Get your unshielded address:

```bash
npm run check-balance "your mnemonic phrase here"
```

Get tNIGHT from the [Midnight faucet](https://midnight.network/faucet) by pasting your unshielded address. Wait for the transaction to confirm, then run `check-balance` again to verify the funds arrived and that DUST is non-zero before continuing.

Deploy:

```bash
npm run preprod "your mnemonic phrase here"
```

Deployment takes 60-120 seconds on preprod while waiting for block confirmations. On success, the contract address is saved to `deployment.json`.

> Your mnemonic is only used in memory during script execution and is never stored anywhere.

---

## Using the Document Manager

Once the contract is deployed, you can upload, retrieve, share, and verify documents. All commands use the same mnemonic you used to deploy.

> In the commands below, replace everything inside `< >` with your actual values and remove the angle brackets. For example, `<document-id>` becomes the hex string printed after upload.

Start by creating a folder to keep your documents organised:

```bash
mkdir documents
```

Place any files you want to work with inside that folder.

### 1. Generate an encryption keypair

Before uploading your first document, generate a keypair. This keypair is used exclusively for encrypting and decrypting document keys — it is separate from your wallet and has nothing to do with your mnemonic or wallet address.

```bash
npm run cli -- keys generate
```

This saves a keypair to `.midnight-doc-keys.json` in the current directory and prints your public key. Keep this file safe — if you lose it, you will not be able to decrypt documents you have uploaded. The file is gitignored and will never be committed.

### 2. Upload a document

Encrypt a file and register it on-chain. The file is encrypted locally, uploaded to IPFS via Pinata, and the content hash is stored on Midnight.

```bash
npm run cli -- upload ./documents/<filename> "your mnemonic phrase here"
```

When the upload completes, the CLI prints a document ID — a long hex string. Save this value as you will need it for all subsequent commands.

A local metadata file is also saved (for example `abc123.doc.json`) containing the document ID, CID, and your wrapped encryption key. This file is gitignored and must be kept locally — if you lose it, you cannot decrypt the document. Share it with recipients along with the document ID when granting access.

You can confirm the upload succeeded by checking the **Files** section of your [Pinata dashboard](https://app.pinata.cloud). The encrypted file will appear there under your private storage.

### 3. List your documents

View all documents registered from this machine:

```bash
npm run cli -- list
```

### 4. Download a document

Fetch the encrypted file from IPFS and decrypt it locally:

```bash
npm run cli -- download <document-id> "your mnemonic phrase here" -o ./documents/<filename>
```

The output file extension is always set to match the original file type, regardless of what you specify.

### 5. Verify a document

Confirm that a local file matches the hash stored on-chain. This proves the file has not changed since it was uploaded.

```bash
npm run cli -- verify ./documents/<filename> <document-id> "your mnemonic phrase here"
```

Verification is byte-exact — the SHA-256 hash of the local file must match the hash recorded at upload time. A file that looks identical visually can still fail if it was re-saved, re-compressed, or processed by any application that modified its bytes or metadata. The most reliable way to verify is to use the file produced by the download command above, which decrypts the exact bytes that were originally uploaded.

### 6. Share access with another user

The sharing system uses **X25519 encryption keypairs**, not wallet addresses. Each user generates their own keypair with `keys generate`. The public key from that command is a 64-character hex string — that is what you need from the recipient before you can grant them access.

**How it works:** When you grant access, the CLI wraps the document's decryption key with the recipient's public key and stores the encrypted grant on-chain. The recipient fetches that grant using their own private key and decrypts the file — without you ever sharing your mnemonic or any raw keys.

**To test sharing locally** (simulating two users on one machine), generate a second keypair saved to a different file so it does not overwrite yours:

```bash
npm run cli -- keys generate -o ./bob-keys.json
```

Copy the public key it prints. Then grant access using your original keypair and the recipient's public key:

```bash
npm run cli -- share grant <document-id> <recipient-public-key> "your mnemonic phrase here"
```

The recipient downloads using their own mnemonic and their own keypair. They do not need your mnemonic — only their own. They also need a copy of the `.doc.json` metadata file:

```bash
npm run cli -- download <document-id> "recipient mnemonic phrase here" -k ./bob-keys.json -o ./documents/<filename>
```

The CLI automatically detects that the local wrapped key does not belong to the recipient, looks up the access grant from the chain, and uses that instead.

> In a real multi-user scenario, the recipient runs `keys generate` on their own machine and sends you only their public key. You never need their mnemonic and they never need yours.

> If you ran `keys generate` again without `-o` and overwrote your original keypair, the upload's wrapped key can no longer be decrypted — it was encrypted with the old public key. You will need to re-upload the document with a fresh keypair. To avoid this, always use `-o` with a distinct filename when generating additional keypairs.

### 7. Revoke access

Remove a previously granted access record from the contract. Use your own mnemonic (the owner's) and the recipient's X25519 public key — the same one you passed to `share grant`:

```bash
npm run cli -- share revoke <document-id> <recipient-public-key> "your mnemonic phrase here"
```

Once confirmed, the access grant is removed from the contract and the recipient can no longer fetch the document decryption key from the chain.

Two things to be aware of:

- **Indexer lag:** The grant is removed at the chain level when the transaction confirms. The indexer may take a few seconds to reflect this change. If the recipient attempts to download immediately after you revoke, they may briefly still succeed within that window.
- **Already-decrypted copies:** Revocation only prevents future key retrieval. It cannot delete a copy of the file the recipient already decrypted and saved to their machine.

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile Compact contract |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run deploy "mnemonic"` | Deploy contract on local network |
| `npm run preprod "mnemonic"` | Deploy contract on preprod |
| `npm run generate-dust "mnemonic"` | Register UTXOs for dust generation (local network only) |
| `npm run check-balance "mnemonic"` | Check wallet address and balance |
| `npm run cli` | Run the CLI application |
| `npm run proof-server` | Start the proof server (Docker) |
| `npm run reset` | Delete compiled artifacts |
| `npm run clean` | Clean build output |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIDNIGHT_NETWORK` | `undeployed` (local) or `preprod` |
| `PINATA_JWT` | Your Pinata API JWT token |
| `PINATA_GATEWAY` | Your dedicated Pinata gateway URL (from app.pinata.cloud/gateway) |

## Project Structure

```
midnight-doc-manager/
├── contracts/
│   └── document-manager.compact  # Compact contract
├── documents/                     # Your working files (create this, gitignored)
├── src/
│   ├── providers/
│   │   └── midnight-providers.ts  # Wallet + indexer + proof provider setup
│   ├── api/
│   │   ├── contract.ts            # Contract interaction wrapper
│   │   └── witnesses.ts           # ZK witness functions and commitment helpers
│   ├── utils/
│   │   ├── encryption.ts          # AES-256-GCM file encryption
│   │   ├── environment.ts         # Config and network management
│   │   ├── keys.ts                # X25519 keypair and document key wrapping
│   │   └── wallet.ts              # HD wallet initialization and utilities
│   ├── cli.ts                     # CLI application
│   ├── storage.ts                 # Pinata (IPFS) and Arweave storage providers
│   ├── deploy.ts                  # Contract deployment script
│   ├── generate-dust.ts           # Dust registration for preprod
│   └── check-balance.ts           # Wallet address and balance display
├── .env.example
└── package.json
```

## How It Works

**Upload:** Your file is encrypted with AES-256-GCM locally, uploaded to IPFS via Pinata into your private storage, and the SHA-256 content hash is registered on the Midnight contract. The file never leaves your machine unencrypted.

**Download:** The CLI retrieves the encrypted file from Pinata using authenticated access via your dedicated gateway, then decrypts it locally using your keypair. If the file was shared with you, the CLI automatically fetches your access grant from the chain instead.

**Share:** To give another user access, the CLI wraps your document key with the recipient's X25519 public key and stores the encrypted grant on-chain. The recipient decrypts using their own private key — no raw keys or mnemonics are ever exchanged.

**Verify:** The CLI computes a SHA-256 hash of the local file and compares it against the hash stored on-chain. A match proves the file is byte-for-byte identical to what was uploaded.

## Notes on Dust

Dust is Midnight's mechanism for protecting the network from spam. It accumulates on your wallet once you register unshielded UTXOs and cannot be transferred.

On local dev, `midnight-local-dev` handles dust registration automatically when funding via option `[1]`.

On preprod, Lace handles dust registration automatically after your wallet receives tNIGHT from the faucet. Wait until `npm run check-balance` shows a non-zero DUST balance before deploying.
