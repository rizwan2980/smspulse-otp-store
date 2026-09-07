const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../db');

// Helper: clean and normalize email
function cleanEmail(email) {
  return (email || '').toLowerCase().trim();
}

// 1. Instant Permanent Registration (5SIM Standard - Fast, 0-Friction)
router.post('/register', (req, res) => {
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

  const newUser = {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: cleanName,
    email: userEmail,
    password: password,
    authProvider: 'email',
    role: userEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
    balanceUsd: 0.0, // Strictly $0.00 starting balance
    balancePkr: 0.0,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  writeData('users', users);

  console.log(`[INSTANT REGISTER SUCCESS] ${newUser.name} (${newUser.email}) - Role: ${newUser.role}, Balance: $0.00`);

  const { password: _, ...safeUser } = newUser;
  res.json({
    success: true,
    user: safeUser,
    message: `Welcome ${newUser.name}! Your account is active with $0.00 balance.`
  });
});

// 2. Instant Standard Login
router.post('/login', (req, res) => {
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

  console.log(`[LOGIN SUCCESS] ${user.name} (${user.email}) - Role: ${user.role}`);

  const { password: _, ...safeUser } = user;
  res.json({
    success: true,
    user: safeUser,
    message: `Welcome back, ${user.name}!`
  });
});

// 3. Instant Google Sign-In (Clean, 1-Click, No Leaked Admin Email)
router.post('/google', (req, res) => {
  const { email, name, avatar, googleId } = req.body;
  const userEmail = cleanEmail(email);

  if (!userEmail) {
    return res.status(400).json({ error: 'Google email is required' });
  }

  const users = readData('users');
  let user = users.find(u => cleanEmail(u.email) === userEmail);
  let isNew = false;

  const cleanName = name && name.trim() ? name.trim() : userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  if (user) {
    user.authProvider = user.authProvider || 'google';
    if (avatar && !user.avatar) user.avatar = avatar;
    if (googleId && !user.googleId) user.googleId = googleId;
    if (userEmail === 'rizwansaeed2980@gmail.com') user.role = 'admin';
    writeData('users', users);
  } else {
    isNew = true;
    user = {
      id: 'usr_g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: cleanName,
      email: userEmail,
      avatar: avatar || ('https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(cleanName)),
      googleId: googleId || ('gid_' + Date.now()),
      authProvider: 'google',
      role: userEmail === 'rizwansaeed2980@gmail.com' ? 'admin' : 'user',
      balanceUsd: 0.0, // Strictly $0.00 starting balance
      balancePkr: 0.0,
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeData('users', users);
  }

  console.log(`[GOOGLE AUTH SUCCESS] ${user.name} (${user.email}) - Role: ${user.role}, IsNew: ${isNew}, Balance: $${user.balanceUsd}`);

  const { password: _, ...safeUser } = user;
  res.json({
    success: true,
    user: safeUser,
    isNew,
    message: isNew ? `Welcome ${user.name}! Your account is ready.` : `Welcome back, ${user.name}!`
  });
});

// 4. Password Reset - Step 1
router.post('/forgot-password', (req, res) => {
  const { email } = req.body;
  const userEmail = cleanEmail(email);
  if (!userEmail) return res.status(400).json({ error: 'Email address is required' });

  const users = readData('users');
  const user = users.find(u => cleanEmail(u.email) === userEmail);
  if (!user) {
    return res.json({ success: true, message: 'If an account exists, a reset code has been issued.' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  res.json({
    success: true,
    message: `Password reset request received for ${userEmail}.`
  });
});

// 5. Change Password
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

// 6. Get Profile
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
