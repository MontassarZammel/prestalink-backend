const { pool } = require('../config/database');

// ── PUBLIC ────────────────────────────────────────────────────

exports.getByProvider = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_packages WHERE provider_id = ? AND is_active = 1 ORDER BY sort_order ASC, id ASC',
      [req.params.providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN ─────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM provider_packages WHERE provider_id = ? ORDER BY sort_order ASC, id ASC',
      [req.params.providerId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, price_per_person, min_persons, max_persons, includes, sort_order } = req.body;
    const { providerId } = req.params;
    const [result] = await pool.execute(
      'INSERT INTO provider_packages (provider_id, name, description, price_per_person, min_persons, max_persons, includes, sort_order) VALUES (?,?,?,?,?,?,?,?)',
      [providerId, name, description || null, price_per_person, min_persons || 1, max_persons || null, includes ? JSON.stringify(includes) : null, sort_order || 0]
    );
    const [rows] = await pool.execute('SELECT * FROM provider_packages WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, description, price_per_person, min_persons, max_persons, includes, is_active, sort_order } = req.body;
    await pool.execute(
      'UPDATE provider_packages SET name=?, description=?, price_per_person=?, min_persons=?, max_persons=?, includes=?, is_active=?, sort_order=? WHERE id=? AND provider_id=?',
      [name, description || null, price_per_person, min_persons || 1, max_persons || null, includes ? JSON.stringify(includes) : null, is_active ?? 1, sort_order || 0, req.params.id, req.params.providerId]
    );
    const [rows] = await pool.execute('SELECT * FROM provider_packages WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.delete = async (req, res) => {
  try {
    await pool.execute('DELETE FROM provider_packages WHERE id = ? AND provider_id = ?', [req.params.id, req.params.providerId]);
    res.json({ success: true, message: 'Pack supprimé' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
