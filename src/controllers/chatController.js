const { pool } = require('../config/database');

exports.createConversation = async (req, res) => {
  try {
    const { client_name, client_email, subject, visitor_session_id } = req.body;
    const clientId = req.user?.id || null;
    const name = clientId ? req.user.full_name : client_name;
    const email = clientId ? req.user.email : client_email;
    
    if (!name || !email) return res.status(400).json({ success: false, message: 'Nom et email requis' });

    const [result] = await pool.execute(
      'INSERT INTO conversations (client_id, visitor_session_id, client_name, client_email, subject) VALUES (?,?,?,?,?)',
      [clientId, visitor_session_id || null, name, email, subject || 'Nouvelle conversation']
    );
    const [conv] = await pool.execute('SELECT * FROM conversations WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: conv[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getMyConversations = async (req, res) => {
  try {
    let where, params;
    if (req.user) {
      where = 'c.client_id = ?';
      params = [req.user.id];
    } else {
      const { session_id } = req.query;
      where = 'c.visitor_session_id = ?';
      params = [session_id];
    }
    const [rows] = await pool.execute(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_read = 0 AND m.sender_role != 'admin') as unread_count
       FROM conversations c WHERE ${where} ORDER BY c.last_message_at DESC`, params
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getAllConversations = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    let where = ['1=1'];
    let params = [];
    if (status) { where.push('c.status = ?'); params.push(status); }
    const limitInt  = parseInt(limit, 10)  || 20;
    const offsetInt = (parseInt(page, 10) - 1) * limitInt;
    const [countRows] = await pool.execute(`SELECT COUNT(*) as total FROM conversations c WHERE ${where.join(' AND ')}`, params);
    const [rows] = await pool.execute(
      `SELECT c.*,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_read = 0 AND m.sender_role != 'admin') as unread_count,
       (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message
       FROM conversations c WHERE ${where.join(' AND ')} ORDER BY c.last_message_at DESC LIMIT ${limitInt} OFFSET ${offsetInt}`, params
    );
    res.json({ success: true, data: rows, pagination: { total: countRows[0].total, page: parseInt(page, 10), limit: limitInt } });
  } catch (error) {
    console.error('getAllConversations error:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const [messages] = await pool.execute(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [id]
    );
    // Mark as read
    const readerRole = req.user?.role === 'admin' ? 'client' : 'admin';
    await pool.execute(
      `UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_role != ?`,
      [id, req.user?.role || 'admin']
    );
    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.updateConversationStatus = async (req, res) => {
  try {
    await pool.execute('UPDATE conversations SET status = ? WHERE id = ?', [req.body.status, req.params.id]);
    res.json({ success: true, message: 'Statut mis à jour' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.is_read = 0 AND m.sender_role != 'admin'`
    );
    res.json({ success: true, count: rows[0].count });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

exports.getClientUnreadCount = async (req, res) => {
  try {
    const clientId = req.user.id;
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE c.client_id = ? AND m.is_read = 0 AND m.sender_role = 'admin'`,
      [clientId]
    );
    res.json({ success: true, count: rows[0].count });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
