/**
 * ==========================================================================
 * BOOKBRIDGE CHAT CONTROLLER
 * Real-Time User-to-User Persistent Messaging & Conversation Engine
 * ==========================================================================
 */

const { Op } = require('sequelize');
const { Conversation, Message, User, Book, Notification, AuditLog } = require('../models');

/**
 * GET /api/conversations
 * Returns all conversations the authenticated user is participating in
 */
exports.getConversations = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;

    const conversations = await Conversation.findAll({
      where: {
        [Op.or]: [{ user1Id: currentUserId }, { user2Id: currentUserId }]
      },
      include: [
        { model: User, as: 'user1', attributes: ['id', 'name', 'email', 'avatarUrl', 'role'] },
        { model: User, as: 'user2', attributes: ['id', 'name', 'email', 'avatarUrl', 'role'] },
        { model: Book, as: 'book', attributes: ['id', 'title', 'price', 'mode', 'coverUrl', 'status'] }
      ],
      order: [['lastMessageAt', 'DESC']]
    });

    // Format conversations with other participant details & unread count
    const formatted = await Promise.all(
      conversations.map(async (conv) => {
        const isUser1 = conv.user1Id === currentUserId;
        const otherUser = isUser1 ? conv.user2 : conv.user1;

        const unreadCount = await Message.count({
          where: {
            conversationId: conv.id,
            senderId: { [Op.ne]: currentUserId },
            isRead: false
          }
        });

        return {
          id: conv.id,
          bookId: conv.bookId,
          book: conv.book,
          otherUser,
          // Booleans only - the phone number itself is never included here
          iApprovedWhatsapp: Boolean(isUser1 ? conv.user1ApprovedWhatsapp : conv.user2ApprovedWhatsapp),
          partnerApprovedWhatsapp: Boolean(isUser1 ? conv.user2ApprovedWhatsapp : conv.user1ApprovedWhatsapp),
          lastMessageText: conv.lastMessageText,
          lastMessageAt: conv.lastMessageAt,
          unreadCount
        };
      })
    );

    return res.json(formatted);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/conversations
 * Get or create a conversation between current user and a book seller / recipient
 */
exports.getOrCreateConversation = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const { recipientId, recipientEmail, bookId } = req.body;

    let targetUserId = recipientId;

    if (!targetUserId && recipientEmail && typeof recipientEmail === 'string') {
      const targetUser = await User.findOne({ where: { email: recipientEmail.trim().toLowerCase() } });
      if (targetUser) targetUserId = targetUser.id;
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'Recipient user ID or email is required.' });
    }

    targetUserId = parseInt(targetUserId, 10);
    if (isNaN(targetUserId)) {
      return res.status(400).json({ error: 'Recipient user ID or email is required.' });
    }

    if (targetUserId === currentUserId) {
      return res.status(400).json({ error: 'You cannot start a conversation with yourself.' });
    }

    const targetExists = await User.findByPk(targetUserId, { attributes: ['id'] });
    if (!targetExists) {
      return res.status(404).json({ error: 'Recipient user account not found.' });
    }

    // Check if conversation already exists between these 2 users (optionally for this book)
    let whereClause = {
      [Op.or]: [
        { user1Id: currentUserId, user2Id: targetUserId },
        { user1Id: targetUserId, user2Id: currentUserId }
      ]
    };

    if (bookId) {
      whereClause.bookId = bookId;
    }

    let conversation = await Conversation.findOne({
      where: whereClause,
      include: [
        { model: User, as: 'user1', attributes: ['id', 'name', 'email', 'avatarUrl', 'role'] },
        { model: User, as: 'user2', attributes: ['id', 'name', 'email', 'avatarUrl', 'role'] },
        { model: Book, as: 'book', attributes: ['id', 'title', 'price', 'mode', 'coverUrl'] }
      ]
    });

    if (!conversation) {
      let bookTitle = '';
      if (bookId) {
        const book = await Book.findByPk(bookId);
        if (book) bookTitle = book.title;
      }

      conversation = await Conversation.create({
        user1Id: currentUserId,
        user2Id: targetUserId,
        bookId: bookId || null,
        bookTitle,
        lastMessageText: '',
        lastMessageAt: new Date()
      });

      conversation = await Conversation.findByPk(conversation.id, {
        include: [
          { model: User, as: 'user1', attributes: ['id', 'name', 'email', 'avatarUrl', 'role'] },
          { model: User, as: 'user2', attributes: ['id', 'name', 'email', 'avatarUrl', 'role'] },
          { model: Book, as: 'book', attributes: ['id', 'title', 'price', 'mode', 'coverUrl'] }
        ]
      });
    }

    return res.status(200).json(conversation);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/conversations/:id/messages
 * Returns message history for a conversation
 */
exports.getMessages = async (req, res, next) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;

    const conversation = await Conversation.findByPk(id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    // Security: Only participants can read messages
    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. You are not a participant in this conversation.' });
    }

    // Newest 100 messages (so long chats still show recent ones), returned oldest -> newest
    const messages = (await Message.findAll({
      where: { conversationId: id },
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: 100
    })).reverse();

    // Mark messages sent to current user as read
    await Message.update(
      { isRead: true },
      {
        where: {
          conversationId: id,
          senderId: { [Op.ne]: currentUserId },
          isRead: false
        }
      }
    );

    return res.json(messages);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/conversations/:id/messages
 * Sends a message, saves to MySQL, and emits Socket.IO event
 */
exports.sendMessage = async (req, res, next, io) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user.id;
    const { text } = req.body;

    const conversation = await Conversation.findByPk(id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    // Security: verify sender is a participant
    if (conversation.user1Id !== currentUserId && conversation.user2Id !== currentUserId) {
      return res.status(403).json({ error: 'Access denied. You cannot post in this conversation.' });
    }

    const recipientId = conversation.user1Id === currentUserId ? conversation.user2Id : conversation.user1Id;

    // 1. Persist message in MySQL
    const message = await Message.create({
      conversationId: conversation.id,
      senderId: currentUserId,
      senderName: req.user.name,
      senderEmail: req.user.email,
      text: text.trim(),
      isRead: false
    });

    // 2. Update conversation summary
    conversation.lastMessageText = text.trim();
    conversation.lastMessageAt = new Date();
    await conversation.save();

    // 3. Create persistent notification for recipient
    try {
      await Notification.create({
        userId: recipientId,
        title: `New message from ${req.user.name}`,
        message: text.trim().length > 60 ? `${text.trim().substring(0, 57)}...` : text.trim(),
        type: 'message',
        link: `/dashboard.html#messages`
      });
    } catch (e) {}

    // 4. Real-time Socket.IO emission
    if (io) {
      const room = `conversation_${conversation.id}`;
      io.to(room).emit('newMessage', message);
      io.to(`user_${recipientId}`).emit('chatNotification', {
        conversationId: conversation.id,
        senderName: req.user.name,
        text: text.trim(),
        message
      });
    }

    return res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy API support: GET /api/messages
 */
exports.getLegacyMessages = async (req, res, next) => {
  try {
    const currentUserId = req.user.id;
    const withEmail = req.query.with;

    let whereClause = {};

    if (withEmail) {
      const partner = await User.findOne({ where: { email: withEmail.trim().toLowerCase() } });
      if (!partner) return res.json([]);

      const conversation = await Conversation.findOne({
        where: {
          [Op.or]: [
            { user1Id: currentUserId, user2Id: partner.id },
            { user1Id: partner.id, user2Id: currentUserId }
          ]
        }
      });

      if (!conversation) return res.json([]);
      whereClause.conversationId = conversation.id;
    } else {
      // Find all conversations of current user
      const convs = await Conversation.findAll({
        where: {
          [Op.or]: [{ user1Id: currentUserId }, { user2Id: currentUserId }]
        },
        attributes: ['id']
      });
      const convIds = convs.map(c => c.id);
      whereClause.conversationId = { [Op.in]: convIds };
    }

    const messages = (await Message.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: 100
    })).reverse();

    return res.json(messages);
  } catch (error) {
    next(error);
  }
};

/**
 * Legacy API support: POST /api/messages
 */
exports.sendLegacyMessage = async (req, res, next, io) => {
  try {
    const currentUserId = req.user.id;
    const { receiverEmail, receiver_email, text, bookTitle, book_title, bookId } = req.body;
    const targetEmail = String(receiverEmail || receiver_email || '').trim().toLowerCase();
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty.' });
    }

    if (!targetEmail) {
      return res.status(400).json({ error: 'Receiver email is required.' });
    }

    if (targetEmail === req.user.email.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot send message to yourself.' });
    }

    const recipient = await User.findOne({ where: { email: targetEmail } });
    if (!recipient) {
      return res.status(404).json({ error: 'Recipient user account not found.' });
    }

    // Find or create conversation
    let conversation = await Conversation.findOne({
      where: {
        [Op.or]: [
          { user1Id: currentUserId, user2Id: recipient.id },
          { user1Id: recipient.id, user2Id: currentUserId }
        ]
      }
    });

    if (!conversation) {
      conversation = await Conversation.create({
        user1Id: currentUserId,
        user2Id: recipient.id,
        bookId: bookId || null,
        bookTitle: bookTitle || book_title || '',
        lastMessageText: text.trim(),
        lastMessageAt: new Date()
      });
    } else {
      conversation.lastMessageText = text.trim();
      conversation.lastMessageAt = new Date();
      await conversation.save();
    }

    const message = await Message.create({
      conversationId: conversation.id,
      senderId: currentUserId,
      senderName: req.user.name,
      senderEmail: req.user.email,
      text: text.trim(),
      isRead: false
    });

    if (io) {
      io.to(`conversation_${conversation.id}`).emit('newMessage', message);
      io.to(`user_${recipient.id}`).emit('chatNotification', {
        conversationId: conversation.id,
        senderName: req.user.name,
        text: text.trim(),
        message
      });
    }

    return res.status(201).json({
      ...message.get({ plain: true }),
      sender_email: req.user.email,
      sender_name: req.user.name,
      receiver_email: recipient.email,
      receiver_name: recipient.name
    });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/conversations/:id/whatsapp
 * Privacy-safe WhatsApp phone number retrieval:
 * - Requester must be a participant
 * - Other participant must have approved WhatsApp sharing for this conversation
 * - Other participant must not have set whatsappPrivacy to 'hide'
 * - Logged in AuditLog
 */
exports.getConversationWhatsApp = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const currentUserId = req.user.id;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.', status: 404 });
    }

    const isUser1 = conversation.user1Id === currentUserId;
    const isUser2 = conversation.user2Id === currentUserId;
    if (!isUser1 && !isUser2) {
      return res.status(403).json({
        error: 'Access denied. You are not a participant in this conversation.',
        status: 403
      });
    }

    const otherUserId = isUser1 ? conversation.user2Id : conversation.user1Id;
    const isApproved = isUser1 ? conversation.user2ApprovedWhatsapp : conversation.user1ApprovedWhatsapp;

    if (!isApproved) {
      return res.status(403).json({
        error: 'WhatsApp sharing has not been approved by this user for this conversation.',
        status: 403
      });
    }

    const otherUser = await User.findByPk(otherUserId);
    if (!otherUser) {
      return res.status(404).json({ error: 'User not found.', status: 404 });
    }

    if (otherUser.whatsappPrivacy === 'hide') {
      return res.status(403).json({
        error: 'This user has configured their WhatsApp number to remain hidden.',
        status: 403
      });
    }

    if (!otherUser.whatsapp || otherUser.whatsapp.trim() === '') {
      return res.status(404).json({
        error: 'This user has not linked a WhatsApp number.',
        status: 404
      });
    }

    // Log access in AuditLog
    if (AuditLog) {
      try {
        await AuditLog.create({
          userId: currentUserId,
          action: 'WHATSAPP_REQUEST',
          ipAddress: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          details: `User ${currentUserId} accessed WhatsApp for conversation ${conversationId} (partner user: ${otherUserId})`
        });
      } catch (err) {
        console.warn('[AuditLog] Failed to log WhatsApp retrieval:', err.message);
      }
    }

    return res.json({
      whatsapp: otherUser.whatsapp,
      whatsappNumber: otherUser.whatsapp,
      name: otherUser.name
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/conversations/:id/whatsapp/approve
 * or POST /api/conversations/:id/share-whatsapp
 * Participant grants consent to share their WhatsApp number in this conversation
 */
exports.approveConversationWhatsApp = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const currentUserId = req.user.id;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.', status: 404 });
    }

    const isUser1 = conversation.user1Id === currentUserId;
    const isUser2 = conversation.user2Id === currentUserId;
    if (!isUser1 && !isUser2) {
      return res.status(403).json({
        error: 'Access denied. You are not a participant in this conversation.',
        status: 403
      });
    }

    if (isUser1) {
      conversation.user1ApprovedWhatsapp = true;
    } else {
      conversation.user2ApprovedWhatsapp = true;
    }

    await conversation.save();

    if (AuditLog) {
      try {
        await AuditLog.create({
          userId: currentUserId,
          action: 'WHATSAPP_APPROVE',
          ipAddress: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          details: `User ${currentUserId} approved WhatsApp sharing for conversation ${conversationId}`
        });
      } catch (e) {}
    }

    return res.json({
      success: true,
      message: 'WhatsApp sharing approved for this conversation.',
      conversationId: conversation.id,
      approved: true
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/conversations/:id/report
 */
exports.reportUser = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const currentUserId = req.user.id;
    const { reason, details } = req.body;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.', status: 404 });
    }

    const isUser1 = conversation.user1Id === currentUserId;
    const isUser2 = conversation.user2Id === currentUserId;
    if (!isUser1 && !isUser2) {
      return res.status(403).json({ error: 'Access denied. You are not a participant in this conversation.', status: 403 });
    }

    const reportedUserId = isUser1 ? conversation.user2Id : conversation.user1Id;

    if (AuditLog) {
      try {
        await AuditLog.create({
          userId: currentUserId,
          action: 'USER_REPORTED',
          ipAddress: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          details: `User ${currentUserId} reported User ${reportedUserId} in conversation ${conversationId}. Reason: ${reason || 'Violation'} - ${details || ''}`
        });
      } catch (e) {}
    }

    return res.json({
      success: true,
      message: 'Thank you for your report. Our campus trust and safety team will review this report.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/conversations/:id/block
 */
exports.blockUser = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const currentUserId = req.user.id;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found.', status: 404 });
    }

    const isUser1 = conversation.user1Id === currentUserId;
    const isUser2 = conversation.user2Id === currentUserId;
    if (!isUser1 && !isUser2) {
      return res.status(403).json({ error: 'Access denied. You are not a participant in this conversation.', status: 403 });
    }

    const blockedUserId = isUser1 ? conversation.user2Id : conversation.user1Id;

    if (AuditLog) {
      try {
        await AuditLog.create({
          userId: currentUserId,
          action: 'USER_BLOCKED',
          ipAddress: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
          details: `User ${currentUserId} blocked User ${blockedUserId} in conversation ${conversationId}`
        });
      } catch (e) {}
    }

    return res.json({
      success: true,
      message: 'User has been blocked.'
    });
  } catch (error) {
    next(error);
  }
};


/**
 * GET /api/notifications
 * Latest notifications for the authenticated user (created when messages arrive)
 */
exports.getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    return res.json(notifications);
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/notifications/read
 * Marks all of the user's notifications as read
 */
exports.markNotificationsRead = async (req, res, next) => {
  try {
    await Notification.update({ isRead: true }, { where: { userId: req.user.id, isRead: false } });
    return res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
