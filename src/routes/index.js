// routes/index.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const providerTypeController = require('../controllers/providerTypeController');
const providerController = require('../controllers/providerController');
const quoteController = require('../controllers/quoteController');
const paymentController = require('../controllers/paymentController');
const chatController = require('../controllers/chatController');
const packageController = require('../controllers/packageController');
const availabilityController = require('../controllers/availabilityController');
const quoteRequestController = require('../controllers/quoteRequestController');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');
const { pool } = require('../config/database');

// ── AUTH ──────────────────────────────────────────────────────
router.post('/auth/login', authController.login);
router.post('/auth/register', authController.register);
router.post('/auth/google', authController.googleAuth);
router.get('/auth/me', authenticate, authController.me);
router.put('/auth/profile', authenticate, authController.updateProfile);

// ── PROVIDER TYPES ────────────────────────────────────────────
router.get('/provider-types', providerTypeController.getAll);
router.get('/provider-types/:slug', providerTypeController.getBySlug);
router.post('/provider-types', authenticate, requireAdmin, providerTypeController.create);
router.put('/provider-types/:id', authenticate, requireAdmin, providerTypeController.update);
router.delete('/provider-types/:id', authenticate, requireAdmin, providerTypeController.delete);
router.patch('/provider-types/:id/discount', authenticate, requireAdmin, providerTypeController.updateDiscount);

// ── PROVIDERS ─────────────────────────────────────────────────
router.get('/providers', providerController.getAll);
router.get('/providers/cities', providerController.getCities);
router.get('/providers/admin/all', authenticate, requireAdmin, providerController.getAllAdmin);
router.get('/providers/:slug', providerController.getBySlug);
router.post('/providers', authenticate, requireAdmin, providerController.create);
router.put('/providers/:id', authenticate, requireAdmin, providerController.update);
router.delete('/providers/:id', authenticate, requireAdmin, providerController.delete);
router.post('/providers/images', authenticate, requireAdmin, providerController.addImage);

// ── QUOTES ────────────────────────────────────────────────────
router.post('/quotes', optionalAuth, quoteController.createQuote);
router.get('/quotes/my', authenticate, quoteController.getMyQuotes);
router.get('/quotes/admin', authenticate, requireAdmin, quoteController.getAllQuotes);
router.get('/quotes/:id/pdf', quoteController.generatePDF);
router.get('/quotes/:id/summary', quoteController.getQuoteSummary);
router.patch('/quotes/:id/status', authenticate, requireAdmin, quoteController.updateStatus);

// ── PACKAGES ──────────────────────────────────────────────────
router.get('/providers/:providerId/packages', packageController.getByProvider);
router.get('/providers/:providerId/packages/admin', authenticate, requireAdmin, packageController.getAll);
router.post('/providers/:providerId/packages', authenticate, requireAdmin, packageController.create);
router.put('/providers/:providerId/packages/:id', authenticate, requireAdmin, packageController.update);
router.delete('/providers/:providerId/packages/:id', authenticate, requireAdmin, packageController.delete);

// ── AVAILABILITY ───────────────────────────────────────────────
router.get('/providers/:providerId/availability', availabilityController.getByProvider);
router.post('/providers/:providerId/availability', authenticate, requireAdmin, availabilityController.setDate);
router.post('/providers/:providerId/availability/bulk', authenticate, requireAdmin, availabilityController.setMultiple);

// ── QUOTE REQUESTS ─────────────────────────────────────────────
router.post('/quote-requests', optionalAuth, quoteRequestController.create);
router.get('/quote-requests/my', authenticate, quoteRequestController.getMy);
router.get('/quote-requests/admin', authenticate, requireAdmin, quoteRequestController.getAll);
router.patch('/quote-requests/:id/status', authenticate, requireAdmin, quoteRequestController.updateStatus);

// ── PAYMENTS ──────────────────────────────────────────────────
router.post('/payments/test/initiate', optionalAuth, paymentController.initiateTest);
router.post('/payments/konnect/initiate', optionalAuth, paymentController.initiateKonnect);
router.post('/payments/konnect/webhook', paymentController.konnectWebhook);
router.post('/payments/paymee/initiate', optionalAuth, paymentController.initiatePaymee);
router.post('/payments/paymee/webhook', paymentController.paymeeWebhook);
router.get('/payments/quote/:quote_id', authenticate, paymentController.getPaymentsByQuote);
router.get('/payments/return/success', (req, res) => res.redirect(`${process.env.FRONTEND_URL}/payment/success?${new URLSearchParams(req.query)}`));
router.get('/payments/return/failed',  (req, res) => res.redirect(`${process.env.FRONTEND_URL}/payment/failed?${new URLSearchParams(req.query)}`));

// ── CHAT ──────────────────────────────────────────────────────
router.post('/conversations', optionalAuth, chatController.createConversation);
router.get('/conversations', optionalAuth, chatController.getMyConversations);
router.get('/conversations/admin', authenticate, requireAdmin, chatController.getAllConversations);
router.get('/conversations/unread', authenticate, requireAdmin, chatController.getUnreadCount);
router.get('/conversations/client-unread', authenticate, chatController.getClientUnreadCount);
router.get('/conversations/:id/messages', optionalAuth, chatController.getMessages);
router.patch('/conversations/:id/status', authenticate, requireAdmin, chatController.updateConversationStatus);

// ── SETTINGS ──────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT setting_key, setting_value, setting_type FROM settings');
    const settings = {};
    rows.forEach(r => {
      settings[r.setting_key] = r.setting_type === 'number' ? Number(r.setting_value) : r.setting_value;
    });
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});
router.put('/settings', authenticate, requireAdmin, async (req, res) => {
  try {
    const { settings } = req.body;
    for (const [key, value] of Object.entries(settings)) {
      await pool.execute('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [String(value), key]);
    }
    res.json({ success: true, message: 'Paramètres mis à jour' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// ── DASHBOARD STATS ───────────────────────────────────────────
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
  try {
    const [[providers]] = await pool.execute('SELECT COUNT(*) as count FROM providers WHERE is_active = 1');
    const [[quotes]] = await pool.execute('SELECT COUNT(*) as count, SUM(price_after_discount) as total FROM quotes');
    const [[conversations]] = await pool.execute('SELECT COUNT(*) as count FROM conversations WHERE status = "open"');
    const [[unread]] = await pool.execute("SELECT COUNT(*) as count FROM messages WHERE is_read = 0 AND sender_role != 'admin'");
    const [recentQuotes] = await pool.execute(
      `SELECT q.*, p.name as provider_name FROM quotes q LEFT JOIN providers p ON q.provider_id = p.id ORDER BY q.created_at DESC LIMIT 5`
    );
    res.json({
      success: true,
      data: {
        providers: providers.count,
        quotes: quotes.count,
        revenue: quotes.total || 0,
        openConversations: conversations.count,
        unreadMessages: unread.count,
        recentQuotes,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;

// ── FRONTEND LOGS ─────────────────────────────────────────────
const fsLog = require('fs');
const pathLog = require('path');
const LOGS_DIR_FE = pathLog.join(__dirname, '..', '..', '..', 'logs');

router.post('/log', (req, res) => {
  const { type, path: urlPath, message, source, stack, url, ts, userAgent } = req.body;
  const logFile = type === 'error'
    ? pathLog.join(LOGS_DIR_FE, 'frontend-error.log')
    : pathLog.join(LOGS_DIR_FE, 'frontend-access.log');

  const line = type === 'error'
    ? `[${ts || new Date().toISOString()}] ERROR | ${url} | ${message} | src:${source} | ua:${(userAgent||'').slice(0,80)}\n  stack:${(stack||'').split('\n')[0]}`
    : `[${ts || new Date().toISOString()}] ACCESS | ${urlPath || url} | ref:${req.body.referrer || '-'} | ua:${(userAgent||'').slice(0,80)}`;

  fsLog.appendFile(logFile, line + '\n', () => {});
  res.json({ ok: true });
});
