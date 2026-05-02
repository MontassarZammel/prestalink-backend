const { pool } = require('../config/database');
const axios = require('axios');
const https = require('https');
const mailer = require('../services/mailer');

const sandboxAgent = new https.Agent({ rejectUnauthorized: false });

// ─── helpers ───────────────────────────────────────────────────────────────────
const markPaymentDone = async (paymentRef) => {
  await pool.execute(
    'UPDATE payments SET status = "completed", paid_at = NOW() WHERE payment_ref = ?',
    [paymentRef]
  );
  const [payments] = await pool.execute('SELECT * FROM payments WHERE payment_ref = ?', [paymentRef]);
  if (!payments.length) return;

  const p = payments[0];
  await pool.execute('UPDATE quotes SET payment_status = "partial" WHERE id = ?', [p.quote_id]);
  const [quotes] = await pool.execute('SELECT * FROM quotes WHERE id = ?', [p.quote_id]);
  if (quotes.length) mailer.sendPaymentConfirmation(quotes[0], p).catch(() => {});
};

// ===================== KONNECT =====================
exports.initiateKonnect = async (req, res) => {
  try {
    const { quote_id } = req.body;
    const [quotes] = await pool.execute(
      'SELECT * FROM quotes WHERE id = ? AND payment_enabled = 1',
      [quote_id]
    );
    if (!quotes.length)
      return res.status(404).json({ success: false, message: 'Devis non trouvé ou paiement non activé' });

    const quote  = quotes[0];
    const amount = Math.round(quote.advance_payment * 1000); // millimes

    const payload = {
      receiverWalletId: process.env.KONNECT_WALLET_ID,
      token: 'TND',
      amount,
      type: 'immediate',
      description: `Devis ${quote.quote_number} — MyWedding`,
      acceptedPaymentMethods: ['wallet', 'bank_card', 'e-DINAR'],
      lifespan: 10,
      checkoutForm: true,
      addPaymentFeesToAmount: false,
      firstName: quote.client_name.split(' ')[0],
      lastName: quote.client_name.split(' ').slice(1).join(' ') || '',
      email: quote.client_email,
      phoneNumber: quote.client_phone || '',
      orderId: quote.quote_number,
      webhook: `${process.env.BACKEND_URL}/api/payments/konnect/webhook`,
      silentWebhook: true,
      successUrl: `${process.env.FRONTEND_URL}/payment/success?quote=${quote_id}`,
      failUrl:    `${process.env.FRONTEND_URL}/payment/failed?quote=${quote_id}`,
      theme: 'dark',
    };

    const response = await axios.post(
      `${process.env.KONNECT_API_URL}/payments/init-payment`,
      payload,
      { headers: { 'x-api-key': process.env.KONNECT_API_KEY, 'Content-Type': 'application/json' } }
    );

    // ⚠️ Store KONNECT's paymentRef (not our UUID) so the webhook can match it
    const konnectRef = response.data.paymentRef;
    if (!konnectRef) throw new Error('Konnect did not return a paymentRef');

    await pool.execute(
      'INSERT INTO payments (quote_id, payment_ref, gateway, amount, status, payment_type) VALUES (?,?,?,?,?,?)',
      [quote_id, konnectRef, 'konnect', quote.advance_payment, 'pending', 'advance']
    );

    res.json({ success: true, data: { payUrl: response.data.payUrl, paymentRef: konnectRef } });
  } catch (error) {
    console.error('Konnect initiate error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Erreur initialisation paiement Konnect' });
  }
};

exports.konnectWebhook = async (req, res) => {
  try {
    const { payment_ref, status } = req.body;
    if (status === 'paid' && payment_ref) {
      await markPaymentDone(payment_ref);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Konnect webhook error:', error.message);
    res.status(500).json({ success: false });
  }
};

// ===================== PAYMEE =====================
exports.initiatePaymee = async (req, res) => {
  try {
    const { quote_id } = req.body;
    const [quotes] = await pool.execute(
      'SELECT * FROM quotes WHERE id = ? AND payment_enabled = 1',
      [quote_id]
    );
    if (!quotes.length)
      return res.status(404).json({ success: false, message: 'Devis non trouvé ou paiement non activé' });

    const quote = quotes[0];
    const payload = {
      vendor: process.env.PAYMEE_VENDOR_TOKEN,
      amount: quote.advance_payment,
      note: `Devis ${quote.quote_number} — MyWedding`,
      first_name: quote.client_name.split(' ')[0],
      last_name: quote.client_name.split(' ').slice(1).join(' ') || quote.client_name.split(' ')[0],
      email: quote.client_email,
      phone: quote.client_phone || '',
      return_url:  `${process.env.BACKEND_URL}/api/payments/return/success?quote=${quote_id}`,
      cancel_url:  `${process.env.BACKEND_URL}/api/payments/return/failed?quote=${quote_id}`,
      webhook_url: `${process.env.BACKEND_URL}/api/payments/paymee/webhook`,
      order_id: quote.quote_number,
    };

    const response = await axios.post(
      `${process.env.PAYMEE_API_URL}/payments/create`,
      payload,
      { headers: { Authorization: `Token ${process.env.PAYMEE_API_KEY}`, 'Content-Type': 'application/json' }, httpsAgent: sandboxAgent }
    );

    // ⚠️ Store Paymee's token as payment_ref so webhook can match it
    const paymeeToken = response.data.data?.token || response.data.token;
    if (!paymeeToken) throw new Error('Paymee did not return a token');

    const baseUrl = process.env.PAYMEE_API_URL.replace('/api/v2', '').replace('/api/v1', '');
    const payUrl  = response.data.data?.payment_url
                 || response.data.payment_url
                 || response.data.data?.paymentUrl
                 || `${baseUrl}/gateway/${paymeeToken}`;

    await pool.execute(
      'INSERT INTO payments (quote_id, payment_ref, gateway, amount, status, payment_type) VALUES (?,?,?,?,?,?)',
      [quote_id, paymeeToken, 'paymee', quote.advance_payment, 'pending', 'advance']
    );

    res.json({ success: true, data: { payUrl, paymentRef: paymeeToken } });
  } catch (error) {
    console.error('Paymee initiate error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: 'Erreur initialisation paiement Paymee' });
  }
};

exports.paymeeWebhook = async (req, res) => {
  try {
    // Paymee sends: { token, payment_status: true/false, order_id, ... }
    const { token, payment_status } = req.body;
    if ((payment_status === true || payment_status === 'true') && token) {
      await markPaymentDone(token);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Paymee webhook error:', error.message);
    res.status(500).json({ success: false });
  }
};

// ===================== TEST (dev only) =====================
exports.initiateTest = async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: 'Non disponible en production' });
  }
  try {
    const { quote_id } = req.body;
    const [quotes] = await pool.execute(
      'SELECT * FROM quotes WHERE id = ? AND payment_enabled = 1',
      [quote_id]
    );
    if (!quotes.length)
      return res.status(404).json({ success: false, message: 'Devis non trouvé ou paiement non activé' });

    const quote = quotes[0];
    const testRef = `TEST-${Date.now()}`;

    await pool.execute(
      'INSERT INTO payments (quote_id, payment_ref, gateway, amount, status, payment_type) VALUES (?,?,?,?,?,?)',
      [quote_id, testRef, 'konnect', quote.advance_payment, 'pending', 'advance']
    );

    await markPaymentDone(testRef);

    const successUrl = `${process.env.FRONTEND_URL}/payment/success?quote=${quote_id}`;
    res.json({ success: true, data: { payUrl: successUrl, paymentRef: testRef } });
  } catch (error) {
    console.error('Test payment error:', error.message);
    res.status(500).json({ success: false, message: 'Erreur paiement test' });
  }
};

// ===================== GET PAYMENTS =====================
exports.getPaymentsByQuote = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM payments WHERE quote_id = ? ORDER BY created_at DESC',
      [req.params.quote_id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
