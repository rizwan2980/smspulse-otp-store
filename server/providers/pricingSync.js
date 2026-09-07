const https = require('https');
const { readData } = require('../db');

// In-memory cache with 2 minutes TTL
const priceCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;

// Map country names to 5SIM country keys
const countryMap = {
  usa: 'usa',
  england: 'england',
  canada: 'canada',
  indonesia: 'indonesia',
  philippines: 'philippines',
  pakistan: 'pakistan',
  india: 'india',
  germany: 'germany',
  france: 'france',
  brazil: 'brazil',
  netherlands: 'netherlands',
  turkey: 'turkey',
  kazakhstan: 'kazakhstan',
  vietnam: 'vietnam',
  colombia: 'colombia',
  southafrica: 'southafrica',
  russia: 'russia',
  nigeria: 'nigeria',
  egypt: 'egypt',
  bangladesh: 'bangladesh',
  kenya: 'kenya',
  argentina: 'argentina',
  mexico: 'mexico',
  poland: 'poland',
  spain: 'spain',
  italy: 'italy'
};

function fetch5simPrice(country, product) {
  return new Promise((resolve) => {
    const cacheKey = `${country}_${product}`;
    const cached = priceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return resolve(cached.data);
    }

    const url = `https://5sim.net/v1/guest/prices?country=${country}&product=${product}`;
    https.get(url, { headers: { 'User-Agent': 'SMSPulse-PriceSync/1.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          priceCache.set(cacheKey, { timestamp: Date.now(), data: parsed });
          resolve(parsed);
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Get real live pricing for a service in a country, with admin margin and exchange rate applied
 */
async function getLivePriceData(countryId, serviceId) {
  const settings = readData('settings');
  const marginPercent = settings.profitMarginPercent || 0;
  const marginMultiplier = 1 + (marginPercent / 100);
  const rate = settings.exchangeRate || 280;

  const fCountry = countryMap[countryId] || countryId;
  const fProduct = serviceId.toLowerCase();

  const raw = await fetch5simPrice(fCountry, fProduct);
  const productData = raw?.[fCountry]?.[fProduct] || {};

  const specificOperators = [];
  let minCostWholesale = Infinity;
  let totalStock = 0;

  // 1. Find the true minimum price across ALL operators on 5SIM (exact 5SIM Any Operator price)
  for (const [opKey, opInfo] of Object.entries(productData)) {
    const cost = opInfo.cost || 0;
    if (cost > 0 && cost < minCostWholesale) {
      minCostWholesale = cost;
    }
  }

  // 2. Collect all specific operators that have stock
  for (const [opKey, opInfo] of Object.entries(productData)) {
    const count = opInfo.count || 0;
    const cost = opInfo.cost || 0;
    const ratePercent = opInfo.rate3 || opInfo.rate || 0;

    if (count > 0 && cost > 0) {
      totalStock += count;

      const retailUsd = +(cost * marginMultiplier).toFixed(2);
      const retailPkr = Math.round(retailUsd * rate);

      specificOperators.push({
        id: opKey,
        name: opKey.charAt(0).toUpperCase() + opKey.slice(1),
        costWholesale: cost,
        retailUsd,
        retailPkr,
        count,
        successRate: ratePercent ? `${Math.round(ratePercent * 100) / 100}%` : null
      });
    }
  }

  // Sort specific operators by retail price descending (Highest price & highest quality at the TOP!)
  specificOperators.sort((a, b) => b.retailUsd - a.retailUsd);

  if (minCostWholesale === Infinity) {
    minCostWholesale = 0.50;
  }

  const anyRetailUsd = +(minCostWholesale * marginMultiplier).toFixed(2);
  const anyRetailPkr = Math.round(anyRetailUsd * rate);

  // Exact 5SIM ordering: Specific operators first, then "Any operator" at the bottom!
  const operatorOptions = [...specificOperators];

  operatorOptions.push({
    id: 'any',
    name: 'Any operator',
    costWholesale: minCostWholesale,
    retailUsd: anyRetailUsd,
    retailPkr: anyRetailPkr,
    count: totalStock,
    successRate: null
  });

  return {
    success: true,
    country: countryId,
    service: serviceId,
    wholesaleCostUsd: minCostWholesale,
    retailPriceUsd: anyRetailUsd,
    retailPricePkr: anyRetailPkr,
    profitMarginPercent: marginPercent,
    profitUsd: +(anyRetailUsd - minCostWholesale).toFixed(2),
    totalStock,
    hasStock: totalStock > 0,
    operators: operatorOptions
  };
}

module.exports = {
  getLivePriceData,
  countryMap
};
