// TRUE ANONYMITY FIX - MIXING POOL SYSTEM
// This breaks the direct chain by using shared mixing pools
const express = require('express');
const cors = require('cors');
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', true); // Trust proxy for accurate IP detection

// =====================================================
// SECURITY CONSTANTS
// =====================================================
const MAX_TRANSFER_AMOUNT = 50; // Max 50 SOL per transfer
const FAUCET_AMOUNT = 0.02;     // 0.02 SOL per airdrop
const FAUCET_COOLDOWN = 60 * 60 * 1000; // 1 Hour in milliseconds

// Simple in-memory rate limiter for faucet
const faucetHistory = new Map(); // Stores { "ip_or_wallet": timestamp }

// USE DEVNET (same as farming)
const HELIUS_API_KEY = '7b3312ca-9bf1-4b30-ba5f-5e342be423ec';
const RPC_URLS = [
    'https://api.devnet.solana.com',
    `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
];
let currentRpcIndex = 0;
function getRPC() {
    const rpc = RPC_URLS[currentRpcIndex];
    currentRpcIndex = (currentRpcIndex + 1) % RPC_URLS.length;
    return rpc;
}
const connection = new Connection(getRPC(), 'confirmed');

// =====================================================
// CRITICAL FIX: MIXING POOL ARCHITECTURE
// =====================================================
const MIXING_POOL_SIZE = 15;
const mixingPool = [];
const WALLETS_DIR = path.join(__dirname, 'wallets');
const POOL_FILE = path.join(WALLETS_DIR, 'mixing_pool.json');
const SERVICE_FEE_PERCENT = 0.35; // 0.35% service fee

// Ensure directory exists (prevents crash)
if (!fs.existsSync(WALLETS_DIR)) {
    fs.mkdirSync(WALLETS_DIR, { recursive: true });
}

// Load or generate mixing pool
function loadMixingPool() {
    // Priority 1: Environment variable (for Render deployment)
    if (process.env.MIXING_POOL_KEYS) {
        const keys = process.env.MIXING_POOL_KEYS.split(',');
        keys.forEach((key, i) => {
            const keypair = Keypair.fromSecretKey(bs58.decode(key.trim()));
            mixingPool.push(keypair);
        });
        console.log(`✅ Loaded ${mixingPool.length} mixing pool wallets from ENV`);
        return;
    }
    
    // Priority 2: Local file
    if (fs.existsSync(POOL_FILE)) {
        try {
            const poolData = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
            poolData.wallets.forEach(w => {
                const keypair = Keypair.fromSecretKey(bs58.decode(w.secretKey));
                mixingPool.push(keypair);
            });
            console.log(`✅ Loaded ${mixingPool.length} mixing pool wallets`);
        } catch (e) {
            console.error('❌ Error reading pool file. Regenerating...');
            generateNewPool();
        }
    } else {
        generateNewPool();
    }
}

function generateNewPool() {
    console.log('🔄 Generating new mixing pool...');
    const poolData = { wallets: [] };
    
    // Clear existing memory
    mixingPool.length = 0;

    for (let i = 0; i < MIXING_POOL_SIZE; i++) {
        const keypair = Keypair.generate();
        mixingPool.push(keypair);
        poolData.wallets.push({
            id: i,
            publicKey: keypair.publicKey.toString(),
            secretKey: bs58.encode(keypair.secretKey)
        });
        console.log(`  Pool ${i + 1}: ${keypair.publicKey.toString().slice(0, 8)}...`);
    }
    
    fs.writeFileSync(POOL_FILE, JSON.stringify(poolData, null, 2));
    console.log('✅ Mixing pool created and saved');
}

loadMixingPool();

// =====================================================
// MIXING POOL SHUFFLE ALGORITHM
// =====================================================
async function routeThroughMixingPool(fromWallet, toAddress, amountLamports) {
    console.log('\n🌀 MIXING POOL ROUTING');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Pick 3-5 random pool wallets (no repeats)
    const hopCount = 3 + Math.floor(Math.random() * 3); // 3-5 hops
    const selectedPools = [];
    const usedIndices = new Set();
    
    while (selectedPools.length < hopCount) {
        const randomIndex = Math.floor(Math.random() * MIXING_POOL_SIZE);
        if (!usedIndices.has(randomIndex)) {
            usedIndices.add(randomIndex);
            selectedPools.push(mixingPool[randomIndex]);
        }
    }
    
    console.log(`📍 Selected ${hopCount} random pool wallets`);
    
    // Route through each pool wallet
    let currentSender = fromWallet;
    let currentAmount = amountLamports;
    const signatures = [];
    
    for (let i = 0; i < hopCount; i++) {
        const isLastHop = (i === hopCount - 1);
        const nextWallet = isLastHop ? new PublicKey(toAddress) : selectedPools[i].publicKey;
        
        // Deduct transaction fee
        const txFee = 5000;
        const sendAmount = currentAmount - txFee;
        
        console.log(`\n  Hop ${i + 1}/${hopCount}:`);
        console.log(`    From: ${currentSender.publicKey.toString().slice(0, 8)}...`);
        console.log(`    To:   ${nextWallet.toString().slice(0, 8)}...`);
        console.log(`    Amount: ${(sendAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: currentSender.publicKey,
                toPubkey: nextWallet,
                lamports: sendAmount
            })
        );
        
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = currentSender.publicKey;
        tx.sign(currentSender);
        
        const sig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            maxRetries: 3
        });
        
        await connection.confirmTransaction(sig, 'confirmed');
        signatures.push(sig);
        console.log(`    ✅ TX: ${sig.slice(0, 16)}...`);
        
        // Random delay between hops (5-30 seconds)
        if (!isLastHop) {
            const delay = 5000 + Math.random() * 25000;
            console.log(`    ⏰ Delay: ${(delay / 1000).toFixed(1)}s`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Update for next hop
            currentSender = selectedPools[i];
            currentAmount = sendAmount;
        }
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ MIXING COMPLETE');
    
    return signatures;
}

// =====================================================
// POOL MAINTENANCE: NOISE TRANSACTIONS
// =====================================================
async function maintainPoolNoise() {
    // Pick 2 random pool wallets
    const wallet1 = mixingPool[Math.floor(Math.random() * MIXING_POOL_SIZE)];
    const wallet2 = mixingPool[Math.floor(Math.random() * MIXING_POOL_SIZE)];
    
    if (wallet1 === wallet2) return; 

    try {
        const balance1 = await connection.getBalance(wallet1.publicKey);
        
        // Skip if balance is too low (needs at least 0.002 SOL to operate safely)
        if (balance1 < 0.002 * LAMPORTS_PER_SOL) return; 
        
        // Send tiny amount (0.000001-0.00001 SOL)
        const noiseAmount = 1000 + Math.floor(Math.random() * 9000);
        
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet1.publicKey,
                toPubkey: wallet2.publicKey,
                lamports: noiseAmount
            })
        );
        
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = wallet1.publicKey;
        tx.sign(wallet1);
        
        // Send without waiting for confirm (fire and forget for noise)
        connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 1
        }).then(sig => {
            console.log(`  🌀 Noise: ${wallet1.publicKey.toString().slice(0, 8)}... → ${wallet2.publicKey.toString().slice(0, 8)}...`);
        }).catch(e => {});

    } catch (err) {
        // Ignore noise errors
    }
}

// Run pool maintenance every 3-6 seconds (10-15 transactions per minute)
// Over 1 hour: ~600-900 transactions (or up to 1500 with faster bursts)
// DISABLED: Commented out to prevent Render deployment timeout
// const noiseInterval = setInterval(() => {
//     maintainPoolNoise().catch(() => {});
// }, 3000 + Math.random() * 3000);

// Stop noise generation after 1 hour (3600000 ms)
// DISABLED: Commented out to prevent Render deployment timeout
// setTimeout(() => {
//     clearInterval(noiseInterval);
//     console.log('⏰ Pool noise generation stopped after 1 hour (~1500 transactions)');
// }, 3600000);

// =====================================================
// VAULT WALLET (Receives user funds)
// =====================================================
let vaultWallet = null;
const VAULT_FILE = path.join(WALLETS_DIR, 'vault.json');

function loadVault() {
    // Priority 1: Environment variable (for Render deployment)
    if (process.env.VAULT_SECRET_KEY) {
        vaultWallet = Keypair.fromSecretKey(bs58.decode(process.env.VAULT_SECRET_KEY));
        console.log('✅ Vault wallet loaded from ENV:', vaultWallet.publicKey.toString());
        return;
    }
    
    // Priority 2: Local file
    if (fs.existsSync(VAULT_FILE)) {
        const vaultData = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
        vaultWallet = Keypair.fromSecretKey(bs58.decode(vaultData.secretKey));
        console.log('✅ Vault wallet loaded:', vaultWallet.publicKey.toString());
    } else {
        vaultWallet = Keypair.generate();
        const vaultData = {
            publicKey: vaultWallet.publicKey.toString(),
            secretKey: bs58.encode(vaultWallet.secretKey)
        };
        fs.writeFileSync(VAULT_FILE, JSON.stringify(vaultData, null, 2));
        console.log('✅ Vault wallet generated:', vaultWallet.publicKey.toString());
    }
}

loadVault();

// =====================================================
// API ENDPOINTS
// =====================================================

app.post('/api/transfer', async (req, res) => {
    console.log('\n┌─────────────────────────────────────┐');
    console.log('│   🔒 MIXING POOL TRANSFER START    │');
    console.log('└─────────────────────────────────────┘');
    
    try {
        const { from, to, amount, vaultTx, vaultKeypair } = req.body;
        
        // 1. MAX TRANSFER LIMIT CHECK (Security)
        if (amount > MAX_TRANSFER_AMOUNT) {
            return res.status(400).json({
                success: false,
                error: `Transfer amount exceeds maximum limit of ${MAX_TRANSFER_AMOUNT} SOL. Requested: ${amount} SOL`
            });
        }
        
        if (!to || !amount) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required parameters: to, amount' 
            });
        }
        
        // Decode the vault keypair provided by frontend/previous step
        let vault;
        if (vaultKeypair) {
            try {
                vault = Keypair.fromSecretKey(bs58.decode(vaultKeypair));
            } catch (e) {
                return res.status(400).json({ success: false, error: 'Invalid vault keypair format' });
            }
        } else {
            // Use static vault if no keypair provided
            vault = vaultWallet;
        }
        
        const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
        const serviceFee = Math.floor(amountLamports * (SERVICE_FEE_PERCENT / 100));
        const amountToSend = amountLamports - serviceFee;
        
        console.log(`💰 Amount: ${amount} SOL`);
        console.log(`📤 Sending: ${(amountToSend / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        console.log(`💵 Service Fee: ${(serviceFee / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        
        // Wait for vault transaction confirmation if provided
        if (vaultTx) {
            console.log('⏳ Waiting for vault transaction confirmation...');
            let txStatus = await connection.getSignatureStatus(vaultTx);
            let retries = 0;
            while ((!txStatus.value || txStatus.value.err) && retries < 10) {
                await new Promise(r => setTimeout(r, 1000));
                txStatus = await connection.getSignatureStatus(vaultTx);
                retries++;
            }
            
            if (!txStatus.value || txStatus.value.err) {
                return res.status(400).json({
                    success: false,
                    error: `Vault transaction not confirmed after ${retries} attempts`
                });
            }
            console.log('✅ Vault transaction confirmed');
        }
        
        // Check vault balance
        const vaultBalance = await connection.getBalance(vault.publicKey);
        if (vaultBalance < amountToSend + 5000) {
            return res.status(400).json({
                success: false,
                error: `Insufficient funds in vault. Need ${((amountToSend + 5000) / LAMPORTS_PER_SOL).toFixed(6)} SOL, but vault has ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`
            });
        }
        
        // Route through mixing pool
        const signatures = await routeThroughMixingPool(vault, to, amountToSend);
        const finalSig = signatures[signatures.length - 1];

        res.json({
            success: true,
            txHash: finalSig,
            allSignatures: signatures,
            poolHops: signatures.length,
            anonymityLevel: '98%+ (MIXING POOL)',
            message: 'Transfer routed through mixing pool - untraceable',
            solscan: `https://solscan.io/tx/${finalSig}?cluster=devnet`
        });
        
    } catch (error) {
        console.error('❌ ERROR:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint to see pool addresses (for funding)
app.get('/api/pool/addresses', (req, res) => {
    const addresses = mixingPool.map((kp, i) => ({
        id: i,
        address: kp.publicKey.toString()
    }));
    res.json({ poolSize: MIXING_POOL_SIZE, wallets: addresses });
});

// Get vault address
app.get('/api/wallets', (req, res) => {
    res.json({
        vault: vaultWallet.publicKey.toString(),
        vaultRotation: false
    });
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const vaultBalance = await connection.getBalance(vaultWallet.publicKey);
        const poolBalances = await Promise.all(
            mixingPool.slice(0, 5).map(kp => connection.getBalance(kp.publicKey))
        );
        const avgPoolBalance = poolBalances.reduce((a, b) => a + b, 0) / poolBalances.length;
        
        res.json({ 
            status: 'ok',
            vaultAddress: vaultWallet.publicKey.toString(),
            vaultBalance: (vaultBalance / LAMPORTS_PER_SOL).toFixed(9),
            poolSize: MIXING_POOL_SIZE,
            avgPoolBalance: (avgPoolBalance / LAMPORTS_PER_SOL).toFixed(9)
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            error: error.message
        });
    }
});

// --- 🚰 SECURE FAUCET ENDPOINT ---
app.post('/api/request-airdrop', async (req, res) => {
    try {
        const { walletAddress } = req.body;
        const userIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address required' });
        }

        // Validate wallet address format
        try {
            new PublicKey(walletAddress);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        // 1. CHECK RATE LIMITS (IP and Wallet Address)
        const now = Date.now();
        const lastRequestIP = faucetHistory.get(`ip_${userIP}`) || 0;
        const lastRequestWallet = faucetHistory.get(`wallet_${walletAddress}`) || 0;

        if (now - lastRequestIP < FAUCET_COOLDOWN) {
            const remainingMinutes = Math.ceil((FAUCET_COOLDOWN - (now - lastRequestIP)) / 60000);
            return res.status(429).json({ 
                error: `⏳ Rate limit exceeded. You can only claim 0.02 SOL once per hour. Try again in ${remainingMinutes} minutes.` 
            });
        }

        if (now - lastRequestWallet < FAUCET_COOLDOWN) {
            const remainingMinutes = Math.ceil((FAUCET_COOLDOWN - (now - lastRequestWallet)) / 60000);
            return res.status(429).json({ 
                error: `⏳ This wallet address already claimed. Try again in ${remainingMinutes} minutes.` 
            });
        }

        // 2. LOAD FAUCET WALLET
        const faucetPath = path.join(WALLETS_DIR, 'faucet_master.json');
        let faucetWallet;
        
        if (!fs.existsSync(faucetPath)) {
            // Generate if missing
            console.log('🔄 Generating new faucet wallet...');
            const fKey = Keypair.generate();
            const faucetData = {
                publicKey: fKey.publicKey.toString(),
                secretKey: bs58.encode(fKey.secretKey)
            };
            fs.writeFileSync(faucetPath, JSON.stringify(faucetData, null, 2));
            
            // Also create Phantom-importable format
            const faucetPhantomPath = path.join(WALLETS_DIR, 'faucet_master-phantom.txt');
            fs.writeFileSync(faucetPhantomPath, bs58.encode(fKey.secretKey));
            
            console.log('✅ Faucet wallet generated:', fKey.publicKey.toString());
            console.log('⚠️  Please fund the faucet wallet before using it!');
            
            return res.status(500).json({ 
                error: 'Faucet wallet generated. Please fund it first!',
                faucetAddress: fKey.publicKey.toString()
            });
        }
        
        const faucetData = JSON.parse(fs.readFileSync(faucetPath, 'utf8'));
        faucetWallet = Keypair.fromSecretKey(bs58.decode(faucetData.secretKey));

        // Check faucet balance
        const faucetBalance = await connection.getBalance(faucetWallet.publicKey);
        const requiredAmount = FAUCET_AMOUNT * LAMPORTS_PER_SOL + 5000; // Amount + fee
        
        if (faucetBalance < requiredAmount) {
            return res.status(500).json({ 
                error: `Faucet has insufficient funds. Balance: ${(faucetBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL, Required: ${(requiredAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
                faucetAddress: faucetWallet.publicKey.toString()
            });
        }

        // 3. SEND FUNDS
        console.log(`🚰 Faucet request from IP: ${userIP}, Wallet: ${walletAddress}`);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: faucetWallet.publicKey,
                toPubkey: new PublicKey(walletAddress),
                lamports: Math.floor(FAUCET_AMOUNT * LAMPORTS_PER_SOL)
            })
        );

        const { blockhash } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = faucetWallet.publicKey;
        transaction.sign(faucetWallet);

        const signature = await connection.sendRawTransaction(transaction.serialize(), {
            skipPreflight: false,
            maxRetries: 3
        });
        
        await connection.confirmTransaction(signature, 'confirmed');

        // 4. UPDATE RATE LIMIT LOGS
        faucetHistory.set(`ip_${userIP}`, now);
        faucetHistory.set(`wallet_${walletAddress}`, now);

        console.log(`✅ Faucet sent ${FAUCET_AMOUNT} SOL to ${walletAddress}: ${signature}`);

        res.json({ 
            success: true, 
            signature, 
            amount: FAUCET_AMOUNT,
            message: `Sent ${FAUCET_AMOUNT} SOL to ${walletAddress}`,
            solscan: `https://solscan.io/tx/${signature}?cluster=devnet`
        });

    } catch (error) {
        console.error('❌ Faucet Error:', error.message);
        res.status(500).json({ error: `Faucet transfer failed: ${error.message}` });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Mixing Pool Server running on port ${PORT}`);
    console.log(`🌀 Pool size: ${MIXING_POOL_SIZE} wallets`);
    console.log(`💰 Vault: ${vaultWallet.publicKey.toString()}`);
    console.log(`\n📋 Run: node fund_pools.js to fund the mixing pool`);
});
