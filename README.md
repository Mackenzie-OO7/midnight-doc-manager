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

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   - **WALLET_SEED**: Generate a 64-character hex seed with `openssl rand -hex 32`
   - **PINATA_JWT**: Get from [Pinata Dashboard](https://app.pinata.cloud) → Developer → API Keys → New Key → Copy JWT
   - **PINATA_GATEWAY**: Your Pinata gateway URL (e.g., `https://gateway.pinata.cloud`)

3. **Compile the contract**:
   ```bash
   npm run compile
   ```

4. **Build TypeScript**:
   ```bash
   npm run build
   ```

5. **Start the proof server** (in a separate terminal):
   
   > **Note**: Ensure Docker Desktop is running before executing this command.
   
   ```bash
   npm run proof-server
   ```

6. **Use the CLI**:
   ```bash
   npm run cli -- --help
   ```

## CLI Commands

```bash
# Generate a keypair for encryption and sharing
# This creates an X25519 keypair used to encrypt/decrypt shared document keys
npm run cli -- keys generate

# Upload a document (you must deploy the contract first with `npm run deploy`)
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
| `npm run compile` | Compile Compact contract |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run cli` | Run the CLI application |
| `npm run proof-server` | Start local proof server (Docker) |
| `npm run serve` | Serve web frontend on port 3000 |
| `npm run dev` | Run proof server + file watcher |
| `npm run reset` | Delete compiled artifacts |
| `npm run clean` | Clean build output |

## Environment Variables

Copy `.env.example` to `.env` and configure:

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