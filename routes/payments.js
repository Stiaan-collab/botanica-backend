// ============================================================
// FILE: backend/routes/payments.js
// Stripe PaymentIntent + webhook + PayPal order creation
// ============================================================

const express = require('express');
const router  = express.Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getPool, sql } = require('../config/db');

// POST /api/payments/create-intent
// Creates a Stripe PaymentIntent — called from checkout page
router.post('/create-intent', async (req, res, next) => {
  try {
    const { amount, currency = 'zar', metadata = {} } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'Valid amount required' });

    const intent = await stripe.paymentIntents.create({
      amount:   Math.round(amount * 100),  // cents
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata,
    });

    res.json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (err) { next(err); }
});

// POST /api/payments/webhook
// Stripe sends events here — set endpoint in Stripe Dashboard
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).send('Webhook signature verification failed');
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    try {
      const pool = await getPool();
      await pool.request()
        .input('intent_id', sql.NVarChar, intent.id)
        .input('paid_at',   sql.DateTime2, new Date())
        .query(`UPDATE Orders SET status='paid', paid_at=@paid_at WHERE payment_intent=@intent_id AND status='pending'`);
      console.log(`✅ Order paid: ${intent.id}`);
    } catch (err) {
      console.error('Webhook DB update error:', err);
    }
  }

  res.json({ received: true });
});

// POST /api/payments/paypal/create-order
// Creates a PayPal order (client completes payment in PayPal JS SDK)
router.post('/paypal/create-order', async (req, res, next) => {
  try {
    const { amount, currency = 'ZAR' } = req.body;

    // Get PayPal access token
    const tokenRes = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json();

    // Create order
    const orderRes = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: currency, value: amount.toFixed(2) },
        }],
      }),
    });
    const orderData = await orderRes.json();
    res.json({ orderId: orderData.id });
  } catch (err) { next(err); }
});

module.exports = router;