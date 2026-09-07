const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SMSPulse-Blockchain-Verifier/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    }).on('error', reject);
  });
}

function httpsPostJson(url, payload) {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(payload);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(dataStr),
        'User-Agent': 'SMSPulse-Blockchain-Verifier/1.0'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(dataStr);
    req.end();
  });
}

/**
 * 1. Verify Tron USDT (TRC-20) or TRX Transaction on Tronscan
 */
async function verifyTronTransaction(txHash, expectedRecipient, expectedMinUsd) {
  const cleanHash = txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
    return { valid: false, reason: 'Invalid Tron transaction hash format (must be 64 hex characters)' };
  }

  try {
    const res = await httpsGet(`https://apilist.tronscanapi.com/api/transaction-info?hash=${cleanHash}`);
    if (res.status !== 200 || !res.data || !res.data.hash) {
      return { valid: false, reason: 'Transaction not found on Tron blockchain. Please wait 1 minute for confirmation or check your TxID.' };
    }

    const tx = res.data;
    if (tx.contractRet !== 'SUCCESS') {
      return { valid: false, reason: `Tron transaction failed on-chain (Result: ${tx.contractRet})` };
    }

    // Check TRC-20 USDT transfer
    if (tx.trc20TransferInfo && tx.trc20TransferInfo.length > 0) {
      const usdtTransfer = tx.trc20TransferInfo.find(t =>
        t.symbol === 'USDT' || t.contract_address === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
      );

      if (!usdtTransfer) {
        return { valid: false, reason: 'Transaction does not contain a USDT (TRC-20) transfer' };
      }

      const recipient = usdtTransfer.to_address;
      const amount = parseFloat(usdtTransfer.amount_str) / 1e6;

      // Strict recipient address match
      if (expectedRecipient && expectedRecipient.length > 10) {
        if (recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
          return {
            valid: false,
            reason: `Fraud Prevention: Transaction was sent to wallet (${recipient}), which does NOT match our official deposit address (${expectedRecipient})`
          };
        }
      }

      if (expectedMinUsd && amount < expectedMinUsd * 0.95) {
        return {
          valid: false,
          reason: `Transferred amount ($${amount} USDT) is less than expected deposit ($${expectedMinUsd})`
        };
      }

      return {
        valid: true,
        hash: tx.hash,
        network: 'Tron (TRC-20)',
        amountUsd: amount,
        recipient,
        sender: usdtTransfer.from_address,
        timestamp: tx.timestamp
      };
    }

    // Native TRX transfer fallback
    if (tx.toAddress) {
      const recipient = tx.toAddress;
      const amountTrx = (tx.contractData?.amount || 0) / 1e6;

      if (expectedRecipient && expectedRecipient.length > 10) {
        if (recipient.toLowerCase() !== expectedRecipient.toLowerCase()) {
          return {
            valid: false,
            reason: `Fraud Prevention: Transaction was sent to wallet (${recipient}), which does NOT match our official deposit address (${expectedRecipient})`
          };
        }
      }

      return {
        valid: true,
        hash: tx.hash,
        network: 'Tron (TRX)',
        amountTrx,
        recipient,
        timestamp: tx.timestamp
      };
    }

    return { valid: false, reason: 'No valid transfer found in this Tron transaction' };
  } catch (err) {
    return { valid: false, reason: `Error connecting to Tron blockchain: ${err.message}` };
  }
}

/**
 * 2. Verify BNB Smart Chain (BEP-20) Transaction on BSC RPC
 * Strictly checks that:
 *  - Transaction succeeded on-chain (status == 0x1)
 *  - Recipient matches expectedRecipient (either token transfer event or native BNB to)
 *  - Transferred amount matches
 */
async function verifyBscTransaction(txHash, expectedRecipient, expectedMinUsd) {
  const cleanHash = txHash.trim().startsWith('0x') ? txHash.trim() : '0x' + txHash.trim();
  if (!/^0x[a-fA-F0-9]{64}$/i.test(cleanHash)) {
    return { valid: false, reason: 'Invalid BSC transaction hash format (must be 66 hex characters starting with 0x)' };
  }

  try {
    // 1. Get receipt to verify status and event logs
    const receiptRes = await httpsPostJson('https://bsc-dataseed.binance.org/', {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [cleanHash]
    });

    if (!receiptRes.data || !receiptRes.data.result) {
      return { valid: false, reason: 'Transaction not found on BSC blockchain or still unconfirmed' };
    }

    const receipt = receiptRes.data.result;
    if (receipt.status !== '0x1') {
      return { valid: false, reason: 'Transaction execution failed on BSC blockchain (reverted)' };
    }

    // 2. Get transaction details to verify sender, receiver, and native value
    const txRes = await httpsPostJson('https://bsc-dataseed.binance.org/', {
      jsonrpc: '2.0',
      id: 2,
      method: 'eth_getTransactionByHash',
      params: [cleanHash]
    });

    const tx = txRes.data?.result;
    if (!tx) {
      return { valid: false, reason: 'Unable to retrieve transaction details from BSC RPC' };
    }

    const expectedWalletNorm = (expectedRecipient || '').trim().toLowerCase();

    // Check for BEP-20 Token Transfers (like USDT BEP-20: 0x55d398326f99059ff775485246999027b3197955)
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    let tokenRecipient = null;
    let tokenAmount = 0;

    if (receipt.logs && receipt.logs.length > 0) {
      for (const log of receipt.logs) {
        if (log.topics && log.topics[0] && log.topics[0].toLowerCase() === TRANSFER_TOPIC.toLowerCase()) {
          if (log.topics[2]) {
            const rawTo = '0x' + log.topics[2].slice(26);
            if (!expectedWalletNorm || rawTo.toLowerCase() === expectedWalletNorm) {
              tokenRecipient = rawTo;
              try {
                // USDT BEP-20 has 18 decimals
                const valBig = BigInt(log.data);
                tokenAmount = Number(valBig / 10000000000000000n) / 100;
              } catch (e) {
                tokenAmount = 0;
              }
              break;
            } else {
              tokenRecipient = rawTo; // note the wrong recipient
            }
          }
        }
      }
    }

    // Check native BNB transfer if no token transfer
    let isNativeMatch = false;
    let nativeAmountBnb = 0;
    if (tx.to && expectedWalletNorm && tx.to.toLowerCase() === expectedWalletNorm) {
      isNativeMatch = true;
      try {
        nativeAmountBnb = parseInt(tx.value, 16) / 1e18;
      } catch (e) {
        nativeAmountBnb = 0;
      }
    }

    // Validation: Did the transaction go to our wallet?
    if (expectedWalletNorm) {
      const isTokenMatch = tokenRecipient && tokenRecipient.toLowerCase() === expectedWalletNorm;
      if (!isTokenMatch && !isNativeMatch) {
        const actualDest = tokenRecipient || tx.to || 'Unknown';
        return {
          valid: false,
          reason: `Fraud Prevention: This transaction was sent to wallet (${actualDest}), NOT to our deposit address (${expectedRecipient}). Verification rejected.`
        };
      }
    }

    // Amount validation if available
    const detectedUsd = tokenAmount > 0 ? tokenAmount : null;
    if (expectedMinUsd && detectedUsd && detectedUsd < expectedMinUsd * 0.95) {
      return {
        valid: false,
        reason: `Transferred amount ($${detectedUsd}) is less than requested deposit ($${expectedMinUsd})`
      };
    }

    return {
      valid: true,
      hash: cleanHash,
      network: 'BNB Smart Chain (BEP-20)',
      amountUsd: detectedUsd,
      blockNumber: parseInt(receipt.blockNumber, 16)
    };
  } catch (err) {
    return { valid: false, reason: `Error connecting to BSC RPC: ${err.message}` };
  }
}

/**
 * 3. Verify Bitcoin Transaction on Blockstream
 * Strictly checks confirmation and that expectedRecipient address is in outputs
 */
async function verifyBtcTransaction(txHash, expectedRecipient) {
  const cleanHash = txHash.trim();
  if (!/^[a-fA-F0-9]{64}$/.test(cleanHash)) {
    return { valid: false, reason: 'Invalid Bitcoin transaction hash format' };
  }

  try {
    const res = await httpsGet(`https://blockstream.info/api/tx/${cleanHash}`);
    if (res.status !== 200 || !res.data || !res.data.txid) {
      return { valid: false, reason: 'Transaction not found on Bitcoin network or still in mempool' };
    }

    const tx = res.data;
    const isConfirmed = tx.status && tx.status.confirmed;
    if (!isConfirmed) {
      return { valid: false, reason: 'Bitcoin transaction is still unconfirmed (0 confirmations). Please wait for network confirmation.' };
    }

    if (expectedRecipient && expectedRecipient.length > 10) {
      const expectedNorm = expectedRecipient.toLowerCase();
      const outputMatch = (tx.vout || []).find(v =>
        v.scriptpubkey_address && v.scriptpubkey_address.toLowerCase() === expectedNorm
      );

      if (!outputMatch) {
        return {
          valid: false,
          reason: `Fraud Prevention: Bitcoin transaction does NOT contain our deposit address (${expectedRecipient}) in its outputs. Verification rejected.`
        };
      }
    }

    return {
      valid: true,
      hash: tx.txid,
      network: 'Bitcoin',
      confirmed: isConfirmed
    };
  } catch (err) {
    return { valid: false, reason: `Error connecting to Bitcoin network: ${err.message}` };
  }
}

/**
 * Master Verification Router
 */
async function verifyCryptoDeposit(method, txHash, expectedRecipient, expectedUsd) {
  if (!txHash || txHash.trim().length < 10) {
    return { valid: false, reason: 'Transaction ID is too short or empty' };
  }

  const m = method.toLowerCase();

  if (m === 'usdt_trc20' || m === 'trx') {
    return await verifyTronTransaction(txHash, expectedRecipient, expectedUsd);
  }

  if (m === 'usdt_bep20' || m === 'bnb') {
    return await verifyBscTransaction(txHash, expectedRecipient, expectedUsd);
  }

  if (m === 'btc') {
    return await verifyBtcTransaction(txHash, expectedRecipient);
  }

  // Other networks (Solana, TON, Doge, LTC, Bank Transfer, Binance Pay) require manual review by Admin
  return {
    valid: false,
    manualCheck: true,
    reason: 'This payment method requires Admin manual verification. Your deposit will be reviewed shortly.'
  };
}

module.exports = {
  verifyTronTransaction,
  verifyBscTransaction,
  verifyBtcTransaction,
  verifyCryptoDeposit
};
