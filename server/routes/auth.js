const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');

// Permanent in-memory cache for reset tokens
const resetTokens = new Map();

// 1. Permanent Instant Registration (5SIM & SMS-Activate Standard)
router.post('/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const users = readData('users');
  const existing = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists. Please Sign In.' });
  }

  const cleanName = name && name.trim() ? name.trim() : email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: cleanName,
    email: email.toLowerCase().trim(),
    password: password,
    authProvider: 'email',
    role: 'user',
    balanceUsd: 0.0, // 0 balance: User must deposit funds first
    balancePkr: 0.0,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeData('users', users);

  console.log(`[NEW PERMANENT USER CREATED] ${newUser.name} (${newUser.email}) with $0.00 balance`);

  const { password: _, ...safeUser } = newUser;
  res.json({
    success: true,
    user: safeUser,
    message: `Welcome ${newUser.name}! Your account is active with $0.00 balance.`
  });
});

// 2. Permanent Standard Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const users = readData('users');
  const user = users.find(
    u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password. Please try again.' });
  }

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, message: `Welcome back, ${user.name}!` });
});

// 3. Permanent Google / Gmail Sign-In
router.post('/google', (req, res) => {
  const { email, name, avatar, googleId } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Google email is required' });
  }

  const users = readData('users');
  const cleanEmail = email.toLowerCase().trim();
  let user = users.find(u => u.email.toLowerCase() === cleanEmail);
  let isNew = false;

  if (user) {
    user.authProvider = user.authProvider || 'google';
    if (avatar && !user.avatar) user.avatar = avatar;
    if (googleId && !user.googleId) user.googleId = googleId;
    writeData('users', users);
  } else {
    isNew = true;
    const cleanName = name && name.trim() ? name.trim() : cleanEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    user = {
      id: 'usr_g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: cleanName,
      email: cleanEmail,
      avatar: avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(cleanName)),
      googleId: googleId || ('gid_' + Date.now()),
      authProvider: 'google',
      role: 'user',
      balanceUsd: 5.0,
      balancePkr: 0.0,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeData('users', users);
  }

  console.log(`[GOOGLE USER SIGN-IN] ${user.name} (${user.email}) - IsNew: ${isNew}`);

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, isNew });
});

// 4. Permanent Password Reset - Step 1
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email address is required' });

  const users = readData('users');
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (!user) {
    return res.json({ success: true, message: 'If an account exists, a reset code has been issued.' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  resetTokens.set(email.toLowerCase().trim(), {
    code,
    expiresAt: Date.now() + 15 * 60 * 1000
  });

  res.json({
    success: true,
    message: `Your Password Reset PIN is: ${code}. Please enter it below to set a new password.`,
    devCode: code
  });
});

// 5. Permanent Password Reset - Step 2
router.post('/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const tokenData = resetTokens.get(cleanEmail);
  if (!tokenData || tokenData.code !== code.trim() || Date.now() > tokenData.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired reset code. Please request a new one.' });
  }

  const users = readData('users');
  const user = users.find(u => u.email.toLowerCase() === cleanEmail);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.password = newPassword;
  writeData('users', users);
  resetTokens.delete(cleanEmail);

  res.json({ success: true, message: 'Password has been reset successfully! You can now sign in.' });
});

// 6. Change Password (Logged-in profile)
router.post('/change-password', (req, res) => {
  const userId = req.headers['x-user-id'];
  const { currentPassword, newPassword } = req.body;

  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const users = readData('users');
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.password && user.password !== currentPassword) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  user.password = newPassword;
  writeData('users', users);
  res.json({ success: true, message: 'Password updated successfully' });
});

// 7. Get Profile
router.get('/me', (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  const users = readData('users');
  const user = users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

module.exports = router;
