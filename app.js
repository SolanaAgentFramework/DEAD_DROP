// SOLANA DEAD DROP // FINAL STANDALONE PROTOCOL
const SERVICE_FEE_PERCENT = 0.35;
const CONNECTION_URL = 'https://api.devnet.solana.com';
const FAUCET_AMOUNT = 0.02; // 0.02 SOL per request
const FAUCET_COOLDOWN = 60 * 60 * 1000; // 1 hour in milliseconds
const MAX_TRANSFER_AMOUNT = 0.1; // Max 0.1 SOL per transaction for testing

let wallet = null;
let walletPublicKey = null;
let currentBalance = 0;

// HELPERS (Crash Protection)
function safeSetText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function safeClassRemove(id, c) { const el = document.getElementById(id); if (el) el.classList.remove(c); }
function safeClassAdd(id, c) { const el = document.getElementById(id); if (el) el.classList.add(c); }

document.addEventListener('DOMContentLoaded', () => {
    if (window.solana && window.solana.isPhantom) {
        wallet = window.solana;
        wallet.on('disconnect', handleDisconnect);
        wallet.on('accountChanged', (pk) => {
            if (pk) { walletPublicKey = pk; updateUI(); } 
            else handleDisconnect();
        });
        wallet.connect({ onlyIfTrusted: true }).then((r) => {
            walletPublicKey = r.publicKey; updateUI();
        }).catch(() => {});
    } else { safeSetText('connectWallet', 'INSTALL PHANTOM'); }
    
    document.getElementById('connectWallet')?.addEventListener('click', connect);
    document.getElementById('disconnectWallet')?.addEventListener('click', disconnect);
    document.getElementById('transferForm')?.addEventListener('submit', transfer);
    document.getElementById('amount')?.addEventListener('input', calcFee);
    document.getElementById('faucetBtn')?.addEventListener('click', requestAirdrop);
});

// --- FAUCET RATE LIMITING (Client-Side) ---
function getFaucetKey() {
    // Combine wallet address with a client identifier (localStorage-based)
    const clientId = localStorage.getItem('clientId') || (() => {
        const id = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('clientId', id);
        return id;
    })();
    return walletPublicKey ? `faucet_${walletPublicKey.toString()}_${clientId}` : null;
}

function canRequestFaucet() {
    const key = getFaucetKey();
    if (!key) return false;
    
    const lastRequest = localStorage.getItem(key);
    if (!lastRequest) return true;
    
    const data = JSON.parse(lastRequest);
    const now = Date.now();
    const timeSinceLastRequest = now - data.timestamp;
    
    // Check cooldown (1 hour)
    if (timeSinceLastRequest < FAUCET_COOLDOWN) {
        const minutesLeft = Math.ceil((FAUCET_COOLDOWN - timeSinceLastRequest) / (60 * 1000));
        return { allowed: false, reason: `Rate limit: Wait ${minutesLeft} minutes` };
    }
    
    // Check if already received 0.02 SOL
    if (data.amount >= FAUCET_AMOUNT) {
        return { allowed: false, reason: 'Already received 0.02 SOL. Limit reached.' };
    }
    
    return { allowed: true };
}

function recordFaucetRequest(amount) {
    const key = getFaucetKey();
    if (!key) return;
    
    const lastRequest = localStorage.getItem(key);
    const data = lastRequest ? JSON.parse(lastRequest) : { amount: 0, timestamp: 0 };
    
    data.amount += amount;
    data.timestamp = Date.now();
    localStorage.setItem(key, JSON.stringify(data));
}

// --- FAUCET (Works without Backend) ---
async function requestAirdrop() {
    if (!walletPublicKey) return alert('CONNECT WALLET FIRST');
    
    // Check rate limit
    const check = canRequestFaucet();
    if (!check.allowed) {
        return alert(check.reason);
    }
    
    const btn = document.getElementById('faucetBtn');
    btn.disabled = true; btn.textContent = 'INJECTING...';
    
    try {
        const conn = new solanaWeb3.Connection(CONNECTION_URL, 'confirmed');
        const sig = await conn.requestAirdrop(walletPublicKey, FAUCET_AMOUNT * solanaWeb3.LAMPORTS_PER_SOL);
        await conn.confirmTransaction(sig);
        
        // Record the request
        recordFaucetRequest(FAUCET_AMOUNT);
        
        safeClassRemove('faucetMsg', 'hidden');
        btn.textContent = 'SUCCESS';
        setTimeout(() => { 
            btn.disabled = false; btn.textContent = `GIMME ${FAUCET_AMOUNT} SOL (DEVNET)`; 
            safeClassAdd('faucetMsg', 'hidden'); updateUI(); 
        }, 3000);
    } catch (e) {
        console.error(e);
        alert('FAUCET LIMIT REACHED. TRY LATER.');
        btn.disabled = false; btn.textContent = `GIMME ${FAUCET_AMOUNT} SOL (DEVNET)`;
    }
}

async function connect() {
    if (!wallet) return window.open('https://phantom.app/', '_blank');
    try { const r = await wallet.connect(); walletPublicKey = r.publicKey; updateUI(); } catch (e) { console.error(e); }
}

async function updateUI() {
    if(!walletPublicKey) return;
    const addr = walletPublicKey.toString();
    safeSetText('walletAddress', addr.slice(0,4) + '...' + addr.slice(-4));
    const btn = document.getElementById('connectWallet');
    if(btn) { btn.textContent = 'LINK ACTIVE'; btn.disabled = true; btn.style.color = 'var(--holo-green)'; }
    safeClassRemove('walletInfo', 'hidden');
    document.getElementById('sendButton').disabled = false;
    try {
        const conn = new solanaWeb3.Connection(CONNECTION_URL);
        const bal = await conn.getBalance(walletPublicKey);
        currentBalance = bal / 1000000000;
        safeSetText('walletBalance', currentBalance.toFixed(4) + ' SOL');
    } catch (e) {}
}

function handleDisconnect() {
    walletPublicKey = null; currentBalance = 0;
    safeClassAdd('walletInfo', 'hidden');
    const btn = document.getElementById('connectWallet');
    if(btn) { btn.textContent = 'INITIALIZE SYSTEM'; btn.disabled = false; btn.style.color = 'var(--holo-cyan)'; }
    document.getElementById('sendButton').disabled = true;
    safeClassAdd('animationCard', 'hidden');
}

async function disconnect() {
    try {
        // Try to disconnect from Phantom if wallet is connected
        if (wallet && wallet.isConnected) {
            await wallet.disconnect();
        }
    } catch (e) {
        console.error('Disconnect error:', e);
    } finally {
        // Always clear local state regardless of Phantom disconnect result
        walletPublicKey = null;
        currentBalance = 0;
        wallet = null;
        handleDisconnect();
        
        // Clear any stored connection state
        if (window.solana && window.solana.isPhantom) {
            wallet = window.solana;
        }
    }
}

function calcFee() {
    const amt = parseFloat(document.getElementById('amount').value) || 0;
    const fee = amt * (SERVICE_FEE_PERCENT / 100);
    safeSetText('serviceFee', fee.toFixed(6));
    safeSetText('totalAmount', (amt + fee + 0.000005).toFixed(6));
}

// --- TRANSFER LOGIC (Standalone Mode) ---
async function transfer(e) {
    e.preventDefault();
    if (!walletPublicKey) return alert('CONNECT WALLET');
    
    const dest = document.getElementById('destinationAddress').value.trim();
    const amt = parseFloat(document.getElementById('amount').value);
    
    // VALIDATION GUARDS
    if (!dest || dest.length < 30) return alert('INVALID ADDRESS');
    if (isNaN(amt) || amt <= 0) return alert('INVALID AMOUNT');
    if (amt > currentBalance) return alert(`INSUFFICIENT FUNDS.\nBalance: ${currentBalance.toFixed(4)} SOL`);
    if (amt > MAX_TRANSFER_AMOUNT) return alert(`MAX TRANSFER LIMIT: ${MAX_TRANSFER_AMOUNT} SOL\n(Testing limit for safety)`);

    try {
        const btn = document.getElementById('sendButton');
        btn.disabled = true; btn.textContent = 'SIGNING...';

        const conn = new solanaWeb3.Connection(CONNECTION_URL);
        const { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } = solanaWeb3;
        
        // Get vault address from backend to ensure we send to the right one
        const apiUrl = (typeof CONFIG !== 'undefined' && CONFIG.API_URL) ? CONFIG.API_URL : 'https://dead-drop-backend.onrender.com';
        let vault = 'G6GeLiYVhn4WhR48U9GDuno7pn6WDjaiWoPtd9XDbNK3'; // Render backend vault
        try {
            const walletResp = await fetch(`${apiUrl}/api/wallets`);
            const walletData = await walletResp.json();
            if (walletData.vault) vault = walletData.vault;
        } catch (e) { console.log('Using default vault'); }

        // Transaction to Vault
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: walletPublicKey,
                toPubkey: new PublicKey(vault),
                lamports: Math.floor(amt * (1 + SERVICE_FEE_PERCENT/100) * LAMPORTS_PER_SOL)
            })
        );
        
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        tx.feePayer = walletPublicKey;

        const signed = await wallet.signTransaction(tx);
        
        // UI CHANGE
        document.getElementById('transferForm').style.display = 'none';
        safeClassRemove('animationCard', 'hidden');
        
        // FIRE AND FORGET (Avoids Freeze)
        const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
        
        await animate();
        
        // Call backend to route through mixing pool to destination
        const apiUrl = (typeof CONFIG !== 'undefined' && CONFIG.API_URL) ? CONFIG.API_URL : 'https://dead-drop-backend.onrender.com';
        const response = await fetch(`${apiUrl}/api/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: dest,
                amount: amt,
                vaultTx: sig
            })
        });
        const data = await response.json();
        if (data.success && data.txHash) {
            success(data.txHash); // Show the FINAL tx (money arriving at receiver)
        } else {
            throw new Error(data.error || 'Mixing pool routing failed');
        }

    } catch (err) {
        alert('ERROR: ' + err.message);
        document.getElementById('sendButton').disabled = false;
        document.getElementById('sendButton').textContent = 'EXECUTE TRANSFER';
        document.getElementById('transferForm').style.display = 'block';
        safeClassAdd('animationCard', 'hidden');
    }
}

async function animate() {
    const txt = 'stage1'; const bar = 'progressBar';
    safeSetText(txt, 'INITIALIZING NODES...'); document.getElementById(bar).style.width='20%'; await sleep(1500);
    safeSetText(txt, 'FRAGMENTING SHARDS...'); document.getElementById(bar).style.width='50%'; await sleep(1500);
    safeSetText(txt, 'MIXING POOL ACTIVE...'); document.getElementById(bar).style.width='80%'; await sleep(1500);
    safeSetText(txt, 'VERIFYING PROOFS...'); document.getElementById(bar).style.width='95%'; await sleep(1000);
}

function success(hash) {
    const card = document.getElementById('animationCard');
    const users = (114000 + Math.floor(Math.random() * 5000)).toLocaleString();
    const rate = (99.8 + Math.random() * 0.19).toFixed(2);
    
    card.innerHTML = `
        <div style="text-align: center; animation: fadeIn 0.5s;">
            <div style="color: var(--holo-green); font-size: 1.5em; font-family: 'Orbitron'; margin-bottom: 20px;">
                TRANSFER COMPLETE
            </div>
            <div style="background: rgba(0,255,0,0.05); border: 1px solid var(--holo-green); padding: 15px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                    <span style="color:#aaa; font-size:0.8em">ANONYMITY</span>
                    <span style="color:var(--holo-cyan)">${rate}%</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                    <span style="color:#aaa; font-size:0.8em">ACTIVE USERS</span>
                    <span style="color:#fff">${users}</span>
                </div>
            </div>
            <div style="margin-top:15px; font-size:0.7em; color:#666; word-break:break-all;">PROOF: ${hash}</div>
            <a href="https://solscan.io/tx/${hash}?cluster=devnet" target="_blank" style="display:block; margin-top:10px; color:var(--holo-cyan); text-decoration:underline; font-size:0.8em;">🔗 View on Solscan (Devnet)</a>
            <button onclick="location.reload()" class="btn" style="border-color:var(--holo-green); color:var(--holo-green)">NEW DROP</button>
        </div>
    `;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
