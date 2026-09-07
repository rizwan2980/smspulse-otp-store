const express = require('express');
const router = express.Router();
const { readData } = require('../db');
const pricingSync = require('../providers/pricingSync');

// Get all services
router.get('/services', (req, res) => {
  const services = readData('services');
  const settings = readData('settings');
  const margin = 1 + (settings.profitMarginPercent || 0) / 100;

  // Apply profit margin and PKR conversion
  const adjusted = services.map(s => {
    const finalPriceUsd = +(s.priceUsd * margin).toFixed(2);
    const finalPricePkr = Math.round(finalPriceUsd * (settings.exchangeRate || 280));
    return {
      ...s,
      priceUsd: finalPriceUsd,
      pricePkr: finalPricePkr
    };
  });

  res.json({ success: true, services: adjusted });
});

// Get all countries
router.get('/countries', (req, res) => {
  const countries = readData('countries');
  res.json({ success: true, countries });
});

// Calculate live price for service + country directly from 5SIM
router.get(['/price', '/services/price'], async (req, res) => {
  const { serviceId, countryId } = req.query;
  const services = readData('services');
  const countries = readData('countries');

  const s = services.find(x => x.id === serviceId);
  const c = countries.find(x => x.id === countryId);

  if (!s || !c) {
    return res.status(404).json({ error: 'Service or Country not found' });
  }

  try {
    const liveData = await pricingSync.getLivePriceData(countryId, serviceId);

    res.json({
      success: true,
      service: s.name,
      country: c.name,
      priceUsd: liveData.retailPriceUsd,
      pricePkr: liveData.retailPricePkr,
      wholesaleCostUsd: liveData.wholesaleCostUsd,
      profitUsd: liveData.profitUsd,
      totalStock: liveData.totalStock,
      hasStock: liveData.hasStock,
      operators: liveData.operators
    });
  } catch (err) {
    console.error('Error fetching live price:', err);
    res.status(500).json({ error: 'Failed to fetch live pricing from provider' });
  }
});

// Statistics
router.get('/stats', (req, res) => {
  const orders = readData('orders');
  const users = readData('users');

  const totalActivations = 254890 + orders.length;
  const successRate = '99.4%';
  const availableNumbers = '1,492,084';

  res.json({
    success: true,
    totalActivations,
    successRate,
    availableNumbers,
    registeredUsers: users.length + 8400
  });
});

// 5SIM Smart Buy Catalog with starting prices
router.get('/smart-catalog', (req, res) => {
  const services = readData('services');
  const settings = readData('settings');
  const margin = 1 + (settings.profitMarginPercent || 0) / 100;
  const rate = settings.exchangeRate || 280;

  const baselinePrices = {
    facebook: 0.15,
    whatsapp: 0.35,
    telegram: 0.25,
    google: 0.12,
    openai: 0.08,
    instagram: 0.05,
    tiktok: 0.22,
    netflix: 0.60,
    amazon: 0.60,
    microsoft: 0.30,
    twitter: 0.25,
    discord: 0.18,
    apple: 0.40,
    paypal: 0.50,
    snapchat: 0.20,
    uber: 0.25,
    tinder: 0.35,
    binance: 0.45,
    steam: 0.30
  };

  const catalog = services.map(s => {
    const raw = baselinePrices[s.id] || s.priceUsd || 0.15;
    const finalUsd = +(raw * margin).toFixed(2);
    const finalPkr = Math.round(finalUsd * rate);
    return {
      id: s.id,
      name: s.name,
      category: s.category || 'popular',
      startingPriceUsd: finalUsd,
      startingPricePkr: finalPkr
    };
  });

  res.json({ success: true, services: catalog });
});

module.exports = router;
