// State
const state = {
    isConnected: false,
    walletAddress: null,
    selectedFile: null,
    documents: []
};

// DOM Elements
const elements = {
    connectBtn: document.getElementById('connect-btn'),
    walletStatus: document.getElementById('wallet-status'),
    walletInfo: document.getElementById('wallet-info'),
    walletAddress: document.getElementById('wallet-address'),
    walletBalance: document.getElementById('wallet-balance'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    fileInfo: document.getElementById('file-info'),
    fileName: document.getElementById('file-name'),
    fileSize: document.getElementById('file-size'),
    uploadBtn: document.getElementById('upload-btn'),
    uploadProgress: document.getElementById('upload-progress'),
    documentsList: document.getElementById('documents-list'),
    toast: document.getElementById('toast')
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadDocumentsFromStorage();
});

function setupEventListeners() {
    elements.connectBtn.addEventListener('click', handleConnect);

    // File upload
    elements.dropZone.addEventListener('click', () => elements.fileInput.click());
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.dropZone.addEventListener('dragover', handleDragOver);
    elements.dropZone.addEventListener('dragleave', handleDragLeave);
    elements.dropZone.addEventListener('drop', handleDrop);
    elements.uploadBtn.addEventListener('click', handleUpload);
}

// Wallet Connection
async function handleConnect() {
    elements.connectBtn.textContent = 'Connecting...';
    elements.connectBtn.disabled = true;

    try {
        if (typeof window.midnight === 'undefined') {
            // Demo mode - simulate connection
            await simulateConnection();
        } else {
            // Connection via DApp Connector
            await connectWithDAppConnector();
        }
    } catch (error) {
        showToast('Connection failed: ' + error.message, 'error');
        elements.connectBtn.textContent = 'Connect Wallet';
        elements.connectBtn.disabled = false;
    }
}

async function simulateConnection() {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    const demoAddress = 'mn_shield-addr_preview' + generateRandomHex(32) + '...';

    state.isConnected = true;
    state.walletAddress = demoAddress;

    updateWalletUI(demoAddress, '1000000');
    showToast('Connected! (Demo Mode)', 'success');
}

async function connectWithDAppConnector() {
    const api = await window.midnight.enable();
    const address = await api.getShieldedAddress();

    state.isConnected = true;
    state.walletAddress = address;

    const balance = await api.getBalance();
    updateWalletUI(address, balance.toString());
    showToast('Wallet connected!', 'success');
}

function updateWalletUI(address, balance) {
    elements.walletStatus.classList.remove('disconnected');
    elements.walletStatus.classList.add('connected');
    elements.walletStatus.querySelector('span:last-child').textContent = 'Connected';

    elements.walletInfo.classList.remove('hidden');
    elements.walletAddress.textContent = truncateAddress(address);
    elements.walletBalance.textContent = formatBalance(balance);

    elements.connectBtn.textContent = 'Connected';
    elements.connectBtn.disabled = true;
}

// File Handling
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) selectFile(file);
}

function handleDragOver(event) {
    event.preventDefault();
    elements.dropZone.classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    elements.dropZone.classList.remove('dragover');
}

function handleDrop(event) {
    event.preventDefault();
    elements.dropZone.classList.remove('dragover');

    const file = event.dataTransfer.files[0];
    if (file) selectFile(file);
}

function selectFile(file) {
    state.selectedFile = file;

    elements.fileInfo.classList.remove('hidden');
    elements.fileName.textContent = file.name;
    elements.fileSize.textContent = formatBytes(file.size);

    elements.uploadBtn.disabled = !state.isConnected;
}

// Upload
async function handleUpload() {
    if (!state.selectedFile || !state.isConnected) return;

    elements.uploadBtn.disabled = true;
    elements.uploadProgress.classList.remove('hidden');

    try {
        const progress = elements.uploadProgress.querySelector('.progress-fill');
        const progressText = elements.uploadProgress.querySelector('.progress-text');

        // Read file
        progressText.textContent = 'Reading file...';
        progress.style.width = '10%';
        const fileData = await readFileAsArrayBuffer(state.selectedFile);

        // Compute hash
        progressText.textContent = 'Computing hash...';
        progress.style.width = '25%';
        const contentHash = await computeHash(fileData);

        // Generate encryption key
        progressText.textContent = 'Generating encryption key...';
        progress.style.width = '40%';
        const documentKey = generateDocumentKey();

        // Encrypt
        progressText.textContent = 'Encrypting...';
        progress.style.width = '55%';
        const encrypted = await encryptData(fileData, documentKey);

        // Upload to IPFS (simulated in frontend for now)
        progressText.textContent = 'Uploading to IPFS...';
        progress.style.width = '75%';
        const cid = await simulateIPFSUpload(encrypted);

        //Complete
        progress.style.width = '100%';
        progressText.textContent = 'Done!';

        // Add to documents list
        const doc = {
            id: generateRandomHex(32),
            name: state.selectedFile.name,
            size: state.selectedFile.size,
            contentHash: contentHash,
            cid: cid,
            uploadedAt: new Date().toISOString()
        };

        state.documents.push(doc);
        saveDocumentsToStorage();
        renderDocuments();

        showToast('Document uploaded successfully!', 'success');

        // Reset
        setTimeout(() => {
            elements.uploadProgress.classList.add('hidden');
            elements.fileInfo.classList.add('hidden');
            state.selectedFile = null;
            elements.fileInput.value = '';
        }, 1500);

    } catch (error) {
        showToast('Upload failed: ' + error.message, 'error');
    }

    elements.uploadBtn.disabled = false;
}

// Encryption
async function computeHash(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hashBuffer);
}

function generateDocumentKey() {
    return crypto.getRandomValues(new Uint8Array(32));
}

async function encryptData(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cryptoKey = await crypto.subtle.importKey(
        'raw', key, { name: 'AES-GCM' }, false, ['encrypt']
    );
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        cryptoKey,
        data
    );
    // Combine IV + encrypted data
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);
    return result;
}

async function simulateIPFSUpload(data) {
    await new Promise(resolve => setTimeout(resolve, 800));
    return 'bafkrei' + generateRandomHex(28);
}

// Documents List
function renderDocuments() {
    if (state.documents.length === 0) {
        elements.documentsList.innerHTML = '<p class="empty-state">No documents yet. Upload your first one!</p>';
        return;
    }

    elements.documentsList.innerHTML = state.documents.map(doc => `
        <div class="document-item" data-id="${doc.id}">
            <div class="document-info">
                <span class="document-icon">📄</span>
                <div>
                    <div class="document-name">${escapeHtml(doc.name)}</div>
                    <div class="document-meta">${formatBytes(doc.size)} • ${formatDate(doc.uploadedAt)}</div>
                </div>
            </div>
            <div class="document-actions">
                <button class="btn-small" onclick="verifyDocument('${doc.id}')">Verify</button>
                <button class="btn-small" onclick="shareDocument('${doc.id}')">Share</button>
            </div>
        </div>
    `).join('');
}

function verifyDocument(id) {
    const doc = state.documents.find(d => d.id === id);
    if (doc) {
        showToast(`Document verified! Hash: ${doc.contentHash.slice(0, 16)}...`, 'success');
    }
}

function shareDocument(id) {
    showToast('Share functionality requires wallet integration', 'info');
}

// Storage
function saveDocumentsToStorage() {
    localStorage.setItem('midnight-documents', JSON.stringify(state.documents));
}

function loadDocumentsFromStorage() {
    const saved = localStorage.getItem('midnight-documents');
    if (saved) {
        state.documents = JSON.parse(saved);
        renderDocuments();
    }
}

// Utilities
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function generateRandomHex(length) {
    return Array.from(crypto.getRandomValues(new Uint8Array(length)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function truncateAddress(address) {
    if (!address) return '-';
    if (address.length <= 24) return address;
    return address.slice(0, 20) + '...' + address.slice(-8);
}

function formatBalance(balance) {
    const num = BigInt(balance);
    return num.toLocaleString();
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(isoString) {
    return new Date(isoString).toLocaleDateString();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.className = 'toast ' + type;
    elements.toast.classList.remove('hidden');

    setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, 3000);
}
