const { pool } = require('../config/database');

// ── PUBLIC: list approved reviews for a provider ──────────────
exports.getByProvider = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.full_name
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.provider_id = ? AND r.is_approved = 1
       ORDER BY r.created_at DESC`,
      [req.params.providerId]
    );
    const [agg] = await pool.execute(
      `SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM reviews WHERE provider_id = ? AND is_approved = 1`,
      [req.params.providerId]
    );
    res.json({ success: true, data: rows, avg: Number(agg[0].avg_rating || 0).toFixed(1), total: agg[0].total });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── AUTHENTICATED CLIENT: create review ───────────────────────
exports.create = async (req, res) => {
  try {
    const { rating, comment, quote_id } = req.body;
    const provider_id = req.params.providerId;
    const user_id = req.user.id;

    if (!rating || rating < 1 || rating > 5)
      return res.status(400).json({ success: false, message: 'Note invalide (1–5)' });

    // verify quote belongs to this user and this provider
    const [quotes] = await pool.execute(
      `SELECT id FROM quotes WHERE id = ? AND client_id = ? AND provider_id = ? AND status IN ('sent','accepted')`,
      [quote_id, user_id, provider_id]
    );
    if (!quotes.length)
      return res.status(403).json({ success: false, message: 'Devis introuvable ou non éligible' });

    // prevent duplicate review per quote
    const [existing] = await pool.execute(
      `SELECT id FROM reviews WHERE quote_id = ? AND user_id = ?`,
      [quote_id, user_id]
    );
    if (existing.length)
      return res.status(409).json({ success: false, message: 'Vous avez déjà laissé un avis pour ce devis' });

    const [result] = await pool.execute(
      `INSERT INTO reviews (provider_id, user_id, quote_id, rating, comment, is_approved) VALUES (?,?,?,?,?,1)`,
      [provider_id, user_id, quote_id, Number(rating), comment?.trim() || null]
    );
    res.status(201).json({ success: true, message: 'Avis publié avec succès', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN: list all reviews ────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT r.*, u.full_name, u.email, p.name as provider_name
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       LEFT JOIN providers p ON r.provider_id = p.id
       ORDER BY r.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN: approve / reject ────────────────────────────────────
exports.approve = async (req, res) => {
  try {
    const { is_approved } = req.body;
    await pool.execute(`UPDATE reviews SET is_approved = ? WHERE id = ?`, [is_approved ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.remove = async (req, res) => {
  try {
    await pool.execute(`DELETE FROM reviews WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
