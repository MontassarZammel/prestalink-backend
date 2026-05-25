const { pool } = require('../config/database');

exports.get = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM event_briefs WHERE quote_id = ?', [req.params.id]);
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.save = async (req, res) => {
  try {
    const quoteId = req.params.id;
    const { prohibited_items, not_to_bring, juice_rounds, tea_rounds, alcohol_included, savory_rounds, comments } = req.body;

    await pool.execute(
      `INSERT INTO event_briefs (quote_id, prohibited_items, not_to_bring, juice_rounds, tea_rounds, alcohol_included, savory_rounds, comments)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE prohibited_items=?, not_to_bring=?, juice_rounds=?, tea_rounds=?, alcohol_included=?, savory_rounds=?, comments=?`,
      [quoteId, prohibited_items||null, not_to_bring||null, juice_rounds||0, tea_rounds||0, alcohol_included||0, savory_rounds||0, comments||null,
       prohibited_items||null, not_to_bring||null, juice_rounds||0, tea_rounds||0, alcohol_included||0, savory_rounds||0, comments||null]
    );
    const [rows] = await pool.execute('SELECT * FROM event_briefs WHERE quote_id = ?', [quoteId]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
