const { pool } = require('../config/database');

// ── PUBLIC — dates non disponibles d'un prestataire ──────────

exports.getByProvider = async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = 'SELECT date, status FROM provider_availability WHERE provider_id = ?';
    const params = [req.params.providerId];
    if (month && year) {
      query += ' AND MONTH(date) = ? AND YEAR(date) = ?';
      params.push(month, year);
    }
    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ── ADMIN — gérer les dates ───────────────────────────────────

exports.setDate = async (req, res) => {
  try {
    const { date, status, note } = req.body;
    const { providerId } = req.params;
    if (status === 'available') {
      await pool.execute('DELETE FROM provider_availability WHERE provider_id = ? AND date = ?', [providerId, date]);
    } else {
      await pool.execute(
        'INSERT INTO provider_availability (provider_id, date, status, note) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status=?, note=?',
        [providerId, date, status, note || null, status, note || null]
      );
    }
    res.json({ success: true, message: 'Disponibilité mise à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.setMultiple = async (req, res) => {
  try {
    const { dates, status, note } = req.body;
    const { providerId } = req.params;
    for (const date of dates) {
      if (status === 'available') {
        await pool.execute('DELETE FROM provider_availability WHERE provider_id = ? AND date = ?', [providerId, date]);
      } else {
        await pool.execute(
          'INSERT INTO provider_availability (provider_id, date, status, note) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE status=?, note=?',
          [providerId, date, status, note || null, status, note || null]
        );
      }
    }
    res.json({ success: true, message: 'Disponibilités mises à jour' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
