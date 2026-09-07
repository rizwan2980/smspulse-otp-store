const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');
const { sendVerificationEmail } = require('../services/mailer');

// In-memory caches for verification and reset codes
const verificationCodes = new Map();
const resetTokens = new Map();

// Helper: generate 6-digit numeric PIN
function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. Registration
router.post('/register', async (req, res) => {
  const { name, email, password, code } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const users = readData('users');
  const existing = users.find(u => u.email.toLowerCase() === cleanEmail);
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists. Please Sign In.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  const cleanName = name && name.trim() ? name.trim() : cleanEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // If code is not provided, issue verification code
  if (!code) {
    const pin = generatePin();
    verificationCodes.set(cleanEmail, {
      code: pin,
      type: 'register',
      payload: { name: cleanName, email: cleanEmail, password },
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[REGISTER OTP ISSUED] ${cleanEmail} -> Code: ${pin}`);
    sendVerificationEmail(cleanEmail, pin, 'Registration');

    return res.json({
      success: true,
      requireOtp: true,
      email: cleanEmail,
      message: `A 6-digit verification code has been sent to ${cleanEmail}. Please check your Inbox and Spam folder.`
    });
  }

  // If code is provided directly
  const cached = verificationCodes.get(cleanEmail);
  if (!cached || cached.code !== code.trim() || Date.now() > cached.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired verification code. Please check your email or click Resend.' });
  }

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: cleanName,
    email: cleanEmail,
    password: password,
    authProvider: 'email',
    role: cleanEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
    balanceUsd: 0.0,
    balancePkr: 0.0,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeData('users', users);
  verificationCodes.delete(cleanEmail);

  console.log(`[NEW USER REGISTERED] ${newUser.name} (${newUser.email}) Balance: $0.00`);

  const { password: _, ...safeUser } = newUser;
  res.json({
    success: true,
    user: safeUser,
    message: `Welcome ${newUser.name}! Your account is active with $0.00 balance.`
  });
});

// 2. Login
router.post('/login', async (req, res) => {
  const { email, password, code } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const users = readData('users');
  const user = users.find(
    u => u.email.toLowerCase() === cleanEmail && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password. Please try again.' });
  }

  // If code not provided, issue 2FA login verification code
  if (!code) {
    const pin = generatePin();
    verificationCodes.set(cleanEmail, {
      code: pin,
      type: 'login',
      payload: { userId: user.id },
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[LOGIN OTP ISSUED] ${cleanEmail} -> Code: ${pin}`);
    sendVerificationEmail(cleanEmail, pin, 'Login Security');

    return res.json({
      success: true,
      requireOtp: true,
      email: cleanEmail,
      message: `A 6-digit security code has been sent to ${cleanEmail}. Please check your Inbox and Spam folder.`
    });
  }

  // If code provided
  const cached = verificationCodes.get(cleanEmail);
  if (!cached || cached.code !== code.trim() || Date.now() > cached.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired verification code. Please check your email or click Resend.' });
  }

  verificationCodes.delete(cleanEmail);
  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, message: `Welcome back, ${user.name}!` });
});

// 3. Google Sign-In with Verification Code
router.post('/google', async (req, res) => {
  const { email, name, avatar, googleId, code } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Google email is required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const cleanName = name && name.trim() ? name.trim() : cleanEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  // If code not provided, require OTP verification before activating
  if (!code) {
    const pin = generatePin();
    verificationCodes.set(cleanEmail, {
      code: pin,
      type: 'google',
      payload: { email: cleanEmail, name: cleanName, avatar, googleId },
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    console.log(`[GOOGLE OTP ISSUED] ${cleanEmail} -> Code: ${pin}`);
    sendVerificationEmail(cleanEmail, pin, 'Google Verification');

    return res.json({
      success: true,
      requireOtp: true,
      email: cleanEmail,
      message: `A 6-digit verification code has been sent to ${cleanEmail}. Please check your Inbox and Spam folder.`
    });
  }

  // If code provided, verify
  const cached = verificationCodes.get(cleanEmail);
  if (!cached || cached.code !== code.trim() || Date.now() > cached.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired verification code. Please check your email or click Resend.' });
  }

  const users = readData('users');
  let user = users.find(u => u.email.toLowerCase() === cleanEmail);
  let isNew = false;

  if (user) {
    user.authProvider = user.authProvider || 'google';
    if (avatar && !user.avatar) user.avatar = avatar;
    if (googleId && !user.googleId) user.googleId = googleId;
    if (cleanEmail === 'rizwansaeed2980@gmail.com') user.role = 'admin';
    writeData('users', users);
  } else {
    isNew = true;
    user = {
      id: 'usr_g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: cleanName,
      email: cleanEmail,
      avatar: avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(cleanName)),
      googleId: googleId || ('gid_' + Date.now()),
      authProvider: 'google',
      role: cleanEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
      balanceUsd: 0.0,
      balancePkr: 0.0,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeData('users', users);
  }

  verificationCodes.delete(cleanEmail);
  console.log(`[GOOGLE VERIFIED] ${user.name} (${user.email}) - IsNew: ${isNew}, Balance: $${user.balanceUsd}`);

  const { password: _, ...safeUser } = user;
  res.json({ success: true, user: safeUser, isNew });
});

// 4. Universal Code Verification Endpoint
router.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const cached = verificationCodes.get(cleanEmail);

  if (!cached) {
    return res.status(400).json({ error: 'No active verification request found. Please request a new code.' });
  }

  if (cached.code !== code.trim()) {
    return res.status(400).json({ error: 'Invalid verification code. Please check your Gmail inbox and try again.' });
  }

  if (Date.now() > cached.expiresAt) {
    verificationCodes.delete(cleanEmail);
    return res.status(400).json({ error: 'Verification code has expired. Please click Resend New Code.' });
  }

  const users = readData('users');

  if (cached.type === 'register') {
    const { name, password } = cached.payload;
    const newUser = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: name,
      email: cleanEmail,
      password: password,
      authProvider: 'email',
      role: cleanEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
      balanceUsd: 0.0,
      balancePkr: 0.0,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeData('users', users);
    verificationCodes.delete(cleanEmail);

    const { password: _, ...safeUser } = newUser;
    return res.json({
      success: true,
      user: safeUser,
      message: `Account activated successfully!`
    });
  }

  if (cached.type === 'login') {
    const user = users.find(u => u.id === cached.payload.userId || u.email.toLowerCase() === cleanEmail);
    verificationCodes.delete(cleanEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password: _, ...safeUser } = user;
    return res.json({ success: true, user: safeUser, message: `Welcome back, ${user.name}!` });
  }

  if (cached.type === 'google') {
    const { name, avatar, googleId } = cached.payload;
    let user = users.find(u => u.email.toLowerCase() === cleanEmail);
    let isNew = false;
    if (user) {
      if (cleanEmail === 'rizwansaeed2980@gmail.com') user.role = 'admin';
      writeData('users', users);
    } else {
      isNew = true;
      user = {
        id: 'usr_g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: name,
        email: cleanEmail,
        avatar: avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name)),
        googleId: googleId || ('gid_' + Date.now()),
        authProvider: 'google',
        role: cleanEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
        balanceUsd: 0.0,
        balancePkr: 0.0,
        createdAt: new Date().toISOString()
      };
      users.push(user);
      writeData('users', users);
    }
    verificationCodes.delete(cleanEmail);
    const { password: _, ...safeUser } = user;
    return res.json({ success: true, user: safeUser, isNew, message: `Welcome ${user.name}!` });
  }

  res.status(400).json({ error: 'Unknown verification action' });
});

// 5. Resend Code Endpoint
router.post('/resend-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const cleanEmail = email.toLowerCase().trim();
  const cached = verificationCodes.get(cleanEmail);
  if (!cached) {
    return res.status(400).json({ error: 'No active session found. Please try signing in again.' });
  }

  const newPin = generatePin();
  cached.code = newPin;
  cached.expiresAt = Date.now() + 10 * 60 * 1000;
  verificationCodes.set(cleanEmail, cached);

  console.log(`[OTP RESENT] ${cleanEmail} -> Code: ${newPin}`);
  sendVerificationEmail(cleanEmail, newPin, 'Verification');

  res.json({
    success: true,
    message: `A new verification code has been sent to ${cleanEmail}. Please check your Inbox and Spam folder.`
  });
});

// 6. Permanent Password Reset - Step 1
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email address is required' });

  const cleanEmail = email.toLowerCase().trim();
  const users = readData('users');
  const user = users.find(u => u.email.toLowerCase() === cleanEmail);
  if (!user) {
    return res.json({ success: true, message: 'If an account exists, a reset code has been issued.' });
  }

  const code = generatePin();
  resetTokens.set(cleanEmail, {
    code,
    expiresAt: Date.now() + 15 * 60 * 1000
  });

  sendVerificationEmail(cleanEmail, code, 'Password Reset');

  res.json({
    success: true,
    message: `Password Reset code sent to ${cleanEmail}. Please check your email inbox and enter it below.`
  });
});

// 7. Permanent Password Reset - Step 2
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

// 8. Change Password (Logged-in profile)
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

// 9. Get Profile
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
