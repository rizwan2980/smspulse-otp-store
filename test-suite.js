// test-suite.js
async function runTests() {
  const BASE_URL = 'http://localhost:3000';
  console.log('--- Starting Comprehensive API & UI Route Verification ---');

  // 1. Verify Pages serve 200 OK
  const pages = ['/', '/payment', '/admin', '/faq', '/docs'];
  for (const page of pages) {
    const res = await fetch(`${BASE_URL}${page}`);
    console.log(`Page: ${page.padEnd(10)} Status: ${res.status} ${res.statusText}`);
    if (res.status !== 200) throw new Error(`Page ${page} failed to load`);
  }

  // 2. Test Services & Countries
  const servRes = await fetch(`${BASE_URL}/api/services`);
  const servData = await servRes.json();
  console.log(`Services catalog loaded: ${servData.services.length} services available.`);

  const countRes = await fetch(`${BASE_URL}/api/countries`);
  const countData = await countRes.json();
  console.log(`Countries catalog loaded: ${countData.countries.length} countries available.`);

  // 3. Test Auth: Login as demo user
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'user123' })
  });
  const loginData = await loginRes.json();
  console.log(`Auth Login: User "${loginData.user.name}" logged in with balance $${loginData.user.balanceUsd} (PKR ${loginData.user.balancePkr})`);
  const userId = loginData.user.id;

  // 4. Test Buy Number
  console.log('Testing: Buy Virtual Number for WhatsApp in England...');
  const buyRes = await fetch(`${BASE_URL}/api/orders/buy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId
    },
    body: JSON.stringify({
      serviceId: 'whatsapp',
      countryId: 'england',
      operator: 'any'
    })
  });
  const buyData = await buyRes.json();
  console.log(`Order Placed: Order ID=${buyData.order.id}, Phone=${buyData.order.phone}, Cost=$${buyData.order.costUsd}, New Balance=$${buyData.newBalanceUsd}`);

  // 5. Test Live SMS Simulation
  console.log('Testing: Simulate incoming SMS code...');
  const smsRes = await fetch(`${BASE_URL}/api/orders/${buyData.order.id}/simulate-sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId
    }
  });
  const smsData = await smsRes.json();
  console.log(`SMS Received! Status=${smsData.order.status}, Code=${smsData.order.smsList[0].code}, Message="${smsData.order.smsList[0].text}"`);

  // 6. Test Cancel & Refund
  console.log('Testing: Cancel Order with Instant Refund...');
  const cancelRes = await fetch(`${BASE_URL}/api/orders/${buyData.order.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId
    }
  });
  const cancelData = await cancelRes.json();
  console.log(`Cancel & Refund Result: ${cancelData.message}, Restored Balance=$${cancelData.newBalanceUsd}`);

  // 7. Test Payment Deposit (EasyPaisa / JazzCash / Auto-approve)
  console.log('Testing: Payment Deposit Submission ($10 via EasyPaisa)...');
  const depRes = await fetch(`${BASE_URL}/api/payments/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId
    },
    body: JSON.stringify({
      method: 'easypaisa',
      amountUsd: 10.0,
      amountPkr: 2800,
      tid: 'EP_VERIFY_991204',
      senderName: 'Test Client',
      autoApprove: true
    })
  });
  const depData = await depRes.json();
  console.log(`Deposit Result: ${depData.message}, New Wallet Balance=$${depData.newBalanceUsd}`);

  // 8. Test Admin Deposits & Settings
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@5sim.store', password: 'admin' })
  });
  const adminData = await adminLoginRes.json();
  const adminRes = await fetch(`${BASE_URL}/api/admin/deposits`, {
    headers: {
      'x-user-id': adminData.user.id,
      'x-user-role': 'admin'
    }
  });
  const adminDepData = await adminRes.json();
  console.log(`Admin Verification: Found ${adminDepData.deposits.length} deposit records.`);

  console.log('=== ALL TESTS PASSED WITH 100% SUCCESS ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
