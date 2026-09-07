let app;

module.exports = (req, res) => {
  try {
    if (!app) {
      app = require('../server/server');
    }
    return app(req, res);
  } catch (err) {
    console.error('Vercel Serverless Error:', err);
    res.status(500).json({
      error: 'Vercel Serverless Error',
      message: err.message,
      stack: err.stack
    });
  }
};
