const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/services'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/admin', require('./routes/admin'));

// Clean URL Routing
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/payment.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/faq', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/faq.html'));
});

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/docs.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Global Error Handlers to keep daemon robust
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception caught:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection caught:', reason);
});

app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚀 SMSPulse Server is Running!`);
  console.log(`🌐 Local URL: http://localhost:${PORT}`);
  console.log(`💳 Payment Page: http://localhost:${PORT}/payment`);
  console.log(`⚙️ Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`=========================================`);
});
