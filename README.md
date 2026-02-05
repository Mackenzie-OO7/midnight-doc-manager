# Midnight Document Manager

A privacy-preserving document management system built on the Midnight Network. Encrypts files client-side, stores them on IPFS, and uses Midnight's shielded state for access control and to verify integrity.

## Prerequisites

- Node.js 22+
- Docker (for proof server)
- Pinata account (for IPFS) - [Get free API key](https://app.pinata.cloud)
- [Compact Compiler](https://docs.midnight.network/getting-started/installation#install-compact)

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure:
   - **MIDNIGHT_NETWORK**: Set to `undeployed` for local development
   - **PINATA_JWT**: Get from [Pinata Dashboard](https://app.pinata.cloud) → Developer → API Keys → New Key → Copy JWT
   - **PINATA_GATEWAY**: Use `https://gateway.pinata.cloud/ipfs`

3. **Set up your wallet**:
   
   Install the [Lace Midnight Preview](https://chromewebstore.google.com/detail/hgeekaiplokcnmakghbdfbgnlfheichg) browser extension and:
   - Create a new wallet (save your 24-word mnemonic phrase securely!)
   - In Settings → Network, select **Undeployed**
   
   Your mnemonic phrase will be used for all deploy/fund commands.

4. **Compile the contract**:
   ```bash
   npm run compile
   ```

5. **Start the local network** (in a separate terminal):
   ```bash
   git clone https://github.com/bricktowers/midnight-local-network.git
   cd midnight-local-network
   yarn install
   docker compose up -d
   docker ps  # Wait for "healthy" status
   ```

6. **Check your wallet address**:
   ```bash
   npm run check-balance "your 24 word mnemonic phrase here"
   ```
   This shows your wallet address (matches Lace) and balance.

7. **Fund your wallet**:
   ```bash
   npm run fund "your 24 word mnemonic phrase here"
   ```
   This uses the local network's genesis wallet to fund your address.

8. **Generate dust tokens**:
   ```bash
   npm run generate-dust "your 24 word mnemonic phrase here"
   ```
   Dust tokens are required for transaction fees during deployment.

9. **Deploy the contract**:
   ```bash
   npm run deploy "your 24 word mnemonic phrase here"
   ```
   
   > **Security Note**: Your mnemonic is only used in memory during script execution and is not stored anywhere.
   
   > **Troubleshooting**: If deployment fails, verify:
   > - Docker containers are healthy: `docker ps`
   > - `.env` has `MIDNIGHT_NETWORK=undeployed`
   > - You ran `npm run fund` and `npm run generate-dust` first

## CLI Commands

```bash
# Check your wallet address and balance
npm run check-balance "your mnemonic phrase"

# Fund your wallet (local network only)
npm run fund "your mnemonic phrase"

# Generate dust tokens for transactions
npm run generate-dust "your mnemonic phrase"

# Generate a keypair for encryption and sharing
npm run cli -- keys generate

# Upload a document
npm run cli -- upload ./myfile.pdf "your mnemonic phrase"

# List your documents
npm run cli -- list

# Download a document
npm run cli -- download <docId> "your mnemonic phrase" -o ./output.pdf

# Verify document integrity
npm run cli -- verify ./myfile.pdf <docId> "your mnemonic phrase"

# Share with another user
npm run cli -- share grant <docId> <recipientPublicKey> "your mnemonic phrase"

# Revoke access
npm run cli -- share revoke <docId> <recipientPublicKey> "your mnemonic phrase"
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Compile Compact contract |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run deploy "mnemonic"` | Deploy contract (requires funded wallet) |
| `npm run fund "mnemonic"` | Fund wallet from genesis wallet |
| `npm run generate-dust "mnemonic"` | Generate dust tokens for transactions |
| `npm run check-balance "mnemonic"` | Check wallet address and balance |
| `npm run cli` | Run the CLI application |
| `npm run proof-server` | Start local proof server (Docker) |
| `npm run serve` | Serve web frontend on port 3000 |
| `npm run reset` | Delete compiled artifacts |
| `npm run clean` | Clean build output |

## Environment Variables
| Variable | Description |
|----------|-------------|
| `MIDNIGHT_NETWORK` | `preview` or `undeployed` |
| `STORAGE_PASSWORD` | Password for encrypted private state |
| `PINATA_JWT` | Your Pinata API JWT token |
| `PINATA_GATEWAY` | IPFS gateway URL |
| `WALLET_SEED` | Your 12/24 word mnemonic phrase |

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
│   ├── deploy.ts               # Deployment script
│   ├── fund.ts                 # Fund wallet
│   ├── generate-dust.ts        # Generate dust tokens
│   └── health-check.ts         # Network connectivity check
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