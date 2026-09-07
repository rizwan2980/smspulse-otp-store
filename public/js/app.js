/* =========================================================
   SMSPulse CLIENT LOGIC (app.js)
   Ultra-modern, intuitive, real-time OTP polling, sound & filters
   ========================================================= */

const state = {
  pendingAuth: null,
  siteName: 'SMSPulse',
  user: null,
  currency: localStorage.getItem('smspulse_currency') || 'PKR',
  theme: localStorage.getItem('smspulse_theme') || 'light',
  soundEnabled: localStorage.getItem('smspulse_sound') !== 'false',
  services: [],
  countries: [],
  selectedService: null,
  selectedCountry: null,
  selectedOperator: 'any',
  activeCategory: 'all',
  activeOrders: [],
  historyOrders: [],
  pollTimer: null,
  countdownInterval: null
};

// Web Audio API Ding Chime on SMS Received
function playOtpChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.7);
  } catch (e) {
    console.log('Audio notification initialized');
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('smspulse_sound', state.soundEnabled);
  showToast(state.soundEnabled ? '🔔 Sound chime enabled' : '🔕 Sound chime muted', 'info');
  renderHeaderUser();
}

// Toast Notifications
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  toast.innerHTML = `
    <span style="font-size: 1.2rem;">${type === 'error' ? '❌' : type === 'success' ? '✅' : '💡'}</span>
    <span style="font-size: 0.92rem; font-weight:600;">${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// Format currency display
function formatMoney(usd, pkr) {
  if (state.currency === 'PKR') {
    return `₨ ${pkr !== undefined ? pkr.toLocaleString() : Math.round(usd * 280).toLocaleString()}`;
  }
  return `$${Number(usd).toFixed(2)}`;
}

// Copy to clipboard helper
function copyToClipboard(text, btnElement) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied: ${text}`, 'success');
    if (btnElement) {
      const origText = btnElement.innerHTML;
      btnElement.innerHTML = '✓ Copied!';
      btnElement.style.background = 'var(--brand-emerald)';
      btnElement.style.color = '#ffffff';
      setTimeout(() => {
        btnElement.innerHTML = origText;
        btnElement.style.background = '';
        btnElement.style.color = '';
      }, 2000);
    }
  }).catch(() => {
    showToast('Failed to copy', 'error');
  });
}

// Theme handling
function initTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const themeToggleBtns = document.querySelectorAll('.btn-toggle-theme');
  themeToggleBtns.forEach(btn => {
    btn.innerHTML = state.theme === 'dark' ? '☀️' : '🌙';
  });
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('smspulse_theme', state.theme);
  initTheme();
}

// Currency Toggle
function toggleCurrency() {
  state.currency = state.currency === 'USD' ? 'PKR' : 'USD';
  localStorage.setItem('smspulse_currency', state.currency);
  renderHeaderUser();
  renderServices();
  updateStep3();
  if (typeof renderPaymentMethods === 'function') renderPaymentMethods();
}

// Headers helper for API requests
function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (state.user) {
    headers['x-user-id'] = state.user.id;
    headers['x-user-role'] = state.user.role;
  }
  return headers;
}

// Fetch user profile or default demo
async function initUser() {
  const savedUserId = localStorage.getItem('smspulse_userId');
  if (savedUserId) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'x-user-id': savedUserId }
      });
      const data = await res.json();
      if (data && data.success && data.user) {
        state.user = data.user;
      } else {
        localStorage.removeItem('smspulse_userId');
        state.user = null;
      }
    } catch (e) {
      console.error('Error fetching user:', e);
    }
  } else {
    state.user = null;
  }
  renderHeaderUser();
}

// Render header wallet & actions
function renderHeaderUser() {
  const adminNav = document.getElementById('nav-admin-link');
  if (adminNav) {
    adminNav.style.display = (state.user && state.user.role === 'admin') ? 'inline-block' : 'none';
  }
  const container = document.getElementById('header-user-area');
  if (!container) return;

  if (state.user) {
    container.innerHTML = `
      <div class="user-wallet-badge">
        <div class="wallet-balance-info">
          <span class="wallet-usd">${state.currency === 'PKR' ? `₨ ${state.user.balancePkr.toLocaleString()}` : `$${state.user.balanceUsd.toFixed(2)}`}</span>
          <span class="wallet-pkr">${state.currency === 'PKR' ? `$${state.user.balanceUsd.toFixed(2)}` : `₨ ${state.user.balancePkr.toLocaleString()}`}</span>
        </div>
        <a href="/payment" class="btn-pulse-topup" title="Add Funds to Wallet">
          <span>+</span> Top Up
        </a>
        <button class="currency-toggle" onclick="toggleCurrency()" title="Switch Currency">${state.currency}</button>
        <button class="btn btn-sm btn-ghost" onclick="openProfileModal()" title="Account Settings" style="display:flex; align-items:center; gap:6px;">
          ${state.user.avatar ? `<img src="${state.user.avatar}" class="user-avatar-img" alt="avatar">` : '👤'} ${state.user.name.split(' ')[0]}
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="currency-toggle" onclick="toggleCurrency()">${state.currency}</button>
      <button class="btn btn-sm btn-ghost" onclick="openLoginModal()">Sign in</button>
      <button class="btn btn-sm btn-primary" onclick="openRegisterModal()">Register</button>
    `;
  }
}

// Load Services & Countries
async function loadCatalog() {
  try {
    const [resS, resC, resSet] = await Promise.all([
      fetch('/api/services'),
      fetch('/api/countries'),
      fetch('/api/admin/settings')
    ]);
    const dataS = await resS.json();
    const dataC = await resC.json();
    const dataSet = await resSet.json();

    if (dataSet.success && dataSet.settings.siteName) {
      state.siteName = dataSet.settings.siteName;
      document.querySelectorAll('.site-brand-name').forEach(el => el.innerText = state.siteName);
    }

    if (dataS.success) state.services = dataS.services;
    if (dataC.success) state.countries = dataC.countries;

    // Default select WhatsApp and UK
    if (state.services.length > 0 && !state.selectedService) {
      state.selectedService = state.services.find(s => s.id === 'whatsapp') || state.services[0];
    }
    if (!state.selectedCountry && state.countries.length > 0) {
      state.selectedCountry = state.countries.find(c => c.id === 'usa') || state.countries[0];
    }
    init5SimUI();
  } catch (err) {
    console.error('Error loading catalog:', err);
  }
}

// Quick App Filter Chips
function renderQuickChips() {
  const container = document.getElementById('quick-app-chips');
  if (!container) return;

  const topApps = [
    { id: 'all', label: '🔥 All Apps' },
    { id: 'whatsapp', label: '💬 WhatsApp' },
    { id: 'telegram', label: '✈️ Telegram' },
    { id: 'openai', label: '🤖 ChatGPT' },
    { id: 'google', label: '🔍 Google' },
    { id: 'tiktok', label: '🎵 TikTok' },
    { id: 'instagram', label: '📷 Instagram' },
    { id: 'amazon', label: '📦 Amazon' },
    { id: 'netflix', label: '🎬 Netflix' },
    { id: 'binance', label: '🪙 Binance' }
  ];

  container.innerHTML = topApps.map(chip => `
    <button type="button" class="chip-btn ${state.activeCategory === chip.id ? 'active' : ''}" onclick="filterByChip('${chip.id}')">
      ${chip.label}
    </button>
  `).join('');
}

function filterByChip(chipId) {
  state.activeCategory = chipId;
  renderQuickChips();

  if (chipId === 'all') {
    renderServices(document.getElementById('service-search')?.value || '');
  } else {
    const s = state.services.find(x => x.id === chipId);
    if (s) {
      selectService(s.id);
    }
    renderServices(chipId);
  }
}

// Render Step 1: Services List
function renderServices(query = '') {
  const container = document.getElementById('services-list');
  if (!container) return;

  const filtered = state.services.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    s.id.toLowerCase().includes(query.toLowerCase())
  );

  container.innerHTML = filtered.map(s => {
    const isSelected = state.selectedService && state.selectedService.id === s.id;
    const stockCount = s.stock ? s.stock.toLocaleString() : (Math.floor((s.qty || 154000) / 10)).toLocaleString();
    return `
      <div class="service-row-5sim ${isSelected ? 'selected' : ''}" onclick="selectService('${s.id}')">
        <div class="service-left">
          <div class="service-icon-box">
            ${getServiceIcon(s.id)}
          </div>
          <div class="service-meta">
            <span class="service-name">${s.name}</span>
            <span class="service-count">${stockCount} pcs</span>
          </div>
        </div>
        <div class="service-right">
          <span class="service-price-tag">${formatMoney(s.priceUsd, s.pricePkr)}</span>
          <button class="btn-buy-row" onclick="event.stopPropagation(); buySpecificService('${s.id}')" title="Instant Buy ${s.name}">
            BUY
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function buySpecificService(serviceId) {
  selectService(serviceId);
  await buySelectedNumber();
}

function getServiceIcon(id) {
  const icons = {
    whatsapp: '💬',
    telegram: '✈️',
    google: '🔍',
    openai: '🤖',
    instagram: '📷',
    facebook: '👥',
    tiktok: '🎵',
    amazon: '📦',
    microsoft: '🪟',
    netflix: '🎬',
    twitter: '🐦',
    discord: '🎮',
    steam: '🕹️',
    binance: '🪙',
    apple: '🍎',
    paypal: '💳',
    tinder: '🔥',
    uber: '🚗',
    snapchat: '👻',
    spotify: '🎧',
    dola: '✨',
    claude: '🧠',
    other: '🌐'
  };
  return icons[id] || '📱';
}

// Render Step 2: Countries List
function renderCountries(query = '') {
  const container = document.getElementById('countries-list');
  if (!container) return;

  const filtered = state.countries.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.code.includes(query)
  );

  container.innerHTML = filtered.map(c => `
    <div class="list-item ${state.selectedCountry && state.selectedCountry.id === c.id ? 'selected' : ''}" onclick="selectCountry('${c.id}')">
      <div class="item-left">
        <span style="font-size: 1.35rem;">${c.flag}</span>
        <span class="item-name">${c.name} (${c.code})</span>
      </div>
      <div class="item-right">
        <span class="item-stock">${(c.qty / 1000000).toFixed(1)}M available</span>
      </div>
    </div>
  `).join('');
}


function selectOperator(op) {
  state.selectedOperator = op;
  document.querySelectorAll('.operator-pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-op') === op);
  });
  updateStep3();
}

function selectService(id) {
  state.selectedService = state.services.find(s => s.id === id);
  renderServices(document.getElementById('service-search')?.value || '');
  updateStep3();
}

function selectCountry(id) {
  state.selectedCountry = state.countries.find(c => c.id === id);
  renderCountries(document.getElementById('country-search')?.value || '');
  updateStep3();
}

// Update Step 3: Live 5SIM Calculation & Real Operator Selection
let priceAbortController = null;

async function updateStep3() {
  const s = state.selectedService;
  const c = state.selectedCountry;
  if (!s || !c) return;

  const selectedName = document.getElementById('step3-service-country');
  if (selectedName) {
    selectedName.innerHTML = `<span>${s.name}</span> <span style="color:var(--text-muted)">for</span> <span>${c.flag} ${c.name}</span>`;
  }

  const buyBtn = document.getElementById('btn-buy-action');
  const priceElem = document.getElementById('step3-price-usd');
  const pkrSub = document.getElementById('step3-price-sub');
  const stockBadge = document.getElementById('step3-stock-badge');
  const opSelect = document.getElementById('step3-operator-select');

  if (priceElem) priceElem.innerText = 'Syncing...';
  if (pkrSub) pkrSub.innerText = 'Fetching live rates & stock...';
  if (stockBadge) {
    stockBadge.innerText = '● Checking stock...';
    stockBadge.style.color = 'var(--text-muted)';
  }
  if (buyBtn) {
    buyBtn.disabled = true;
    buyBtn.innerHTML = '⏳ Fetching live prices...';
  }

  if (priceAbortController) priceAbortController.abort();
  priceAbortController = new AbortController();

  try {
    const res = await fetch(`/api/services/price?serviceId=${s.id}&countryId=${c.id}`, {
      signal: priceAbortController.signal
    });
    const data = await res.json();

    if (data.success) {
      state.currentPriceData = data;

      // Populate Operators Dropdown
      if (opSelect && data.operators) {
        opSelect.innerHTML = data.operators.map(op => {
          const rateText = op.successRate ? ` | ${op.successRate}` : '';
          const stockText = op.count > 0 ? `(${op.count.toLocaleString()} available${rateText})` : '(Out of Stock)';
          return `<option value="${op.id}">${op.name} — ${op.retailUsd.toFixed(2)} ${stockText}</option>`;
        }).join('');

        // Reset or preserve selected operator
        if (!state.selectedOperator || !data.operators.some(o => o.id === state.selectedOperator)) {
          state.selectedOperator = data.operators[0]?.id || 'any';
        }
        opSelect.value = state.selectedOperator;
      }

      // Update Stock badge
      if (stockBadge) {
        if (data.totalStock > 0) {
          stockBadge.innerText = `● ${data.totalStock.toLocaleString()} In Stock`;
          stockBadge.style.color = 'var(--brand-emerald)';
        } else {
          stockBadge.innerText = '✕ Out of Stock';
          stockBadge.style.color = '#ef4444';
        }
      }

      renderPriceForSelectedOperator();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Error fetching live pricing:', err);
    }
  }
}

function onOperatorChange(operatorId) {
  state.selectedOperator = operatorId;
  renderPriceForSelectedOperator();
}

function renderPriceForSelectedOperator() {
  const data = state.currentPriceData;
  if (!data || !data.operators) return;

  const matched = data.operators.find(op => op.id === state.selectedOperator) || data.operators[0];
  if (!matched) return;

  const costUsd = matched.retailUsd;
  const costPkr = matched.retailPkr;

  const priceElem = document.getElementById('step3-price-usd');
  if (priceElem) {
    priceElem.innerText = formatMoney(costUsd, costPkr);
  }

  const pkrSub = document.getElementById('step3-price-sub');
  if (pkrSub) {
    pkrSub.innerText = state.currency === 'PKR' ? `${costUsd.toFixed(2)} USD` : `₨ ${costPkr.toLocaleString()} PKR`;
  }

  const buyBtn = document.getElementById('btn-buy-action');
  if (buyBtn) {
    if (matched.count === 0 && matched.id !== 'any' && data.totalStock === 0) {
      buyBtn.disabled = true;
      buyBtn.innerHTML = '⚠️ Currently Out of Stock';
    } else {
      buyBtn.disabled = false;
      buyBtn.innerHTML = `⚡ Buy Virtual Number (${formatMoney(costUsd, costPkr)})`;
    }
  }
}

// BUY Virtual Number Action
async function buySelectedNumber() {
  if (!state.user) {
    openLoginModal();
    return;
  }

  const s = state.selectedService;
  const c = state.selectedCountry;
  const buyBtn = document.getElementById('btn-buy-action');

  if (buyBtn) {
    buyBtn.disabled = true;
    buyBtn.innerHTML = `⏳ Generating fresh virtual number...`;
  }

  try {
    const res = await fetch('/api/orders/buy', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        serviceId: s.id,
        countryId: c.id,
        operator: state.selectedOperator
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      state.user.balanceUsd = data.newBalanceUsd;
      state.user.balancePkr = data.newBalancePkr;
      renderHeaderUser();

      if (data.order) {
        state.activeOrders = [data.order, ...(state.activeOrders || []).filter(o => o.id !== data.order.id)];
        renderLiveOrders();
      }

      await fetchMyOrders();
    } else {
      showToast(data.error || 'Failed to buy number', 'error');
      if (data.needsTopUp) {
        setTimeout(() => {
          window.location.href = '/payment';
        }, 1500);
      }
    }
  } catch (err) {
    console.error('Error buying number:', err);
    showToast('Network error while purchasing', 'error');
  } finally {
    updateStep3();
  }
}

// Fetch Active and History Orders
async function fetchMyOrders() {
  if (!state.user) return;

  try {
    const res = await fetch('/api/orders/my', {
      headers: getHeaders()
    });
    const data = await res.json();
    if (data.success) {
      const prevPendingCount = (state.activeOrders || []).filter(o => o.status === 'PENDING').length;

      const allOrders = Array.isArray(data.orders) ? data.orders : [];
      const activeList = Array.isArray(data.active) ? data.active : allOrders.filter(o => o.status === 'PENDING' || o.status === 'RECEIVED');
      const historyList = Array.isArray(data.history) ? data.history : allOrders.filter(o => o.status !== 'PENDING' && o.status !== 'RECEIVED');

      state.activeOrders = activeList;
      state.historyOrders = historyList;

      // Check if newly received code
      const newlyReceived = state.activeOrders.find(o => o.status === 'RECEIVED' && o.smsList && o.smsList.length > 0);
      if (newlyReceived && prevPendingCount > 0) {
        playOtpChime();
      }

      renderLiveOrders();
      
// 5SIM Order History Table Renderer
function renderHistoryTable() {
  const container = document.getElementById('order-history-box');
  if (!container) return;

  const orders = (state.historyOrders && state.historyOrders.length > 0)
    ? state.historyOrders
    : (state.activeOrders || []);

  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:2rem; color:var(--text-muted); font-size:0.9rem;">
        No activation history found yet. Purchased numbers and received SMS codes will be saved here permanently.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="history-table-container">
      <table class="order-history-table">
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Service & Country</th>
            <th>Phone Number</th>
            <th>SMS Code</th>
            <th>Cost</th>
            <th>Date & Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => {
            const smsCode = (o.smsList && o.smsList.length > 0) ? o.smsList[o.smsList.length - 1].code : '—';
            const statusClass = (o.status || 'pending').toLowerCase();
            const dateStr = new Date(o.createdAt).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });

            return `
              <tr>
                <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-muted);">
                  #${o.id.substring(o.id.lastIndexOf('_') + 1)}
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:8px; font-weight:700;">
                    <span>${o.countryFlag || '🌍'}</span>
                    <span>${o.serviceName}</span>
                  </div>
                </td>
                <td>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-family:var(--font-mono); font-weight:700; color:var(--primary);">${o.phone}</span>
                    <button class="btn btn-sm btn-outline" onclick="copyToClipboard('${o.phone}', this)" style="padding:2px 8px; font-size:0.75rem;">📋</button>
                  </div>
                </td>
                <td>
                  ${smsCode !== '—' ? `
                    <div style="display:flex; align-items:center; gap:6px;">
                      <strong style="font-family:var(--font-mono); font-size:1.05rem; color:#10b981; background:rgba(16,185,129,0.12); padding:3px 10px; border-radius:6px;">${smsCode}</strong>
                      <button class="btn btn-sm btn-outline" onclick="copyToClipboard('${smsCode}', this)" style="padding:2px 8px; font-size:0.75rem;">📋</button>
                    </div>
                  ` : `
                    <span style="color:var(--text-muted);">Waiting...</span>
                  `}
                </td>
                <td style="font-family:var(--font-mono); font-weight:700;">
                  ${o.costUsd.toFixed(2)}
                </td>
                <td style="font-size:0.8rem; color:var(--text-muted);">
                  ${dateStr}
                </td>
                <td>
                  <span class="status-badge-pill ${statusClass}">
                    ● ${o.status}
                  </span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

if (typeof renderHistoryTable === 'function') {
        renderHistoryTable();
      }
    }
  } catch (e) {
    console.error('Error polling orders:', e);
  }
}

// Render Live Orders Card in Main Content
function formatRemainingTime(expiresAt) {
  if (!expiresAt) return '⏱️ 15:00';
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return `⏱️ ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function renderLiveOrders() {
  const container = document.getElementById('live-orders-box');
  const promoBox = document.getElementById('fivesim-promo-box');
  const countBadge = document.getElementById('active-orders-count-badge');
  if (!container) return;

  const count = (state.activeOrders || []).length;
  if (countBadge) {
    countBadge.innerText = count;
    countBadge.style.display = count > 0 ? 'inline-block' : 'none';
  }

  if (count === 0) {
    container.innerHTML = '';
    if (promoBox) promoBox.style.display = 'block';
    return;
  }

  if (promoBox) promoBox.style.display = 'none';

  container.innerHTML = state.activeOrders.map(order => {
    const isReceived = order.status === 'RECEIVED' && order.smsList.length > 0;
    const latestSms = isReceived ? order.smsList[order.smsList.length - 1] : null;

    return `
      <div class="active-order-card" id="order-card-${order.id}">
        <div class="order-card-header">
          <div class="order-service-flag">
            <span>${order.countryFlag}</span>
            <span>${order.serviceName}</span>
            <span style="font-size: 0.85rem; opacity: 0.9; font-weight: 600;">(${order.countryName})</span>
          </div>
          <div class="order-timer" id="timer-${order.id}">
            ${formatRemainingTime(order.expiresAt)}
          </div>
        </div>

        <div class="order-card-body">
          <div class="number-row">
            <div class="phone-display">
              <span style="font-size: 1.4rem;">📞</span>
              <div>
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Issued Phone Number:</span>
                <span class="phone-digits">${order.phone}</span>
              </div>
            </div>
            <button class="btn-copy" onclick="copyToClipboard('${order.phone}', this)">
              📋 Copy Number
            </button>
          </div>

          ${isReceived ? `
            <div class="received-sms-box">
              <div class="sms-badge-received">✓ Verification Code Received!</div>
              <div class="sms-code-highlight">
                <span class="otp-code-big">${latestSms.code}</span>
                <button class="btn btn-sm btn-primary" onclick="copyToClipboard('${latestSms.code}', this)" style="padding: 8px 18px; font-size: 0.9rem;">
                  📋 Copy Code
                </button>
              </div>
              <p style="font-size: 0.88rem; color: var(--text-muted); margin-top: 4px; font-family: var(--font-mono);">
                "${latestSms.text}"
              </p>
            </div>
          ` : `
            <div class="sms-status-box">
              <div style="display: flex; align-items: center; gap: 10px;">
                <div class="radar-pulse-dot"></div>
                <strong style="font-size: 1rem; color: var(--text-main);">Waiting for incoming SMS code...</strong>
              </div>
              <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 6px; max-width: 440px;">
                Paste this phone number into WhatsApp/Telegram. Your code usually arrives within 5 to 20 seconds.
              </p>
              
            </div>
          `}

          <div class="order-actions-row" style="display: flex; gap: 12px; align-items: center; margin-top: 14px; flex-wrap: wrap;">
            ${!isReceived ? `
              <button class="btn btn-sm btn-danger" onclick="cancelOrder('${order.id}')" style="background: #ef4444; color: white; padding: 8px 18px; border-radius: 8px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; border: none; box-shadow: 0 2px 8px rgba(239,68,68,0.3); transition: all 0.2s ease;">
                ✕ Cancel & Instant Refund
              </button>
              <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">
                ⚡ Number rejected or no SMS? Click Cancel anytime for an immediate 100% wallet refund.
              </span>
            ` : `
              <button class="btn btn-sm btn-success" onclick="finishOrder('${order.id}')" style="font-weight: 700;">
                ✓ Finish Activation
              </button>
              <span style="font-size: 0.78rem; color: var(--brand-emerald); font-weight: 700; align-self: center;">
                🔒 Code Delivered — Service Completed
              </span>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Cancel Order with Instant Refund
async function cancelOrder(orderId) {
  if (!confirm('Cancel this number order? The full amount will be refunded immediately back to your wallet balance.')) {
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      state.user.balanceUsd = data.newBalanceUsd;
      state.user.balancePkr = data.newBalancePkr;
      renderHeaderUser();
      fetchMyOrders();
    } else {
      showToast(data.error || 'Failed to cancel order', 'error');
    }
  } catch (err) {
    console.error('Error cancelling order:', err);
  }
}

// Finish Order
async function finishOrder(orderId) {
  try {
    const res = await fetch(`/api/orders/${orderId}/finish`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showToast('Order completed successfully', 'success');
      fetchMyOrders();
    }
  } catch (err) {
    console.error('Error finishing order:', err);
  }
}

// Simulate immediate SMS
async function simulateInstantSms(orderId) {
  try {
    const res = await fetch(`/api/orders/${orderId}/simulate-sms`, {
      method: 'POST',
      headers: getHeaders()
    });
    const data = await res.json();
    if (data.success) {
      showToast('Live SMS code received!', 'success');
      playOtpChime();
      fetchMyOrders();
    }
  } catch (err) {
    console.error(err);
  }
}

// Start periodic polling
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.user) {
      fetchMyOrders();
    }
  }, 3000);
}

// Auth Modals
function openLoginModal() {
  if (state.user) { openProfileModal(); return; }
  closeRegisterModal();
  closeGoogleChooserModal();
  closeForgotPasswordModal();
  const modal = document.getElementById('login-modal');
  if (modal) {
    modal.classList.add('open');
    const input = document.getElementById('login-email');
    if (input) setTimeout(() => input.focus(), 150);
  } else {
    window.location.href = '/?action=login';
  }
}

function closeLoginModal() {
  const modal = document.getElementById('login-modal');
  if (modal) modal.classList.remove('open');
}

function openRegisterModal() {
  if (state.user) { openProfileModal(); return; }
  closeLoginModal();
  closeGoogleChooserModal();
  closeForgotPasswordModal();
  const modal = document.getElementById('register-modal');
  if (modal) {
    modal.classList.add('open');
    const input = document.getElementById('reg-name');
    if (input) setTimeout(() => input.focus(), 150);
  } else {
    window.location.href = '/?action=register';
  }
}

function closeRegisterModal() {
  const modal = document.getElementById('register-modal');
  if (modal) modal.classList.remove('open');
}

function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal && state.user) {
    document.getElementById('prof-name').innerText = state.user.name;
    document.getElementById('prof-email').innerText = state.user.email;
    document.getElementById('prof-balance-usd').innerText = `$${state.user.balanceUsd.toFixed(2)}`;
    document.getElementById('prof-balance-pkr').innerText = `₨ ${state.user.balancePkr.toLocaleString()}`;
    modal.classList.add('open');
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.classList.remove('open');
}

function logout() {
  state.user = null;
  localStorage.removeItem('smspulse_userId');
  localStorage.removeItem('smspulse_userId');
  closeProfileModal();
  renderHeaderUser();
  renderLiveOrders();
  showToast('Logged out successfully', 'info');
}

// Handle login submit
async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById('login-email');
  const pwInput = document.getElementById('login-password');
  const submitBtn = e?.target?.querySelector('button[type="submit"]') || document.querySelector('#login-modal button[type="submit"]');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = pwInput ? pwInput.value : '';

  if (!email || !password) {
    showToast('Please enter both email and password', 'error');
    return;
  }

  const origText = submitBtn ? submitBtn.innerHTML : 'Sign In';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Signing in... ⏳';
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.success) {
      state.user = data.user;
      localStorage.setItem('smspulse_userId', data.user.id);
      closeLoginModal();
      window.history.replaceState({}, document.title, window.location.pathname);
      renderHeaderUser();
      fetchMyOrders();
      showToast(data.message || `Welcome back, ${data.user.name}!`, 'success');
      setTimeout(() => window.location.reload(), 600);
    } else {
      showToast(data.error || 'Invalid email or password', 'error');
    }
  } catch (err) {
    console.error('Login error:', err);
    showToast('Network error during login', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  }
}

async function handleRegisterSubmit(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById("reg-name");
  const emailInput = document.getElementById("reg-email");
  const pwInput = document.getElementById("reg-password");
  const submitBtn = e?.target?.querySelector('button[type="submit"]') || document.querySelector('#register-modal button[type="submit"]');

  const name = nameInput ? nameInput.value.trim() : "";
  const email = emailInput ? emailInput.value.trim() : "";
  const password = pwInput ? pwInput.value : "";

  if (!email || !password) {
    showToast("Please enter both email and password", "error");
    return;
  }

  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    return;
  }

  const origText = submitBtn ? submitBtn.innerHTML : 'Create Account';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Creating Account... ⏳';
  }

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || email.split('@')[0], email, password })
    });
    const data = await res.json();
    if (data.success) {
      state.user = data.user;
      localStorage.setItem("smspulse_userId", data.user.id);
      closeRegisterModal();
      window.history.replaceState({}, document.title, window.location.pathname);
      renderHeaderUser();
      fetchMyOrders();
      showToast(data.message || `🎉 Welcome ${data.user.name}! Your account is active!`, "success");
      setTimeout(() => window.location.reload(), 600);
    } else {
      showToast(data.error || "Registration failed", "error");
    }
  } catch (err) {
    console.error('Registration error:', err);
    showToast("Network error during registration", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  }
}

// Search inputs listeners

function updateLiveTimers() {
  if (!state.activeOrders || state.activeOrders.length === 0) return;
  state.activeOrders.forEach(order => {
    const el = document.getElementById('timer-' + order.id);
    if (el) {
      el.textContent = formatRemainingTime(order.expiresAt);
    }
  });
}
setInterval(updateLiveTimers, 1000);

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initUser();
  loadCatalog();
  startPolling();

  const sSearch = document.getElementById('service-search');
  if (sSearch) {
    sSearch.addEventListener('input', e => renderServices(e.target.value));
  }

  const cSearch = document.getElementById('country-search');
  if (cSearch) {
    cSearch.addEventListener('input', e => renderCountries(e.target.value));
  }

  const buyBtn = document.getElementById('btn-buy-action');
  if (buyBtn) {
    buyBtn.addEventListener('click', buySelectedNumber);
  }

  // Handle URL action params (e.g. ?action=login or ?action=register)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    if (action) {
      window.history.replaceState({}, document.title, window.location.pathname);
      if (!state.user) {
        if (action === 'login') setTimeout(openLoginModal, 200);
        else if (action === 'register') setTimeout(openRegisterModal, 200);
        else if (action === 'google') setTimeout(handleGoogleSignIn, 200);
      }
    }
  } catch (e) {}
});


// ==========================================================================
// Google Sign-In & Authentication Upgrades
// ==========================================================================

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

function checkPasswordStrength(pw) {
  const fill = document.getElementById('pw-strength-fill');
  const text = document.getElementById('pw-strength-text');
  if (!fill || !text) return;

  if (!pw || pw.length === 0) {
    fill.style.width = '0%';
    text.textContent = 'Enter at least 6 characters';
    return;
  }

  let score = 0;
  if (pw.length >= 6) score += 1;
  if (pw.length >= 10) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[A-Z]/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;

  if (score <= 1) {
    fill.style.width = '25%';
    fill.style.background = '#ef4444';
    text.textContent = 'Weak password';
  } else if (score === 2) {
    fill.style.width = '50%';
    fill.style.background = '#f59e0b';
    text.textContent = 'Fair password';
  } else if (score === 3) {
    fill.style.width = '75%';
    fill.style.background = '#0284c7';
    text.textContent = 'Good password';
  } else {
    fill.style.width = '100%';
    fill.style.background = '#10b981';
    text.textContent = 'Strong password!';
  }
}

// Google Sign-In Modal Controls
function handleGoogleSignIn(source = 'login') {
  if (state.user) { openProfileModal(); return; }
  closeLoginModal();
  closeRegisterModal();
  closeForgotPasswordModal();
  const modal = document.getElementById('google-chooser-modal');
  if (modal) {
    modal.classList.add('open');
    const input = document.getElementById('google-input-email');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 150);
    }
  }
}

function closeGoogleChooserModal() {
  const modal = document.getElementById('google-chooser-modal');
  if (modal) modal.classList.remove('open');
}

async function handleGoogleSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('google-input-email');
  const btn = document.getElementById('btn-google-submit') || e?.target?.querySelector('button[type="submit"]');
  if (!input || !input.value.trim()) {
    showToast('Please enter your Gmail address', 'error');
    return;
  }

  const email = input.value.trim().toLowerCase();
  const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const avatar = 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Signing in... ⏳';
  }

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, avatar, googleId: 'gid_' + Date.now() })
    });
    const data = await res.json();
    if (data.success) {
      state.user = data.user;
      localStorage.setItem('smspulse_userId', data.user.id);
      closeGoogleChooserModal();
      window.history.replaceState({}, document.title, window.location.pathname);
      renderHeaderUser();
      fetchMyOrders();
      showToast(data.message || `Welcome back, ${data.user.name}!`, 'success');
      setTimeout(() => window.location.reload(), 600);
    } else {
      showToast(data.error || 'Google Sign-In failed', 'error');
    }
  } catch (err) {
    console.error('Google Sign-In error:', err);
    showToast('Network error during Google Sign-In', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Continue with Google →';
    }
  }
}


function openOtpModal(email, devCode = null, targetType = 'auth') {
  const modal = document.getElementById('otp-modal');
  if (!modal) return;

  const targetEmailEl = document.getElementById('otp-target-email');
  if (targetEmailEl) targetEmailEl.textContent = email;

  const input = document.getElementById('email-otp-input');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 200);
  }

  modal.classList.add('open');
}

function closeOtpModal() {
  const modal = document.getElementById('otp-modal');
  if (modal) modal.classList.remove('open');
}

async function handleOtpVerificationSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('email-otp-input');
  const submitBtn = document.getElementById('btn-otp-verify-submit');
  const code = input ? input.value.trim() : '';

  if (!code || code.length !== 6) {
    showToast('Please enter the 6-digit verification code', 'error');
    return;
  }

  if (!state.pendingAuth || !state.pendingAuth.email) {
    showToast('Session expired. Please try signing in again.', 'error');
    closeOtpModal();
    return;
  }

  const origText = submitBtn ? submitBtn.innerHTML : 'Verify & Continue →';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Verifying Code... ⏳';
  }

  try {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: state.pendingAuth.email,
        code: code
      })
    });

    const data = await res.json();
    if (data.success) {
      state.user = data.user;
      localStorage.setItem('smspulse_userId', data.user.id);
      closeOtpModal();
      closeRegisterModal();
      closeLoginModal();
      closeGoogleChooserModal();
      renderHeaderUser();
      fetchMyOrders();
      showToast(`🎉 Welcome ${data.user.name}! Your account is active!`, 'success');
      // Remove ?action= from URL so register modal never reopens
      if (window.location.search.includes('action=')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      showToast(data.error || 'Invalid verification code', 'error');
    }
  } catch (err) {
    console.error('OTP verification error:', err);
    showToast('Network error during verification', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origText;
    }
  }
}

async function resendOtpCode() {
  if (!state.pendingAuth || !state.pendingAuth.email) {
    showToast('No active session found. Please sign in again.', 'error');
    return;
  }

  try {
    showToast('Issuing fresh verification code...', 'info');
    const res = await fetch('/api/auth/resend-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: state.pendingAuth.email })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      const banner = document.getElementById('otp-security-banner');
      const codeEl = document.getElementById('otp-security-code');
      if (data.devCode && banner && codeEl) {
        codeEl.textContent = data.devCode;
        banner.style.display = 'block';
      }
    } else {
      showToast(data.error || 'Failed to resend code', 'error');
    }
  } catch (err) {
    showToast('Network error requesting new code', 'error');
  }
}


// Forgot Password Modal Controls
function openForgotPasswordModal() {
  closeLoginModal();
  const modal = document.getElementById('forgot-modal');
  if (modal) {
    document.getElementById('forgot-step-1').style.display = 'block';
    document.getElementById('forgot-step-2').style.display = 'none';
    modal.classList.add('open');
  }
}

function closeForgotPasswordModal() {
  const modal = document.getElementById('forgot-modal');
  if (modal) modal.classList.remove('open');
}

// Step 1: Send Reset Code
async function handleForgotPasswordSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value;
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('forgot-step-1').style.display = 'none';
      document.getElementById('forgot-step-2').style.display = 'block';
      // High security: Do NOT auto-fill reset code.
    } else {
      showToast(data.error || 'Failed to request reset', 'error');
    }
  } catch (err) {
    showToast('Network error requesting reset code', 'error');
  }
}

// Step 2: Reset Password with Code
async function handleResetPasswordSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value;
  const code = document.getElementById('reset-code').value;
  const newPassword = document.getElementById('reset-new-password').value;

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeForgotPasswordModal();
      openLoginModal();
      document.getElementById('login-email').value = email;
      document.getElementById('login-password').value = newPassword;
    } else {
      showToast(data.error || 'Password reset failed', 'error');
    }
  } catch (err) {
    showToast('Network error during password reset', 'error');
  }
}

// Change Password in Profile
async function handleChangePasswordSubmit(e) {
  e.preventDefault();
  if (!state.user) return;
  const curPw = document.getElementById('prof-cur-pw').value;
  const newPw = document.getElementById('prof-new-pw').value;

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-user-id': state.user.id
      },
      body: JSON.stringify({ currentPassword: curPw, newPassword: newPw })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('prof-cur-pw').value = '';
      document.getElementById('prof-new-pw').value = '';
    } else {
      showToast(data.error || 'Failed to change password', 'error');
    }
  } catch (err) {
    showToast('Network error updating password', 'error');
  }
}


/* =========================================================
   5SIM EXACT PIXEL-PERFECT SIDEBAR & OPERATOR LOGIC
   ========================================================= */

function init5SimUI() {
  if (!state.selectedService && state.services.length > 0) {
    state.selectedService = state.services.find(s => s.id === 'whatsapp') || state.services[0];
  }
  if (!state.selectedCountry && state.countries.length > 0) {
    state.selectedCountry = state.countries.find(c => c.id === 'usa') || state.countries[0];
  }

  render5simServicePill();
  render5simCountryPill();
  update5simOperators();
}

function render5simServicePill() {
  const s = state.selectedService;
  if (!s) return;
  const iconElem = document.getElementById('pill-service-icon');
  const nameElem = document.getElementById('pill-service-name');
  if (iconElem) iconElem.innerHTML = getServiceIcon(s.id);
  if (nameElem) nameElem.innerText = s.name;
}

function render5simCountryPill() {
  const c = state.selectedCountry;
  if (!c) return;
  const flagElem = document.getElementById('pill-country-flag');
  const nameElem = document.getElementById('pill-country-name');
  if (flagElem) flagElem.innerText = c.flag;
  if (nameElem) nameElem.innerText = c.name;
}

function toggleServicePicker(forceClose = false) {
  const drawer = document.getElementById('service-picker-drawer');
  if (!drawer) return;
  const shouldOpen = forceClose === true ? false : (drawer.style.display === 'none' || drawer.style.display === '');
  drawer.style.display = shouldOpen ? 'block' : 'none';
  if (shouldOpen) {
    const input = document.getElementById('service-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    renderServicesGrid('');
  }
}

function filterServices(query) {
  renderServicesGrid(query);
}

function renderServicesGrid(query = '') {
  const grid = document.getElementById('services-grid-list');
  if (!grid) return;

  const filtered = state.services.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    s.id.toLowerCase().includes(query.toLowerCase())
  );

  grid.innerHTML = filtered.map(s => {
    const isSelected = state.selectedService && state.selectedService.id === s.id;
    return `
      <div class="fivesim-grid-item ${isSelected ? 'active' : ''}" onclick="select5simService('${s.id}')">
        <span style="font-size: 1.15rem;">${getServiceIcon(s.id)}</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</span>
      </div>
    `;
  }).join('');
}

function select5simService(id) {
  state.selectedService = state.services.find(s => s.id === id);
  toggleServicePicker(true);
  render5simServicePill();
  update5simOperators();
}

function toggleCountryPicker(forceClose = false) {
  const drawer = document.getElementById('country-picker-drawer');
  if (!drawer) return;
  const shouldOpen = forceClose === true ? false : (drawer.style.display === 'none' || drawer.style.display === '');
  drawer.style.display = shouldOpen ? 'block' : 'none';
  if (shouldOpen) {
    const input = document.getElementById('country-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    renderCountriesGrid('');
  }
}

function filterCountries(query) {
  renderCountriesGrid(query);
}

function renderCountriesGrid(query = '') {
  const grid = document.getElementById('countries-grid-list');
  if (!grid) return;

  const filtered = state.countries.filter(c =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.code.includes(query)
  );

  grid.innerHTML = filtered.map(c => {
    const isSelected = state.selectedCountry && state.selectedCountry.id === c.id;
    return `
      <div class="fivesim-grid-item ${isSelected ? 'active' : ''}" onclick="select5simCountry('${c.id}')">
        <span style="font-size: 1.15rem;">${c.flag}</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.name}</span>
      </div>
    `;
  }).join('');
}

function select5simCountry(id) {
  state.selectedCountry = state.countries.find(c => c.id === id);
  toggleCountryPicker(true);
  render5simCountryPill();
  update5simOperators();
}

// Update 5SIM Operators & Live Pricing
let operatorAbortController = null;

async function update5simOperators() {
  const s = state.selectedService;
  const c = state.selectedCountry;
  const listContainer = document.getElementById('operators-cards-list');
  const stockBadge = document.getElementById('fivesim-total-stock');
  if (!listContainer || !s || !c) return;

  listContainer.innerHTML = `
    <div style="padding: 1.25rem 0.5rem; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
      <div class="radar-pulse-dot" style="margin: 0 auto 8px auto;"></div>
      Fetching live rates & operators for ${s.name} in ${c.name}...
    </div>
  `;

  if (stockBadge) {
    stockBadge.innerText = '● Syncing...';
    stockBadge.style.color = 'var(--text-muted)';
  }

  if (operatorAbortController) operatorAbortController.abort();
  operatorAbortController = new AbortController();

  try {
    const res = await fetch(`/api/price?serviceId=${s.id}&countryId=${c.id}`, {
      signal: operatorAbortController.signal
    });
    const data = await res.json();

    if (data.success) {
      state.currentPriceData = data;

      if (stockBadge) {
        if (data.totalStock > 0) {
          stockBadge.innerText = `● ${data.totalStock.toLocaleString()} In Stock`;
          stockBadge.style.color = 'var(--brand-emerald)';
        } else {
          stockBadge.innerText = '✕ Out of Stock';
          stockBadge.style.color = '#ef4444';
        }
      }

      if (!data.operators || data.operators.length === 0) {
        listContainer.innerHTML = `
          <div style="padding: 1rem; text-align: center; color: #ef4444; font-size: 0.84rem; background: var(--bg-hover); border-radius: 8px;">
            ⚠️ No operators currently in stock for ${s.name} in ${c.name}. Please choose another country.
          </div>
        `;
        return;
      }

      listContainer.innerHTML = data.operators.map((op, idx) => {
        const isBestRate = op.id === 'virtual28' || (op.successRate && op.successRate.includes('42%'));
        const isAny = op.id === 'any';

        return `
          <div class="fivesim-op-card">
            <div class="fivesim-op-left">
              <div class="fivesim-op-header">
                <span class="fivesim-op-title">${op.name}</span>
                ${isBestRate ? '<span class="fivesim-op-badge-best">BEST RATE</span>' : ''}
              </div>
              <div class="fivesim-op-meta">
                ${op.successRate && !isAny ? `<span class="fivesim-op-rate">📈 ${op.successRate} >1 SMS</span>` : ''}
                <span class="fivesim-op-count">${op.count.toLocaleString()} numbers</span>
              </div>
            </div>
            <div class="fivesim-op-right">
              <div class="fivesim-op-pricing">
                <div class="fivesim-op-price-usd">${formatMoney(op.retailUsd, op.retailPkr)}</div>
                <div class="fivesim-op-price-pkr">${state.currency === 'PKR' ? '$' + op.retailUsd.toFixed(2) : '₨ ' + op.retailPkr.toLocaleString()}</div>
              </div>
              <button class="fivesim-buy-btn" onclick="buyOperator('${op.id}', ${op.retailUsd}, ${op.retailPkr}, this)" ${op.count === 0 && !isAny ? 'disabled' : ''}>
                🛒 Buy
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Error fetching live operators:', err);
      listContainer.innerHTML = `
        <div style="padding: 1rem; text-align: center; color: #ef4444; font-size: 0.82rem;">
          Failed to load live rates. Please try again.
        </div>
      `;
    }
  }
}

// Buy Number directly by clicking any Operator's Buy Button
async function buyOperator(opId, costUsd, costPkr, btnElem) {
  if (!state.user) {
    openLoginModal();
    return;
  }

  const s = state.selectedService;
  const c = state.selectedCountry;

  if (state.user.balanceUsd < costUsd) {
    showToast(`Insufficient balance! Price is ${formatMoney(costUsd, costPkr)}, but your balance is ${formatMoney(state.user.balanceUsd, state.user.balancePkr)}. Please top up your wallet.`, 'error');
    setTimeout(() => {
      window.location.href = '/payment';
    }, 1800);
    return;
  }

  const originalHtml = btnElem.innerHTML;
  btnElem.disabled = true;
  btnElem.innerHTML = '⏳ Getting...';

  try {
    const res = await fetch('/api/orders/buy', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        serviceId: s.id,
        countryId: c.id,
        operator: opId
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      state.user.balanceUsd = data.newBalanceUsd;
      state.user.balancePkr = data.newBalancePkr;
      renderHeaderUser();

      if (data.order) {
        state.activeOrders = [data.order, ...(state.activeOrders || []).filter(o => o.id !== data.order.id)];
        switchMainTab('active');
        renderLiveOrders();
      }

      await fetchMyOrders();
    } else {
      showToast(data.error || 'Failed to buy number', 'error');
    }
  } catch (err) {
    console.error('Error buying number:', err);
    showToast('Network error while purchasing number', 'error');
  } finally {
    btnElem.disabled = false;
    btnElem.innerHTML = originalHtml;
  }
}

// Switch between Active Orders and History tabs
function switchMainTab(tab) {
  const tabActive = document.getElementById('main-tab-active-orders');
  const tabHistory = document.getElementById('main-tab-history');
  const viewActive = document.getElementById('active-orders-view');
  const viewHistory = document.getElementById('history-orders-view');

  if (tab === 'active') {
    if (tabActive) tabActive.classList.add('active');
    if (tabHistory) tabHistory.classList.remove('active');
    if (viewActive) viewActive.style.display = 'block';
    if (viewHistory) viewHistory.style.display = 'none';
  } else {
    if (tabActive) tabActive.classList.remove('active');
    if (tabHistory) tabHistory.classList.add('active');
    if (viewActive) viewActive.style.display = 'none';
    if (viewHistory) viewHistory.style.display = 'block';
    fetchMyOrders();
  }
}


/* =========================================================
   5SIM SMART BUY CLIENT LOGIC
   ========================================================= */

state.smartMaxPrice = null;
state.favoriteServices = JSON.parse(localStorage.getItem('smspulse_favs') || '["whatsapp", "facebook", "telegram"]');
state.smartCatalog = [];

function switchSidebarTab(tab) {
  const tabManual = document.getElementById('tab-manual-buy');
  const tabSmart = document.getElementById('tab-smart-buy');
  const manualContainer = document.getElementById('sidebar-manual-buy-container');
  const smartContainer = document.getElementById('sidebar-smart-buy-container');

  if (tab === 'manual') {
    if (tabManual) tabManual.classList.add('active');
    if (tabSmart) tabSmart.classList.remove('active');
    if (manualContainer) manualContainer.style.display = 'block';
    if (smartContainer) smartContainer.style.display = 'none';
  } else {
    if (tabManual) tabManual.classList.remove('active');
    if (tabSmart) tabSmart.classList.add('active');
    if (manualContainer) manualContainer.style.display = 'none';
    if (smartContainer) smartContainer.style.display = 'block';
    loadSmartBuyCatalog();
  }
}

async function loadSmartBuyCatalog() {
  const container = document.getElementById('smart-services-list');
  if (state.smartCatalog && state.smartCatalog.length > 0) {
    renderSmartBuyList();
    return;
  }

  if (container) {
    container.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.82rem;">Loading smart services...</div>';
  }

  try {
    const res = await fetch('/api/smart-catalog');
    const data = await res.json();
    if (data.success) {
      state.smartCatalog = data.services;
      renderSmartBuyList();
    }
  } catch (err) {
    console.error('Error loading smart catalog:', err);
    if (state.services && state.services.length > 0) {
      state.smartCatalog = state.services.map(s => ({
        id: s.id,
        name: s.name,
        startingPriceUsd: s.priceUsd || 0.15,
        startingPricePkr: s.pricePkr || 42
      }));
      renderSmartBuyList();
    }
  }
}

function setSmartMaxPrice(maxVal, chipElem) {
  state.smartMaxPrice = maxVal;
  document.querySelectorAll('.smart-price-chip').forEach(c => c.classList.remove('active'));
  if (chipElem) chipElem.classList.add('active');
  renderSmartBuyList(document.getElementById('smart-service-search')?.value || '');
}

function filterSmartServices(query) {
  renderSmartBuyList(query);
}

function toggleFavoriteService(serviceId, e) {
  if (e) e.stopPropagation();
  const idx = state.favoriteServices.indexOf(serviceId);
  if (idx !== -1) {
    state.favoriteServices.splice(idx, 1);
  } else {
    state.favoriteServices.push(serviceId);
  }
  localStorage.setItem('smspulse_favs', JSON.stringify(state.favoriteServices));
  renderSmartBuyList(document.getElementById('smart-service-search')?.value || '');
}

function renderSmartBuyList(query = '') {
  const container = document.getElementById('smart-services-list');
  const countBadge = document.getElementById('smart-services-count');
  if (!container) return;

  const q = query.trim().toLowerCase();
  let list = (state.smartCatalog || []).filter(s =>
    s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
  );

  if (state.smartMaxPrice !== null) {
    list = list.filter(s => s.startingPriceUsd <= state.smartMaxPrice);
  }

  // Pin favorites to the top
  list.sort((a, b) => {
    const aFav = state.favoriteServices.includes(a.id);
    const bFav = state.favoriteServices.includes(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.startingPriceUsd - b.startingPriceUsd;
  });

  if (countBadge) countBadge.innerText = list.length;

  if (list.length === 0) {
    container.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.82rem;">No services match this price or search filter.</div>';
    return;
  }

  container.innerHTML = list.map(s => {
    const isFav = state.favoriteServices.includes(s.id);
    return `
      <div class="smart-buy-row">
        <div class="smart-buy-left">
          <span class="smart-fav-star" onclick="toggleFavoriteService('${s.id}', event)" title="${isFav ? 'Remove favorite' : 'Pin to favorites'}">
            ${isFav ? '⭐' : '☆'}
          </span>
          <span style="font-size: 1.15rem;">${getServiceIcon(s.id)}</span>
          <span class="smart-service-name">${s.name}</span>
        </div>
        <div class="smart-buy-right">
          <span class="smart-service-from">from <strong>$${s.startingPriceUsd.toFixed(2)}</strong></span>
          <button class="smart-buy-cart-btn" onclick="executeSmartBuy('${s.id}', ${s.startingPriceUsd}, this)" title="1-Click Automated Purchase">
            🛒
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function executeSmartBuy(serviceId, startingPrice, btnElem) {
  if (!state.user) {
    openLoginModal();
    return;
  }

  if (state.user.balanceUsd < startingPrice) {
    showToast(`Insufficient balance! Minimum price is $${startingPrice.toFixed(2)}. Please top up your wallet.`, 'error');
    setTimeout(() => {
      window.location.href = '/payment';
    }, 1800);
    return;
  }

  const originalText = btnElem.innerHTML;
  btnElem.disabled = true;
  btnElem.innerHTML = '⏳';

  try {
    const res = await fetch('/api/orders/smart-buy', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        serviceId,
        maxPrice: state.smartMaxPrice
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      state.user.balanceUsd = data.newBalanceUsd;
      state.user.balancePkr = data.newBalancePkr;
      renderHeaderUser();

      if (data.order) {
        state.activeOrders = [data.order, ...(state.activeOrders || []).filter(o => o.id !== data.order.id)];
        switchMainTab('active');
        renderLiveOrders();
      }

      await fetchMyOrders();
    } else {
      showToast(data.error || 'Failed to complete Smart Buy order', 'error');
    }
  } catch (err) {
    console.error('Smart buy error:', err);
    showToast('Network error during Smart Buy order', 'error');
  } finally {
    btnElem.disabled = false;
    btnElem.innerHTML = originalText;
  }
}


// modal-backdrop click listener to close on outside click
document.addEventListener('click', (e) => {
  if (e.target && e.target.classList && e.target.classList.contains('modal-backdrop')) {
    e.target.classList.remove('open');
  }
});
