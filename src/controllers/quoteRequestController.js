const { pool } = require('../config/database');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST,
  port: process.env.MAILTRAP_PORT,
  auth: { user: process.env.MAILTRAP_USER, pass: process.env.MAILTRAP_PASS },
});

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
