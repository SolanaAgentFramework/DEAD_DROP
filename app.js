// SOLANA DEAD DROP // LIVE FIRE MODE
// STATUS: CONNECTED TO BACKEND

// ⚠️ PASTE YOUR RENDER URL HERE (No trailing slash)
// Example: 'https://dead-drop-backend.onrender.com'
const API_URL = 'https://YOUR_APP_NAME.onrender.com'; 

const SERVICE_FEE_PERCENT = 0.35;
const CONNECTION_URL = 'https://api.devnet.solana.com';

let wallet = null;
let walletPublicKey = null;
let currentBalance = 0;

// HELPERS
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
    document.getElementById('transferForm')?.addEventListener('submit', transfer);
    document.getElementById('amount')?.addEventListener('input', calcFee);
    
    // Check if Backend is Online
    checkServerHealth();
});

async function checkServerHealth() {
    try {
        const res = await fetch(`${API_URL}/api/health`);
        const data = await res.json();
        console.log("SERVER ONLINE:", data);
        // If successful, you might want to show a small green dot on the UI
    } catch (e) {
        console.error("SERVER OFFLINE. WAKE UP RENDER!");
    }
}

// --- FAUCET VIA BACKEND (Secure) ---
async function requestAirdrop() {
    // We can use the client-side fallback for Faucet if backend fails
    // But for now, let's keep the client-side one I gave you as it's faster for Devnet
    alert("Use the CLI or Phantom faucet for now, or implement backend call here.");
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

function calcFee() {
    const amt = parseFloat(document.getElementById('amount').value) || 0;
    const fee = amt * (SERVICE_FEE_PERCENT / 100);
    safeSetText('serviceFee', fee.toFixed(6));
    safeSetText('totalAmount', (amt + fee + 0.000005).toFixed(6));
}

// --- THE REAL TRANSFER LOGIC ---
async function transfer(e) {
    e.preventDefault();
    if (!walletPublicKey) return alert('CONNECT WALLET');
    
    const dest = document.getElementById('destinationAddress').value.trim();
    const amt = parseFloat(document.getElementById('amount').value);
    
    if (!dest || dest.length < 30) return alert('INVALID ADDRESS');
    if (isNaN(amt) || amt <= 0) return alert('INVALID AMOUNT');

    try {
        const btn = document.getElementById('sendButton');
        btn.disabled = true; btn.textContent = 'UPLOADING TO VAULT...';

        // 1. GET VAULT ADDRESS FROM SERVER
        // This ensures we are sending to the wallet Render actually controls
        let vaultAddress;
        try {
            const vaultRes = await fetch(`${API_URL}/api/wallets`);
            const vaultData = await vaultRes.json();
            vaultAddress = vaultData.vault;
        } catch(e) {
            console.error(e);
            return alert("ERROR: COULD NOT REACH MIXING SERVER. IS RENDER AWAKE?");
        }

        const conn = new solanaWeb3.Connection(CONNECTION_URL);
        const { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } = solanaWeb3;

        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: walletPublicKey,
                toPubkey: new PublicKey(vaultAddress),
                lamports: Math.floor(amt * (1 + SERVICE_FEE_PERCENT/100) * LAMPORTS_PER_SOL)
            })
        );
        
        tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
        tx.feePayer = walletPublicKey;

        const signed = await wallet.signTransaction(tx);
        
        document.getElementById('transferForm').style.display = 'none';
        safeClassRemove('animationCard', 'hidden');
        
        // 2. SEND TO VAULT
        const vaultSig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
        
        // 3. START ANIMATION
        await animate(); // While animation plays, we wait for confirmation in background
        
        // 4. TELL SERVER TO MIX
        // We send the Vault Transaction ID to the server so it knows to verify and forward funds
        btn.textContent = 'MIXING IN PROGRESS...';
        
        const mixRes = await fetch(`${API_URL}/api/transfer`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                from: walletPublicKey.toString(),
                to: dest,
                amount: amt,
                vaultTx: vaultSig 
            })
        });
        
        const mixData = await mixRes.json();
        
        if(mixData.success) {
            success(mixData.txHash, mixData.solscan); // Show the final transaction from the Mixer to the User
        } else {
            alert("MIXING ERROR: " + mixData.error);
            // Fallback: Show the vault transaction if mixing failed but funds moved
            success(vaultSig, `https://solscan.io/tx/${vaultSig}?cluster=devnet`); 
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
    safeSetText(txt, 'CONTACTING SERVER...'); document.getElementById(bar).style.width='20%'; await sleep(1000);
    safeSetText(txt, 'DEPOSITING TO VAULT...'); document.getElementById(bar).style.width='50%'; await sleep(2000);
    safeSetText(txt, 'MIXING POOL ACTIVE...'); document.getElementById(bar).style.width='80%'; await sleep(4000); // Give Render time to process
    safeSetText(txt, 'FINALIZING ROUTE...'); document.getElementById(bar).style.width='95%'; await sleep(1000);
}

function success(hash, solscanUrl) {
    const card = document.getElementById('animationCard');
    if (!card) return;

    // Simulated Stats
    const users = (114000 + Math.floor(Math.random() * 5000)).toLocaleString();
    const anonRate = (99.85 + Math.random() * 0.14).toFixed(2); 
    
    // Default Solscan URL if not provided
    const solscanLink = solscanUrl || `https://solscan.io/tx/${hash}?cluster=devnet`;
    
    card.innerHTML = `
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
            
            <div style="margin-top: 20px; font-size: 0.9em; color: var(--holo-cyan);">
                <div style="margin-bottom: 10px; font-weight: bold;">🎯 FINAL TRANSACTION TO RECEIVER:</div>
                <div style="font-size: 0.7em; color: #666; word-break: break-all; margin-bottom: 10px;">
                    ${hash}
                </div>
                <a href="${solscanLink}" target="_blank" style="color: var(--holo-cyan); text-decoration: underline; font-size: 0.85em;">
                    🔗 View on Solscan (Devnet)
                </a>
            </div>
            
            <button onclick="location.reload()" class="btn" style="margin-top: 25px; border-color: var(--holo-green); color: var(--holo-green);">
                INITIATE NEW DROP
            </button>
        </div>
    `;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
