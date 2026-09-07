const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readData(collection, defaultData = []) {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) {
    writeData(collection, defaultData);
    return defaultData;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${collection}:`, err);
    return defaultData;
  }
}

function writeData(collection, data) {
  const filePath = getFilePath(collection);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Initialize seed data
function initializeDatabase() {
  // Users
  const users = readData('users', [
    {
      id: 'usr_default_admin',
      name: 'Super Admin',
      email: 'admin@5sim.store',
      password: 'admin',
      role: 'admin',
      balanceUsd: 100.0,
      balancePkr: 28000.0,
      createdAt: new Date().toISOString()
    },
    {
      id: 'usr_demo_user',
      name: 'Rizwan User',
      email: 'user@example.com',
      password: 'user123',
      role: 'user',
      balanceUsd: 10.0,
      balancePkr: 2800.0,
      createdAt: new Date().toISOString()
    }
  ]);

  // Settings
  const settings = readData('settings', {
    siteName: 'SMSPulse',
    tagline: 'Global Virtual Numbers & Instant SMS Verification',
    exchangeRate: 280, // 1 USD = 280 PKR
    profitMarginPercent: 20,
    apiToken5sim: '',
    
    cryptoUsdt: {
      network: 'TRC20 / Binance Pay ID',
      address: 'TYj4K6M9eP8Q7wX1z2L3v4B5n6M7q8R9sT',
      binancePayId: '829471920',
      instructions: 'Send USDT (TRC20) or Binance Pay and enter TxID.'
    },
    bankTransfer: {
      bankName: 'Meezan Bank Ltd',
      accountTitle: 'SMSPULSE DIGITAL',
      accountNumber: '0102030405060708',
      iban: 'PK00MEZN0001020304050607'
    }
  });

  // Services Catalog
  const defaultServices = [
    { id: 'whatsapp', name: 'WhatsApp', icon: 'whatsapp', priceUsd: 0.18, qty: 131405593, category: 'Messengers' },
    { id: 'telegram', name: 'Telegram', icon: 'telegram', priceUsd: 0.15, qty: 125103558, category: 'Messengers' },
    { id: 'google', name: 'Google / YouTube', icon: 'google', priceUsd: 0.12, qty: 157946152, category: 'Tech' },
    { id: 'openai', name: 'OpenAI / ChatGPT', icon: 'openai', priceUsd: 0.20, qty: 23121259, category: 'AI Tools' },
    { id: 'instagram', name: 'Instagram / Threads', icon: 'instagram', priceUsd: 0.10, qty: 93071282, category: 'Social' },
    { id: 'facebook', name: 'Facebook', icon: 'facebook', priceUsd: 0.08, qty: 33745649, category: 'Social' },
    { id: 'tiktok', name: 'TikTok / Douyin', icon: 'tiktok', priceUsd: 0.12, qty: 67104820, category: 'Social' },
    { id: 'amazon', name: 'Amazon', icon: 'amazon', priceUsd: 0.08, qty: 34442295, category: 'Shopping' },
    { id: 'microsoft', name: 'Microsoft / Outlook', icon: 'microsoft', priceUsd: 0.09, qty: 146354482, category: 'Tech' },
    { id: 'netflix', name: 'Netflix', icon: 'netflix', priceUsd: 0.25, qty: 18450120, category: 'Streaming' },
    { id: 'twitter', name: 'Twitter / X', icon: 'twitter', priceUsd: 0.14, qty: 45910230, category: 'Social' },
    { id: 'discord', name: 'Discord', icon: 'discord', priceUsd: 0.10, qty: 52190340, category: 'Gaming' },
    { id: 'steam', name: 'Steam', icon: 'steam', priceUsd: 0.12, qty: 29810450, category: 'Gaming' },
    { id: 'binance', name: 'Binance', icon: 'binance', priceUsd: 0.35, qty: 14209180, category: 'Finance' },
    { id: 'apple', name: 'Apple ID / iCloud', icon: 'apple', priceUsd: 0.22, qty: 84910834, category: 'Tech' },
    { id: 'paypal', name: 'PayPal', icon: 'paypal', priceUsd: 0.40, qty: 12401920, category: 'Finance' },
    { id: 'tinder', name: 'Tinder', icon: 'tinder', priceUsd: 0.28, qty: 19482100, category: 'Dating' },
    { id: 'uber', name: 'Uber / UberEats', icon: 'uber', priceUsd: 0.15, qty: 31020490, category: 'Travel' },
    { id: 'snapchat', name: 'Snapchat', icon: 'snapchat', priceUsd: 0.10, qty: 41829100, category: 'Social' },
    { id: 'spotify', name: 'Spotify', icon: 'spotify', priceUsd: 0.12, qty: 27192030, category: 'Streaming' },
    { id: 'dola', name: 'Dola AI', icon: 'dola', priceUsd: 0.15, qty: 8409200, category: 'AI Tools' },
    { id: 'claude', name: 'Anthropic Claude', icon: 'claude', priceUsd: 0.30, qty: 5491020, category: 'AI Tools' },
    { id: 'other', name: 'Any Other (Service Not Listed)', icon: 'other', priceUsd: 0.15, qty: 250000000, category: 'General' }
  ];
  readData('services', defaultServices);

  // Countries Catalog
  const defaultCountries = [
    { id: 'england', name: 'England (UK)', code: '+44', iso: 'gb', flag: '🇬🇧', baseCostMultiplier: 1.0, qty: 42091000 },
    { id: 'usa', name: 'USA', code: '+1', iso: 'us', flag: '🇺🇸', baseCostMultiplier: 1.2, qty: 95402000 },
    { id: 'canada', name: 'Canada', code: '+1', iso: 'ca', flag: '🇨🇦', baseCostMultiplier: 1.1, qty: 31209000 },
    { id: 'indonesia', name: 'Indonesia', code: '+62', iso: 'id', flag: '🇮🇩', baseCostMultiplier: 0.7, qty: 89401200 },
    { id: 'philippines', name: 'Philippines', code: '+63', iso: 'ph', flag: '🇵🇭', baseCostMultiplier: 0.8, qty: 45192000 },
    { id: 'pakistan', name: 'Pakistan', code: '+92', iso: 'pk', flag: '🇵🇰', baseCostMultiplier: 0.6, qty: 32091000 },
    { id: 'india', name: 'India', code: '+91', iso: 'in', flag: '🇮🇳', baseCostMultiplier: 0.7, qty: 110492000 },
    { id: 'cambodia', name: 'Cambodia', code: '+855', iso: 'kh', flag: '🇰🇭', baseCostMultiplier: 0.85, qty: 18402000 },
    { id: 'southafrica', name: 'South Africa', code: '+27', iso: 'za', flag: '🇿🇦', baseCostMultiplier: 0.9, qty: 22019400 },
    { id: 'germany', name: 'Germany', code: '+49', iso: 'de', flag: '🇩🇪', baseCostMultiplier: 1.4, qty: 14209300 },
    { id: 'france', name: 'France', code: '+33', iso: 'fr', flag: '🇫🇷', baseCostMultiplier: 1.35, qty: 16402100 },
    { id: 'brazil', name: 'Brazil', code: '+55', iso: 'br', flag: '🇧🇷', baseCostMultiplier: 0.85, qty: 58209100 },
    { id: 'netherlands', name: 'Netherlands', code: '+31', iso: 'nl', flag: '🇳🇱', baseCostMultiplier: 1.3, qty: 11209400 },
    { id: 'turkey', name: 'Turkey', code: '+90', iso: 'tr', flag: '🇹🇷', baseCostMultiplier: 0.9, qty: 34102900 },
    { id: 'nigeria', name: 'Nigeria', code: '+234', iso: 'ng', flag: '🇳🇬', baseCostMultiplier: 0.65, qty: 41209000 },
    { id: 'kazakhstan', name: 'Kazakhstan', code: '+7', iso: 'kz', flag: '🇰🇿', baseCostMultiplier: 0.75, qty: 28401900 },
    { id: 'vietnam', name: 'Vietnam', code: '+84', iso: 'vn', flag: '🇻🇳', baseCostMultiplier: 0.8, qty: 37409100 },
    { id: 'colombia', name: 'Colombia', code: '+57', iso: 'co', flag: '🇨🇴', baseCostMultiplier: 0.9, qty: 19201900 }
  ];
  readData('countries', defaultCountries);

  // Orders
  readData('orders', []);

  // Deposits
  readData('deposits', [
    {
      id: 'dep_sample_01',
      userId: 'usr_demo_user',
      userName: 'Rizwan User',
      method: 'easypaisa',
      methodTitle: 'EasyPaisa',
      amountUsd: 5.0,
      amountPkr: 1400.0,
      tid: '83920192841',
      status: 'APPROVED',
      date: new Date(Date.now() - 3600000 * 24).toISOString()
    }
  ]);
}

initializeDatabase();

module.exports = {
  readData,
  writeData,
  initializeDatabase
};
