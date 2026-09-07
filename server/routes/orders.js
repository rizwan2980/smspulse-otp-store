const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');
const fivesim = require('../providers/fiveSim');
const pricingSync = require('../providers/pricingSync');

// SMS Polling Helper
function setupSmsPolling(orderId, fiveSimId, s, isLive5sim, settings) {
  if (!isLive5sim || !fiveSimId) return;

  const pollInterval = setInterval(async () => {
    try {
      const check = await fivesim.checkOrder(settings.apiToken5sim, fiveSimId);
      if (check.status === 200 && check.data) {
        const freshOrders = readData('orders');
        const ord = freshOrders.find(o => o.id === orderId);
        if (!ord || ord.status === 'CANCELLED' || ord.status === 'TIMEOUT' || ord.status === 'FINISHED') {
          clearInterval(pollInterval);
          return;
        }

        if (check.data.sms && Array.isArray(check.data.sms) && check.data.sms.length > 0) {
          ord.status = 'RECEIVED';
          ord.smsList = check.data.sms.map(m => ({
            sender: m.sender || s.name,
            code: m.code || (m.text.match(/\b\d{4,8}\b/)?.[0] || '123456'),
            text: m.text,
            receivedAt: m.date || new Date().toISOString()
          }));
          writeData('orders', freshOrders);
          clearInterval(pollInterval);
          console.log(`[5SIM SMS RECEIVED!] Order ${orderId}: `, ord.smsList);
        } else if (check.data.status === 'CANCELED' || check.data.status === 'TIMEOUT' || check.data.status === 'BANNED') {
          ord.status = 'CANCELLED';
          writeData('orders', freshOrders);
          clearInterval(pollInterval);

          const freshUsers = readData('users');
          const u = freshUsers.find(x => x.id === ord.userId);
          if (u) {
            u.balanceUsd = +(u.balanceUsd + ord.costUsd).toFixed(2);
            u.balancePkr = Math.round(u.balanceUsd * (settings.exchangeRate || 280));
            writeData('users', freshUsers);
            console.log(`[AUTO REFUND] 5SIM cancelled order ${orderId}, refunded $${ord.costUsd} to user ${u.name}`);
          }
        }
      }
    } catch (e) {
      console.error('5SIM SMS Polling Error:', e.message);
    }
  }, 3500);

  setTimeout(async () => {
    clearInterval(pollInterval);
    const freshOrders = readData('orders');
    const ord = freshOrders.find(o => o.id === orderId);
    if (ord && (ord.status === 'PENDING' || (ord.status === 'RECEIVED' && (!ord.smsList || ord.smsList.length === 0)))) {
      ord.status = 'TIMEOUT';
      writeData('orders', freshOrders);
      try {
        await fivesim.cancelOrder(settings.apiToken5sim, fiveSimId);
      } catch(e) {}
      const freshUsers = readData('users');
      const u = freshUsers.find(x => x.id === ord.userId);
      if (u) {
        u.balanceUsd = +(u.balanceUsd + ord.costUsd).toFixed(2);
        u.balancePkr = Math.round(u.balanceUsd * (settings.exchangeRate || 280));
        writeData('users', freshUsers);
        console.log(`[TIMEOUT REFUND] Order ${orderId} timed out, refunded $${ord.costUsd}`);
      }
    }
  }, 15 * 60 * 1000);
}

// Core Purchase Logic
async function handleBuyOrder(req, res, serviceId, countryId, operator = 'any', isSmartBuy = false) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Please sign in to buy numbers' });

  const users = readData('users');
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const services = readData('services');
  const countries = readData('countries');
  const settings = readData('settings');

  const s = services.find(x => x.id === serviceId);
  const c = countries.find(x => x.id === countryId);

  if (!s || !c) return res.status(400).json({ error: 'Invalid service or country selected' });

  let costUsd = 0.50;
  let costPkr = 140;
  let wholesaleCost = 0.40;
  let adminProfit = 0.10;
  let chosenOperatorName = operator;

  try {
    const liveData = await pricingSync.getLivePriceData(c.id, s.id);
    let matchedOp = (liveData.operators || []).find(op => op.id.toLowerCase() === (operator || '').toLowerCase());
    if (!matchedOp && liveData.operators && liveData.operators.length > 0) {
      matchedOp = liveData.operators[0];
    }

    if (matchedOp) {
      costUsd = matchedOp.retailUsd;
      costPkr = matchedOp.retailPkr;
      wholesaleCost = matchedOp.costWholesale;
      adminProfit = +(costUsd - wholesaleCost).toFixed(2);
      chosenOperatorName = matchedOp.name;
    }
  } catch (err) {
    console.error('Pricing sync error:', err.message);
  }

  if (user.balanceUsd < costUsd) {
    return res.status(400).json({
      error: `Insufficient balance! Live price is $${costUsd} (₨ ${costPkr}), but your current balance is $${user.balanceUsd.toFixed(2)} (₨ ${user.balancePkr}). Please top up your wallet.`,
      needsTopUp: true
    });
  }

  let realPhone = '';
  let fiveSimId = null;
  let isLive5sim = false;

  if (settings.apiToken5sim) {
    const fCountry = pricingSync.countryMap[c.id] || c.id;
    const fProduct = s.id;
    const fOperator = operator || 'any';

    try {
      console.log(`[5SIM LIVE BUY] Country=${fCountry}, Operator=${fOperator}, Product=${fProduct}, Wholesale=$${wholesaleCost}, Retail=$${costUsd}`);
      const fiveRes = await fivesim.buyActivation(settings.apiToken5sim, fCountry, fOperator, fProduct);

      if (fiveRes.status === 200 && fiveRes.data && fiveRes.data.phone) {
        realPhone = fiveRes.data.phone;
        fiveSimId = fiveRes.data.id;
        isLive5sim = true;
        console.log(`[5SIM API SUCCESS] Live Phone: ${realPhone} (5SIM ID: ${fiveSimId})`);
      } else {
        const errMsg = typeof fiveRes.data === 'string' ? fiveRes.data : (fiveRes.data?.error || JSON.stringify(fiveRes.data));
        console.warn(`[5SIM API Stock Warning]:`, errMsg);

        return res.status(400).json({
          error: `5SIM currently has no stock available for ${s.name} in ${c.name} (${fOperator}). Provider response: ${errMsg}. Please select another country or operator. Your balance was NOT deducted.`
        });
      }
    } catch (fErr) {
      console.error('[5SIM API Error]', fErr.message);
      return res.status(500).json({
        error: `Error connecting to 5SIM API: ${fErr.message}. Your balance was NOT deducted.`
      });
    }
  } else {
    const prefixes = { usa: '+1 202 ', england: '+44 7911 ', canada: '+1 416 ', indonesia: '+62 812 ', pakistan: '+92 300 ' };
    const prefix = prefixes[c.id] || `${c.code || '+1'} 555 `;
    realPhone = `${prefix}${Math.floor(100000 + Math.random() * 900000)}`;
  }

  user.balanceUsd = +(user.balanceUsd - costUsd).toFixed(2);
  user.balancePkr = Math.round(user.balanceUsd * (settings.exchangeRate || 280));
  writeData('users', users);

  const orderId = 'ord_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const newOrder = {
    id: orderId,
    fiveSimId,
    isLive5sim,
    isSmartBuy,
    userId: user.id,
    serviceId: s.id,
    serviceName: s.name,
    serviceIcon: s.icon,
    countryId: c.id,
    countryName: c.name,
    countryFlag: c.flag,
    operator: chosenOperatorName,
    phone: realPhone,
    costUsd,
    costPkr,
    wholesaleCostUsd: wholesaleCost,
    adminProfitUsd: adminProfit,
    status: 'PENDING',
    smsList: [],
    createdAt: new Date().toISOString(),
    expiresAt
  };

  const orders = readData('orders');
  orders.unshift(newOrder);
  writeData('orders', orders);

  setupSmsPolling(orderId, fiveSimId, s, isLive5sim, settings);

  res.json({
    success: true,
    message: isLive5sim 
      ? `⚡ Live virtual number ${realPhone} (${c.name}) connected from 5SIM! Waiting for incoming SMS...`
      : `Virtual number generated! Waiting for SMS code...`,
    order: newOrder,
    newBalanceUsd: user.balanceUsd,
    newBalancePkr: user.balancePkr,
    isLive5sim
  });
}

// 1. Standard Manual Buy Route
router.post('/buy', async (req, res) => {
  const { serviceId, countryId, operator = 'any' } = req.body;
  return handleBuyOrder(req, res, serviceId, countryId, operator, false);
});

// 2. 5SIM Smart Buy Route (1-Click Automated Country & Operator Selection)
router.post('/smart-buy', async (req, res) => {
  const { serviceId, maxPrice = null } = req.body;
  if (!serviceId) return res.status(400).json({ error: 'Service ID is required' });

  const candidateCountries = ['indonesia', 'philippines', 'england', 'usa', 'pakistan', 'india', 'netherlands', 'france', 'germany'];
  let chosenCountryId = null;
  let lowestPrice = Infinity;

  for (const cId of candidateCountries) {
    try {
      const liveData = await pricingSync.getLivePriceData(cId, serviceId);
      if (liveData && liveData.hasStock && liveData.retailPriceUsd > 0) {
        if (!maxPrice || liveData.retailPriceUsd <= parseFloat(maxPrice)) {
          if (liveData.retailPriceUsd < lowestPrice) {
            lowestPrice = liveData.retailPriceUsd;
            chosenCountryId = cId;
          }
        }
      }
    } catch (e) {}
  }

  if (!chosenCountryId) {
    chosenCountryId = 'usa';
  }

  return handleBuyOrder(req, res, serviceId, chosenCountryId, 'any', true);
});

// Instant Cancel & Auto-Refund (Refundable anytime before SMS is delivered)
router.post('/:orderId/cancel', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { orderId } = req.params;

  const orders = readData('orders');
  const order = orders.find(o => o.id === orderId && o.userId === userId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (order.status === 'CANCELLED') {
    return res.status(400).json({ error: 'Order has already been cancelled and refunded.' });
  }

  if (order.smsList && order.smsList.length > 0) {
    return res.status(400).json({
      error: 'Cannot cancel order after SMS verification code has already been received! Service is delivered.'
    });
  }

  const settings = readData('settings');

  if (order.isLive5sim && order.fiveSimId && settings.apiToken5sim) {
    try {
      const cRes = await fivesim.cancelOrder(settings.apiToken5sim, order.fiveSimId);
      console.log(`[5SIM CANCELLED] 5SIM ID: ${order.fiveSimId}`, cRes.data);
      if (cRes.status !== 200) {
        await fivesim.banOrder(settings.apiToken5sim, order.fiveSimId);
        console.log(`[5SIM BANNED] 5SIM ID: ${order.fiveSimId}`);
      }
    } catch(e) {
      console.warn(`[5SIM Cancel Warning]:`, e.message);
    }
  }

  const users = readData('users');
  const user = users.find(u => u.id === userId);
  if (user) {
    user.balanceUsd = +(user.balanceUsd + order.costUsd).toFixed(2);
    user.balancePkr = Math.round(user.balanceUsd * (settings.exchangeRate || 280));
    writeData('users', users);
    console.log(`[USER REFUNDED] $${order.costUsd} refunded to ${user.name}. New balance: $${user.balanceUsd}`);
  }

  order.status = 'CANCELLED';
  writeData('orders', orders);

  res.json({
    success: true,
    message: '⚡ Order cancelled instantly! Full amount refunded back to your wallet.',
    newBalanceUsd: user ? user.balanceUsd : 0,
    newBalancePkr: user ? user.balancePkr : 0
  });
});

// Finish / Complete order
router.post('/:orderId/finish', async (req, res) => {
  const userId = req.headers['x-user-id'];
  const { orderId } = req.params;

  const orders = readData('orders');
  const order = orders.find(o => o.id === orderId && o.userId === userId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const settings = readData('settings');

  if (order.isLive5sim && order.fiveSimId && settings.apiToken5sim) {
    try {
      await fivesim.finishOrder(settings.apiToken5sim, order.fiveSimId);
      console.log(`[5SIM FINISHED] 5SIM ID: ${order.fiveSimId}`);
    } catch(e) {
      console.warn(`[5SIM Finish Warning]:`, e.message);
    }
  }

  order.status = 'FINISHED';
  writeData('orders', orders);

  res.json({
    success: true,
    message: 'Activation completed successfully!'
  });
});

// Get user orders (Active vs History)
router.get('/my', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const orders = readData('orders');
  const userOrders = orders.filter(o => o.userId === userId);

  const active = userOrders.filter(o => o.status === 'PENDING' || (o.status === 'RECEIVED' && o.status !== 'FINISHED' && o.status !== 'CANCELLED'));
  const history = userOrders.filter(o => o.status === 'CANCELLED' || o.status === 'TIMEOUT' || o.status === 'FINISHED');

  res.json({
    success: true,
    orders: userOrders,
    active,
    history
  });
});

module.exports = router;
