const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');
const { sendVerificationEmail } = require('../services/mailer');

// Verification codes cache: email -> { code, type, payload, expiresAt }
const verificationCodes = new Map();

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanEmail(email) {
  return (email || '').toLowerCase().trim();
}

// 1. Register with 6-Digit Email Verification Code
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const userEmail = cleanEmail(email);

  if (!userEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const users = readData('users');
  const existing = users.find(u => cleanEmail(u.email) === userEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists. Please Sign In.' });
  }

  const cleanName = name && name.trim() ? name.trim() : userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const pin = generatePin();

  verificationCodes.set(userEmail, {
    code: pin,
    type: 'register',
    payload: { name: cleanName, email: userEmail, password },
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  console.log(`[REGISTER OTP GENERATED] ${userEmail} -> Code: ${pin}`);
  const mailResult = await sendVerificationEmail(userEmail, pin, 'Registration');

  res.json({
    success: true,
    requireOtp: true,
    email: userEmail,
    devCode: mailResult && mailResult.success ? null : pin,
    message: `A 6-digit verification code has been issued for ${userEmail}.`
  });
});

// 2. Login with 6-Digit Security Code
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const userEmail = cleanEmail(email);

  if (!userEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const users = readData('users');
  const user = users.find(
    u => cleanEmail(u.email) === userEmail && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password. Please try again.' });
  }

  const pin = generatePin();
  verificationCodes.set(userEmail, {
    code: pin,
    type: 'login',
    payload: { userId: user.id },
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  console.log(`[LOGIN OTP GENERATED] ${userEmail} -> Code: ${pin}`);
  const mailResult = await sendVerificationEmail(userEmail, pin, 'Login Security');

  res.json({
    success: true,
    requireOtp: true,
    email: userEmail,
    devCode: mailResult && mailResult.success ? null : pin,
    message: `A 6-digit security code has been issued for ${userEmail}.`
  });
});

// 3. Google Sign-In with 6-Digit Verification Code
router.post('/google', async (req, res) => {
  const { email, name, avatar, googleId } = req.body;
  const userEmail = cleanEmail(email);

  if (!userEmail) {
    return res.status(400).json({ error: 'Google email is required' });
  }

  const cleanName = name && name.trim() ? name.trim() : userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const pin = generatePin();

  verificationCodes.set(userEmail, {
    code: pin,
    type: 'google',
    payload: { email: userEmail, name: cleanName, avatar, googleId },
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  console.log(`[GOOGLE OTP GENERATED] ${userEmail} -> Code: ${pin}`);
  const mailResult = await sendVerificationEmail(userEmail, pin, 'Google Verification');

  res.json({
    success: true,
    requireOtp: true,
    email: userEmail,
    devCode: mailResult && mailResult.success ? null : pin,
    message: `A 6-digit verification code has been issued for ${userEmail}.`
  });
});

// 4. Universal 6-Digit Code Verification
router.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  const userEmail = cleanEmail(email);

  if (!userEmail || !code) {
    return res.status(400).json({ error: 'Email and 6-digit verification code are required' });
  }

  const cached = verificationCodes.get(userEmail);
  if (!cached) {
    return res.status(400).json({ error: 'No active verification session. Please request a new code.' });
  }

  if (cached.code !== code.trim()) {
    return res.status(400).json({ error: 'Invalid verification code. Please check your Gmail inbox and enter the 6-digit code.' });
  }

  if (Date.now() > cached.expiresAt) {
    verificationCodes.delete(userEmail);
    return res.status(400).json({ error: 'Verification code has expired. Please click Resend New Code.' });
  }

  const users = readData('users');

  if (cached.type === 'register') {
    const { name, password } = cached.payload;
    const newUser = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: name,
      email: userEmail,
      password: password,
      authProvider: 'email',
      role: userEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
      balanceUsd: 0.0,
      balancePkr: 0.0,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeData('users', users);
    verificationCodes.delete(userEmail);

    const { password: _, ...safeUser } = newUser;
    return res.json({
      success: true,
      user: safeUser,
      message: `🎉 Welcome ${newUser.name}! Your account is active with $0.00 balance.`
    });
  }

  if (cached.type === 'login') {
    const user = users.find(u => u.id === cached.payload.userId || cleanEmail(u.email) === userEmail);
    verificationCodes.delete(userEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password: _, ...safeUser } = user;
    return res.json({ success: true, user: safeUser, message: `Welcome back, ${user.name}!` });
  }

  if (cached.type === 'google') {
    const { name, avatar, googleId } = cached.payload;
    let user = users.find(u => cleanEmail(u.email) === userEmail);
    let isNew = false;
    if (user) {
      if (userEmail === 'rizwansaeed2980@gmail.com') user.role = 'admin';
      writeData('users', users);
    } else {
      isNew = true;
      user = {
        id: 'usr_g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: name,
        email: userEmail,
        avatar: avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name)),
        googleId: googleId || ('gid_' + Date.now()),
        authProvider: 'google',
        role: userEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
        balanceUsd: 0.0,
        balancePkr: 0.0,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      writeData('users', users);
    }
    verificationCodes.delete(userEmail);
    const { password: _, ...safeUser } = user;
    return res.json({ success: true, user: safeUser, isNew, message: isNew ? `Welcome ${user.name}!` : `Welcome back, ${user.name}!` });
  }

  res.status(400).json({ error: 'Unknown verification action' });
});

// 5. Resend Verification Code
router.post('/resend-code', async (req, res) => {
  const { email } = req.body;
  const userEmail = cleanEmail(email);
  if (!userEmail) return res.status(400).json({ error: 'Email is required' });

  const cached = verificationCodes.get(userEmail);
  if (!cached) {
    return res.status(400).json({ error: 'No active session found. Please try signing in again.' });
  }

  const newPin = generatePin();
  cached.code = newPin;
  cached.expiresAt = Date.now() + 10 * 60 * 1000;
  verificationCodes.set(userEmail, cached);

  console.log(`[OTP RESENT] ${userEmail} -> Code: ${newPin}`);
  const mailResult = await sendVerificationEmail(userEmail, newPin, 'Verification Code');

  res.json({
    success: true,
    devCode: mailResult && mailResult.success ? null : newPin,
    message: `A new 6-digit verification code has been issued for ${userEmail}.`
  });
});

// 6. Get Profile
router.get('/me', (req, res) => {
  const userId = req.headers['x-user-id'];
  const userEmail = cleanEmail(req.headers['x-user-email']);
  if (!userId && !userEmail) return res.status(401).json({ error: 'Not authenticated' });

  const users = readData('users');
  let user = users.find(u => u.id === userId || (userEmail && cleanEmail(u.email) === userEmail));

  if (!user && userEmail) {
    user = {
      id: userId || ('usr_' + Date.now()),
      name: userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      email: userEmail,
      authProvider: 'email',
      role: userEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
      balanceUsd: 0.0,
      balancePkr: 0.0,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeData('users', users);
  }

  if (!user) return res.status(404).json({ error: 'User not found' });

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

module.exports = router;
