# Midnight Document Manager

A privacy-preserving document management system built on the Midnight Network. Encrypts files client-side, stores them on IPFS, and uses Midnight's shielded state for access control and to verify integrity.

## Prerequisites

- Node.js 22+
- Docker (for proof server)
- [Lace Wallet Extension](https://chromewebstore.google.com/detail/lace-beta/hgeekaiplokcnmakghbdfbgnlfheichg)
- Pinata account (for IPFS) - [Get free API key](https://app.pinata.cloud)
- [Compact Compiler](https://docs.midnight.network/getting-started/installation#install-compact)

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment and wallet**:
   ```bash
   cp .env.example .env
   ```
   
   **Generate a wallet seed:**
   ```bash
   openssl rand -hex 32
   ```
   Copy the output (64-character hex string).
   
   Edit `.env` and configure:
   - **WALLET_SEED**: Paste the generated seed
   - **MIDNIGHT_NETWORK**: Set to `undeployed` for local development
   - **PINATA_JWT**: Get from [Pinata Dashboard](https://app.pinata.cloud) → Developer → API Keys → New Key → Copy JWT
   - **PINATA_GATEWAY**: Use `https://gateway.pinata.cloud/ipfs`
   
   > **Important**: The wallet seed in `.env` must match the wallet you fund in step 5.

3. **Compile the contract**:
   ```bash
   npm run compile
   ```

4. **Build Project**:
   ```bash
   npm run build
   ```

5. **Start the local network** (in a separate terminal):

   Before deploying, you must set up a local Midnight network and fund your wallet.

   ```bash
   # In a separate terminal
   git clone https://github.com/bricktowers/midnight-local-network.git
   cd midnight-local-network
   yarn install
   docker compose up -d
   ```

   **Wait for containers to be healthy:**

   ```bash
   docker ps  # All containers should show "healthy" status
   ```

   **Get your wallet address:**

   1. Open **Lace Midnight Preview** wallet extension
   2. Go to **Settings** → Switch network to **"Undeployed"**
   3. Copy your **shielded wallet address**

   **Fund your wallet:**

   ```bash
   yarn fund <YOUR_WALLET_ADDRESS>
   ```

6. **Return to project and deploy**

   ```bash
   cd ../midnight-doc-manager
   npm run deploy
   ```

   > **Troubleshooting**: If deployment times out, verify:
   > - Docker containers are running and healthy: `docker ps`
   > - Your `.env` has `MIDNIGHT_NETWORK=undeployed`
   > - The wallet address you funded matches your `WALLET_SEED`

   > **Tip**: You can run all setup steps at once with `npm run setup` (compiles, builds, and deploys)

## CLI Commands

> **Important**: You must deploy the contract first (see step 5 above) before using these commands.

```bash
# Generate a keypair for encryption and sharing
# This creates an X25519 keypair used to encrypt/decrypt shared document keys
npm run cli -- keys generate

# Upload a document
npm run cli -- upload ./myfile.pdf

# List your documents
npm run cli -- list

# Download a document
npm run cli -- download <docId> -o ./output.pdf

# Verify document integrity
npm run cli -- verify <docId>

# Share with another user
npm run cli -- share grant <docId> <recipientPublicKey>
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | **Compile, build, and deploy** (all-in-one) |
| `npm run compile` | Compile Compact contract |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run deploy` | Deploy contract to network |
| `npm run cli` | Run the CLI application |
| `npm run proof-server` | Start local proof server (Docker) |
| `npm run serve` | Serve web frontend on port 3000 |
| `npm run dev` | Run proof server + file watcher |
| `npm run reset` | Delete compiled artifacts |
| `npm run clean` | Clean build output |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WALLET_SEED` | 64-character hex wallet seed |
| `STORAGE_PASSWORD` | Password for encrypted private state |
| `MIDNIGHT_NETWORK` | `preview` or `undeployed` |
| `PINATA_JWT` | Your Pinata API JWT token |
| `PINATA_GATEWAY` | IPFS gateway URL |

## Project Structure

```
midnight-doc-manager/
├── contracts/
│   ├── document-manager.compact  # Compact contract (9 circuits)
├── src/
│   ├── providers/
│   │   ├── midnight-providers.ts
│   ├── api/
│   │   ├── contract.ts         # Contract interaction wrapper
│   │   └── witnesses.ts
│   ├── utils/
│   │   ├── encryption.ts       # AES-256-GCM encryption
│   │   ├── environment.ts      # Config management
│   │   └── keys.ts             # X25519 key management
│   ├── cli.ts                  # CLI application
│   ├── storage.ts              # IPFS/Arweave providers
│   └── deploy.ts               # Deployment script
├── web/                        # Frontend
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── .env.example
└── package.json
```

## How It Works

1. **Upload**: File → Encrypt (AES-256) → Upload to IPFS → Register hash on Midnight
2. **Download**: Fetch from IPFS → Decrypt with your key → Original file
3. **Share**: Wrap document key with recipient's public key → Store grant on-chain
4. **Verify**: Download file → Hash it → Compare with on-chain hash

## Cheers!