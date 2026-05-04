const { pool } = require('../config/database');
const nodemailer = require('nodemailer');
const mailer = require('../services/mailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST,
  port: process.env.MAILTRAP_PORT,
  auth: { user: process.env.MAILTRAP_USER, pass: process.env.MAILTRAP_PASS },
});

const generateQuoteNumber = () => {
  const d = new Date();
  return `PL-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}-${Math.floor(Math.random()*9000)+1000}`;
};

// ── CLIENT — soumettre une demande ────────────────────────────

exports.create = async (req, res) => {
  try {
    const { provider_id, package_id, client_name, client_email, client_phone, event_date, guest_count, notes } = req.body;
    const user_id = req.user?.id || null;

    // Vérifier disponibilité
    const [taken] = await pool.execute(
      "SELECT id FROM provider_availability WHERE provider_id = ? AND date = ? AND status != 'available'",
      [provider_id, event_date]
    );
    if (taken.length) {
      return res.status(409).json({ success: false, message: 'Cette date n\'est pas disponible' });
    }

    const [result] = await pool.execute(
      'INSERT INTO quote_requests (provider_id, package_id, user_id, client_name, client_email, client_phone, event_date, guest_count, notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [provider_id, package_id || null, user_id, client_name, client_email, client_phone || null, event_date, guest_count, notes || null]
    );

    // Notifier l'admin
    try {
      const [providers] = await pool.execute('SELECT name FROM providers WHERE id = ?', [provider_id]);
      await transporter.sendMail({
        from: '"PrestaLink" <no-reply@prestalink.tn>',
        to: process.env.ADMIN_EMAIL,
        subject: `Nouvelle demande de devis — ${providers[0]?.name}`,
        html: `
          <h2>Nouvelle demande de devis</h2>
          <p><strong>Client :</strong> ${client_name} (${client_email})</p>
          <p><strong>Prestataire :</strong> ${providers[0]?.name}</p>
          <p><strong>Date événement :</strong> ${event_date}</p>
          <p><strong>Nombre de personnes :</strong> ${guest_count}</p>
          ${notes ? `<p><strong>Notes :</strong> ${notes}</p>` : ''}
        `,
      });
    } catch (_) {}

    res.status(201).json({ success: true, message: 'Demande envoyée avec succès', data: { id: result.insertId } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── CLIENT — mes demandes ─────────────────────────────────────

exports.getMy = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.slug as provider_slug,
              pp.name as package_name, pp.price_per_person
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       WHERE qr.client_email = ? OR qr.user_id = ?
       ORDER BY qr.created_at DESC`,
      [req.user.email, req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — toutes les demandes ───────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.slug as provider_slug,
              pp.name as package_name, pp.price_per_person
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       ORDER BY qr.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status, quote_id } = req.body;
    await pool.execute(
      'UPDATE quote_requests SET status = ?, quote_id = ? WHERE id = ?',
      [status, quote_id || null, req.params.id]
    );
    res.json({ success: true, message: 'Statut mis à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — générer le devis depuis une demande ───────────────

exports.generateQuote = async (req, res) => {
  try {
    const { base_price, discount_percentage, advance_percentage, notes, valid_until_days } = req.body;
    const requestId = req.params.id;

    // Load request
    const [requests] = await pool.execute(
      `SELECT qr.*, p.name as provider_name, p.rating, pt.discount_percentage as type_discount,
              pp.name as package_name, pp.includes as package_includes, pp.price_per_person
       FROM quote_requests qr
       LEFT JOIN providers p ON qr.provider_id = p.id
       LEFT JOIN provider_types pt ON p.type_id = pt.id
       LEFT JOIN provider_packages pp ON qr.package_id = pp.id
       WHERE qr.id = ?`,
      [requestId]
    );
    if (!requests.length) return res.status(404).json({ success: false, message: 'Demande introuvable' });
    const req_ = requests[0];

    if (req_.status === 'cancelled') return res.status(400).json({ success: false, message: 'Demande annulée' });

    // Financial calc
    const priceBase   = Number(base_price);
    const discountPct = Number(discount_percentage ?? req_.type_discount ?? 0);
    const discountAmt = (priceBase * discountPct) / 100;
    const priceAfter  = priceBase - discountAmt;
    const advPct      = Number(advance_percentage ?? 30);
    const advPayment  = (priceAfter * advPct) / 100;

    const quoteNumber = generateQuoteNumber();
    const validUntil  = new Date();
    validUntil.setDate(validUntil.getDate() + (valid_until_days || 30));

    // Build description from pack info
    let description = `Prestation traiteur pour ${req_.guest_count} personnes`;
    if (req_.package_name) description += ` — ${req_.package_name}`;

    // Create quote
    const [result] = await pool.execute(
      `INSERT INTO quotes (quote_number, client_id, provider_id, client_name, client_email, client_phone,
       description, event_date, guest_count, price_before_discount, discount_percentage, discount_amount,
       price_after_discount, advance_payment, advance_percentage, valid_until, notes, status, request_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`,
      [quoteNumber, req_.user_id || null, req_.provider_id, req_.client_name, req_.client_email,
       req_.client_phone || null, description, req_.event_date, req_.guest_count,
       priceBase, discountPct, discountAmt, priceAfter, advPayment, advPct,
       validUntil.toISOString().split('T')[0], notes || null, requestId]
    );

    const quoteId = result.insertId;

    // Update request status
    await pool.execute(
      'UPDATE quote_requests SET status = "quoted", quote_id = ? WHERE id = ?',
      [quoteId, requestId]
    );

    // Load full quote + provider for email
    const [quotes] = await pool.execute('SELECT * FROM quotes WHERE id = ?', [quoteId]);
    const [providers] = await pool.execute(
      'SELECT p.*, pt.discount_percentage FROM providers p LEFT JOIN provider_types pt ON p.type_id = pt.id WHERE p.id = ?',
      [req_.provider_id]
    );

    const quote    = quotes[0];
    const provider = providers[0];

    // Send email to client (non-blocking)
    const pdfUrl = `${process.env.BACKEND_URL}/api/quotes/${quoteId}/pdf`;
    transporter.sendMail({
      from: '"PrestaLink" <no-reply@prestalink.tn>',
      to: req_.client_email,
      subject: `Votre devis PrestaLink — ${provider.name}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#C48C8C">Votre devis est prêt !</h2>
          <p>Bonjour <strong>${req_.client_name}</strong>,</p>
          <p>Suite à votre demande, votre devis personnalisé pour <strong>${provider.name}</strong> est disponible.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0">
            <tr><td style="padding:8px;color:#666">Numéro de devis</td><td style="padding:8px;font-weight:bold">${quoteNumber}</td></tr>
            <tr><td style="padding:8px;color:#666">Pack</td><td style="padding:8px">${req_.package_name || '—'}</td></tr>
            <tr><td style="padding:8px;color:#666">Date de l'événement</td><td style="padding:8px">${new Date(req_.event_date).toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</td></tr>
            <tr><td style="padding:8px;color:#666">Nombre de personnes</td><td style="padding:8px">${req_.guest_count}</td></tr>
            <tr style="border-top:2px solid #eee"><td style="padding:8px;color:#666">Montant total</td><td style="padding:8px;font-weight:bold;font-size:1.1em">${Math.round(priceAfter).toLocaleString('fr-TN')} TND</td></tr>
            <tr><td style="padding:8px;color:#666">Acompte (${advPct}%)</td><td style="padding:8px;color:#C48C8C;font-weight:bold">${Math.round(advPayment).toLocaleString('fr-TN')} TND</td></tr>
          </table>
          <a href="${pdfUrl}" style="display:inline-block;background:#C48C8C;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">
            Télécharger mon devis PDF
          </a>
          <p style="margin-top:24px;color:#999;font-size:0.9em">Ce devis est valable jusqu'au ${validUntil.toLocaleDateString('fr-FR')}.</p>
        </div>
      `,
    }).catch(() => {});

    res.json({ success: true, data: { quote_id: quoteId, quote_number: quoteNumber, pdf_url: pdfUrl } });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
