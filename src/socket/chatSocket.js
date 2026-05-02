const { pool } = require('../config/database');
const jwt = require('jsonwebtoken');

const setupSocket = (io) => {
  // Auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const [rows] = await pool.execute('SELECT id, full_name, role FROM users WHERE id = ?', [decoded.id]);
        if (rows.length) socket.user = rows[0];
      }
    } catch (_) {}
    next();
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id} | User: ${socket.user?.full_name || 'Visitor'}`);

    // Join conversation room
    socket.on('join_conversation', async ({ conversationId, sessionId }) => {
      socket.join(`conv_${conversationId}`);
      
      // If admin, join admin room
      if (socket.user?.role === 'admin') {
        socket.join('admin_room');
      }
      
      console.log(`📥 Joined conv_${conversationId}`);
    });

    // Send message
    socket.on('send_message', async ({ conversationId, content, senderName, senderRole }) => {
      try {
        if (!content?.trim()) return;

        const role = socket.user?.role || senderRole || 'visitor';
        const name = socket.user?.full_name || senderName || 'Visiteur';
        const senderId = socket.user?.id || null;

        const [result] = await pool.execute(
          'INSERT INTO messages (conversation_id, sender_id, sender_role, sender_name, content) VALUES (?,?,?,?,?)',
          [conversationId, senderId, role, name, content.trim()]
        );

        // Update conversation last_message_at
        await pool.execute('UPDATE conversations SET last_message_at = NOW() WHERE id = ?', [conversationId]);

        const message = {
          id: result.insertId,
          conversation_id: conversationId,
          sender_id: senderId,
          sender_role: role,
          sender_name: name,
          content: content.trim(),
          is_read: false,
          created_at: new Date().toISOString(),
        };

        // Broadcast to all in room
        io.to(`conv_${conversationId}`).emit('new_message', message);

        // Notify admin if message is from client/visitor
        if (role !== 'admin') {
          io.to('admin_room').emit('new_conversation_message', {
            conversationId,
            message,
            senderName: name,
          });
        }
      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('error', { message: 'Erreur envoi message' });
      }
    });

    // Typing indicator
    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conv_${conversationId}`).emit('user_typing', {
        userId: socket.user?.id,
        name: socket.user?.full_name || 'Visiteur',
        isTyping,
      });
    });

    // Admin joins all rooms
    socket.on('admin_join', () => {
      if (socket.user?.role === 'admin') {
        socket.join('admin_room');
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: ${socket.id}`);
    });
  });
};

module.exports = setupSocket;
