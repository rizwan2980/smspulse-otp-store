const https = require('https');

function request5sim(endpoint, token, method = 'GET') {
  return new Promise((resolve, reject) => {
    if (!token) {
      return resolve({ status: 400, data: { error: 'No 5SIM API token provided' } });
    }

    const options = {
      hostname: '5sim.net',
      port: 443,
      path: '/v1/user/' + endpoint,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token.trim(),
        'Accept': 'application/json',
        'User-Agent': 'SMSPulse-5SIM-Client/1.0'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ status: 500, data: { error: err.message } });
    });
    req.end();
  });
}

// Check Profile & 5SIM Balance
async function getProfile(token) {
  return request5sim('profile', token);
}

// Buy Activation Number
async function buyActivation(token, country, operator, product) {
  return request5sim('buy/activation/' + country + '/' + operator + '/' + product, token);
}

// Check incoming SMS on 5SIM
async function checkOrder(token, orderId) {
  return request5sim('check/' + orderId, token);
}

// Cancel 5SIM order and get refund
async function cancelOrder(token, orderId) {
  return request5sim('cancel/' + orderId, token);
}

// Ban 5SIM order (e.g. number banned or invalid on WhatsApp/service)
async function banOrder(token, orderId) {
  return request5sim('ban/' + orderId, token);
}

// Finish / Complete order
async function finishOrder(token, orderId) {
  return request5sim('finish/' + orderId, token);
}

module.exports = {
  getProfile,
  buyActivation,
  checkOrder,
  cancelOrder,
  banOrder,
  finishOrder
};
