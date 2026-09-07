const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');
const verifier = require('../providers/blockchainVerifier');

// Get active payment methods (10 Crypto Tokens + Binance Pay + Bank Transfer)
router.get('/methods', (req, res) => {
  const settings = readData('settings');
  const rate = settings.exchangeRate || 280;

  res.json({
    success: true,
    exchangeRate: rate,
    methods: [
      {
        id: 'binance_pay',
        name: 'Binance Pay ID',
        symbol: 'PAY',
        category: 'crypto',
        currency: 'USD',
        badge: 'Instant 0% Fee',
        icon: '⚡',
        network: 'Binance App (Internal Transfer)',
        accountTitle: settings.binancePay?.accountTitle || 'Rizwan009',
        address: settings.binancePay?.binancePayId || '58677217',
        instructions: 'Open Binance App > Pay > Send to Binance Pay ID: ' + (settings.binancePay?.binancePayId || '58677217') + ' (Nickname: ' + (settings.binancePay?.accountTitle || 'Rizwan009') + '). Paste the 19-digit Order ID below for verification.',
        minDepositUsd: 1.0,
        fee: '0%'
      },
      {
        id: 'usdt_trc20',
        name: 'USDT (TRC-20)',
        symbol: 'USDT',
        category: 'crypto',
        currency: 'USD',
        badge: 'Instant Auto-Verify',
        icon: '₮',
        network: 'Tron (TRC-20)',
        address: settings.cryptoUsdt?.address || 'TSwa6EWKgnz2zmkCYqRhLxHysufH9sumEY',
        instructions: 'Send USDT via TRC-20 network to the address below. Paste your Tronscan TxID for instant automatic blockchain verification and balance credit.',
        minDepositUsd: 2.0,
        fee: '0%'
      },
      {
        id: 'usdt_bep20',
        name: 'USDT / BEP-20',
        symbol: 'USDT',
        category: 'crypto',
        currency: 'USD',
        badge: 'Instant Auto-Verify',
        icon: '₮',
        network: 'BNB Smart Chain (BEP-20)',
        address: settings.cryptoBep20?.address || '0xe9313ff6d8e69ce1e7d2f07c55bac432e91543e1',
        instructions: 'Send USDT via BNB Smart Chain (BEP-20). Paste your BSC TxHash for instant automated blockchain credit.',
        minDepositUsd: 2.0,
        fee: '0%'
      },
      {
        id: 'trx',
        name: 'TRX (TRC-20)',
        symbol: 'TRX',
        category: 'crypto',
        currency: 'USD',
        badge: 'Instant Auto-Verify',
        icon: '🔴',
        network: 'Tron (TRC-20)',
        address: settings.cryptoTrx?.address || 'TSwa6EWKgnz2zmkCYqRhLxHysufH9sumEY',
        instructions: 'Send TRX via Tron (TRC-20) network. Paste your Tronscan TxID below.',
        minDepositUsd: 2.0,
        fee: '0%'
      },
      {
        id: 'sol',
        name: 'Solana (SOL)',
        symbol: 'SOL',
        category: 'crypto',
        currency: 'USD',
        badge: 'Ultra Fast',
        icon: '🟣',
        network: 'Solana Network',
        address: settings.cryptoSol?.address || '5KGxjDh7JgT6A7Lusz8n4L7qiG4B1S8jRnpuCzwJfTYw',
        instructions: 'Send SOL via Solana blockchain to the address below. Paste the Solscan Signature / TxHash below.',
        minDepositUsd: 2.0,
        fee: '0%'
      },
      {
        id: 'doge',
        name: 'Dogecoin (DOGE)',
        symbol: 'DOGE',
        category: 'crypto',
        currency: 'USD',
        badge: 'Popular Meme Coin',
        icon: '🐕',
        network: 'Dogecoin Network',
        address: settings.cryptoDoge?.address || 'DTsHVEfzXozEAvRvQDWDrSTUqR9wJzz7Vy',
        instructions: 'Send DOGE via Dogecoin blockchain to the address below. Paste your Dogechain TxID below.',
        minDepositUsd: 2.0,
        fee: '0%'
      },
      {
        id: 'bank_transfer',
        name: 'MCB Bank Transfer',
        symbol: 'PKR',
        category: 'bank',
        currency: 'PKR',
        badge: 'Direct Bank',
        icon: '🏦',
        bankName: settings.bankTransfer?.bankName || 'MCB Bank Ltd',
        accountTitle: settings.bankTransfer?.accountTitle || 'Muhammad Rizwan Saeed',
        accountNumber: settings.bankTransfer?.accountNumber || '1156509301002436',
        iban: settings.bankTransfer?.accountNumber || '1156509301002436',
        instructions: 'Transfer funds via your mobile banking app, ATM, or Raast to MCB Bank Ltd. Paste the transaction reference ID below.',
        minDepositPkr: 500,
        minDepositUsd: 2.0,
        fee: '0%'
      }
    ]
  });
});

router.post('/deposit', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { method, amountUsd, amountPkr, tid, senderName, senderNumber } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'Please log in to make a deposit' });
  }

  if (!tid || tid.trim().length < 6) {
    return res.status(400).json({ error: 'Transaction ID (TID / TxHash) is required' });
  }

  const cleanTid = tid.trim();

  // 1. Anti-Fraud & Anti-Replay Guard: Check if this TxID has already been submitted or credited
  const deposits = readData('deposits');
  const existing = deposits.find(d => d.tid && d.tid.toLowerCase() === cleanTid.toLowerCase());
  if (existing) {
    return res.status(400).json({
      error: `Fraud Prevention: This Transaction ID (${cleanTid}) has already been used and credited! Duplicate submissions are blocked.`
    });
  }

  const users = readData('users');
  const user = users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const settings = readData('settings');
  const rate = settings.exchangeRate || 280;
  let finalUsd = +parseFloat(amountUsd || (amountPkr / rate)).toFixed(2);
  let finalPkr = Math.round(amountPkr || (finalUsd * rate));

  if (finalUsd <= 0) {
    return res.status(400).json({ error: 'Invalid deposit amount' });
  }

  // 2. Blockchain Bot Automatic Verification
  const isCrypto = method !== 'bank_transfer' && method !== 'binance_pay';
  let isAutoApproved = false;
  let verificationDetails = null;

  if (isCrypto) {
    let expectedWallet = '';
    if (method === 'usdt_trc20' || method === 'trx') expectedWallet = settings.cryptoUsdt?.address;
    else if (method === 'usdt_bep20') expectedWallet = settings.cryptoBep20?.address;
    else if (method === 'sol') expectedWallet = settings.cryptoSol?.address;
    else if (method === 'doge') expectedWallet = settings.cryptoDoge?.address;

    // Query live blockchain
    console.log(`[BLOCKCHAIN BOT] Verifying ${method} TxHash: ${cleanTid}...`);
    const vResult = await verifier.verifyCryptoDeposit(method, cleanTid, expectedWallet, finalUsd);

    if (!vResult.valid) {
      if (vResult.manualCheck) {
        isAutoApproved = false;
        console.log(`[DEPOSIT PENDING] Method ${method} requires Admin manual verification`);
      } else {
        console.warn(`[BLOCKCHAIN BOT REJECTED]:`, vResult.reason);
        return res.status(400).json({
          error: `Blockchain Verification Failed: ${vResult.reason}`
        });
      }
    } else {
      isAutoApproved = true;
      if (vResult.amountUsd) {
        finalUsd = vResult.amountUsd;
        finalPkr = Math.round(finalUsd * rate);
      }
      verificationDetails = vResult;
      console.log(`[BLOCKCHAIN BOT SUCCESS] Auto-approved ${finalUsd} for user ${user.name}`);
    }
  }

  const status = isAutoApproved ? 'APPROVED' : 'PENDING';
  const depId = 'dep_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

  const newDeposit = {
    id: depId,
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    method,
    amountUsd: finalUsd,
    amountPkr: finalPkr,
    tid: cleanTid,
    senderName: senderName || '',
    senderNumber: senderNumber || '',
    status,
    verifiedOnChain: isAutoApproved,
    verificationDetails,
    createdAt: new Date().toISOString()
  };

  deposits.unshift(newDeposit);
  writeData('deposits', deposits);

  // Instantly credit user wallet balance if auto-approved!
  if (status === 'APPROVED') {
    user.balanceUsd = +(user.balanceUsd + finalUsd).toFixed(2);
    user.balancePkr = Math.round(user.balanceUsd * rate);
    writeData('users', users);
  }

  res.json({
    success: true,
    message: isAutoApproved
      ? `⚡ Real blockchain transaction verified! $${finalUsd} (₨ ${finalPkr}) credited to your wallet instantly!`
      : `Deposit request submitted! MCB Bank Transfer Reference (${cleanTid}) received. Admin will verify and credit your balance.`,
    deposit: newDeposit,
    newBalanceUsd: user.balanceUsd,
    newBalancePkr: user.balancePkr,
    autoApproved: isAutoApproved
  });
});

// Get user deposits
router.get('/my', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const deposits = readData('deposits');
  const userDeposits = deposits.filter(d => d.userId === userId);
  res.json({ success: true, deposits: userDeposits });
});

module.exports = router;
