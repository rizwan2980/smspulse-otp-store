const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');

// Admin middleware
function checkAdmin(req, res, next) {
  const role = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  const users = readData('users');
  const user = users.find(u => u.id === userId);

  if (role === 'admin' || (user && user.role === 'admin')) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied. Admin rights required.' });
}

// Get all deposits
router.get('/deposits', checkAdmin, (req, res) => {
  const deposits = readData('deposits');
  res.json({ success: true, deposits });
});

// Approve deposit
router.post('/deposits/:id/approve', checkAdmin, (req, res) => {
  const deposits = readData('deposits');
  const deposit = deposits.find(d => d.id === req.params.id);

  if (!deposit) {
    return res.status(404).json({ error: 'Deposit not found' });
  }

  if (deposit.status === 'APPROVED') {
    return res.status(400).json({ error: 'Deposit already approved' });
  }

  deposit.status = 'APPROVED';
  deposit.approvedAt = new Date().toISOString();
  writeData('deposits', deposits);

  // Credit user wallet
  const users = readData('users');
  const user = users.find(u => u.id === deposit.userId);
  if (user) {
    const settings = readData('settings');
    user.balanceUsd = +(user.balanceUsd + deposit.amountUsd).toFixed(2);
    user.balancePkr = Math.round(user.balanceUsd * settings.exchangeRate);
    writeData('users', users);
  }

  res.json({ success: true, message: 'Deposit approved and balance credited', deposit });
});

// Reject deposit
router.post('/deposits/:id/reject', checkAdmin, (req, res) => {
  const deposits = readData('deposits');
  const deposit = deposits.find(d => d.id === req.params.id);

  if (!deposit) {
    return res.status(404).json({ error: 'Deposit not found' });
  }

  deposit.status = 'REJECTED';
  deposit.rejectedAt = new Date().toISOString();
  writeData('deposits', deposits);

  res.json({ success: true, message: 'Deposit rejected', deposit });
});

// Get users
router.get('/users', checkAdmin, (req, res) => {
  const users = readData('users');
  const safe = users.map(({ password, ...u }) => u);
  res.json({ success: true, users: safe });
});

// Adjust balance
router.post('/users/:id/balance', checkAdmin, (req, res) => {
  const { amountUsd } = req.body;
  const users = readData('users');
  const user = users.find(u => u.id === req.params.id);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const settings = readData('settings');
  user.balanceUsd = +(user.balanceUsd + parseFloat(amountUsd)).toFixed(2);
  user.balancePkr = Math.round(user.balanceUsd * settings.exchangeRate);
  writeData('users', users);

  res.json({ success: true, user });
});

// Get Settings
router.get('/settings', (req, res) => {
  const settings = readData('settings');
  res.json({ success: true, settings });
});

// Update Settings
router.post('/settings', checkAdmin, (req, res) => {
  const current = readData('settings');
  const updated = { ...current, ...req.body };
  writeData('settings', updated);
  res.json({ success: true, message: 'Settings saved successfully', settings: updated });
});

module.exports = router;
