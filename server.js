/**
 * ==========================================================================
 * BOOKBRIDGE AUTHORITATIVE PRODUCTION SERVER ENGINE
 * Node.js + Express + Socket.IO + MySQL (Sequelize) & Real-Time Chat
 * ==========================================================================
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// Database & Models
const { connectDB, sequelize, getSQLStatus, getDialect } = require('./config/db');
const { syncDatabase } = require('./models');
const { seedDatabase } = require('./config/seed');

// Security & Middleware
const { configureSecurity } = require('./middleware/security');
const { authenticateToken, optionalAuth, authorizeRoles } = require('./middleware/authMiddleware');
const {
  validateBookInput,
  validateBookUpdate,
  validateProfileUpdate,
  validateRegisterInput,
  validateLoginInput,
  validateForgotPasswordInput,
  validateResetPasswordInput,
  validateMessageInput
} = require('./middleware/validate');

// Controllers
const authController = require('./controllers/authController');
const bookController = require('./controllers/bookController');
const chatController = require('./controllers/chatController');
const adminController = require('./controllers/adminController');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';
const { JWT_SECRET } = require('./config/secret');

// 1. Initialize Core Middleware & Security
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' })); // 5MB image becomes ~6.7MB as base64
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
configureSecurity(app);

// 2. Initialize Socket.IO with Token Authentication
let io = null;
try {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  // Socket.IO Handshake Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      // Allow anonymous connection for public broadcasts (e.g. live statistics, new books),
      // but mark socket as unauthenticated
      socket.user = null;
      return next();
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        socket.user = null;
      } else {
        socket.user = decoded;
        socket.join(`user_${decoded.id}`);
      }
      next();
    });
  });

  io.on('connection', (socket) => {
    const userLabel = socket.user ? `${socket.user.name} (ID: ${socket.user.id})` : 'Anonymous';
    console.log(`[Socket.IO Client Connected] ${userLabel} - Socket ID: ${socket.id}`);

    // Join conversation room with participant verification
    socket.on('joinConversation', async (conversationId) => {
      if (!conversationId || !socket.user) return;
      try {
        const { Conversation } = require('./models');
        const conv = Conversation ? await Conversation.findByPk(conversationId) : null;
        if (!conv) return;
        const uid = socket.user.id;
        if (conv.user1Id !== uid && conv.user2Id !== uid && socket.user.role !== 'admin') return;
        socket.join(`conversation_${conversationId}`);
      } catch (e) {
        console.warn('[Socket.IO] joinConversation check failed:', e.message);
      }
    });

    socket.on('leaveConversation', (conversationId) => {
      if (conversationId) {
        socket.leave(`conversation_${conversationId}`);
      }
    });

    // Real-time typing indicators
    socket.on('typing', ({ conversationId, isTyping }) => {
      const room = `conversation_${conversationId}`;
      if (conversationId && socket.user) {
        if (!socket.rooms.has(room)) {
          socket.join(room);
        }
        socket.to(room).emit('userTyping', {
          conversationId,
          userId: socket.user.id,
          userName: socket.user.name,
          isTyping: Boolean(isTyping)
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.IO Client Disconnected] ID: ${socket.id}`);
    });
  });
} catch (err) {
  console.warn('[Socket.IO] Initialization warning:', err.message);
}

// 3. Static File Serving Helper
const serveStaticFile = (res, filename) => {
  const candidates = [
    path.resolve(process.cwd(), filename),
    path.resolve(__dirname, filename),
    path.resolve(process.cwd(), 'dist', filename)
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.sendFile(filePath);
    }
  }

  res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>404 Not Found - BookBridgee</title></head><body><h2>Page not found</h2><p><a href="/browse.html">Go to Browse Books</a></p></body></html>`);
};

// 4. Serve Static Assets (CSS, JS, Images, Icons)
// Never serve backend source, secrets, databases or dot-files from the project root
const BLOCKED_STATIC = /^\/(\.|config\/|controllers\/|middleware\/|models\/|backend\/|data\/|tests\/|node_modules\/|\.git|\.env|server\.js|asgi\.py|wsgi\.py|manage\.py|tests\.py|package(-lock)?\.json|requirements\.txt|Dockerfile|docker-compose\.yml|pm2\.config\.js|server\.ps1|run-server\.bat)|\.(sqlite3?|sqlite-journal|py|sql|env|ps1|bat)$/i;
app.use((req, res, next) => {
  let p = req.path;
  try { p = decodeURIComponent(p); } catch (e) { return res.status(400).end(); }
  if (BLOCKED_STATIC.test(p) || p.includes('..')) {
    return res.status(404).send('Not found');
  }
  next();
});
app.use(express.static(process.cwd(), {
  dotfiles: 'deny',
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  etag: true
}));

// 5. HTML Frontend Page Routes
app.get(['/', '/index', '/index.html'], (req, res) => serveStaticFile(res, 'index.html'));
app.get(['/browse', '/browse.html', '/browse-books', '/browse-books.html'], (req, res) => serveStaticFile(res, 'browse.html'));
app.get(['/exchange', '/exchange.html'], (req, res) => serveStaticFile(res, 'exchange.html'));
app.get(['/donate', '/donate.html'], (req, res) => serveStaticFile(res, 'donate.html'));
app.get(['/sell', '/sell.html'], (req, res) => serveStaticFile(res, 'sell.html'));
app.get(['/about', '/about.html'], (req, res) => serveStaticFile(res, 'about.html'));
app.get(['/contact', '/contact.html'], (req, res) => serveStaticFile(res, 'contact.html'));
app.get(['/login', '/login.html'], (req, res) => serveStaticFile(res, 'login.html'));
app.get(['/register', '/register.html'], (req, res) => serveStaticFile(res, 'register.html'));
app.get(['/privacy', '/privacy.html'], (req, res) => serveStaticFile(res, 'privacy.html'));
app.get(['/terms', '/terms.html'], (req, res) => serveStaticFile(res, 'terms.html'));
app.get(['/forgot-password', '/forgot-password.html'], (req, res) => serveStaticFile(res, 'forgot-password.html'));
app.get(['/dashboard', '/dashboard.html'], (req, res) => serveStaticFile(res, 'dashboard.html'));
app.get(['/admin', '/admin.html'], (req, res) => serveStaticFile(res, 'admin.html'));

/* ==========================================================================
   REST API ENDPOINTS
   ========================================================================== */

// 6. Health Check Endpoint (Render & Uptime Monitors)
app.get(['/api/health', '/health'], (req, res) => {
  const isHealthy = getSQLStatus();

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    service: 'BookBridgee Enterprise Engine',
    database: {
      connected: isHealthy,
      dialect: getDialect()
    },
    version: '2.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get(['/api/ping', '/ping'], (req, res) => {
  res.status(200).send('pong');
});

// 7. Platform Statistics (Computed live from Database)
app.get(['/api/statistics', '/api/statistics/'], bookController.getStatistics);


// WhatsApp endpoint rate limiter (10 per minute)
let rateLimit = null;
try { rateLimit = require('express-rate-limit'); } catch (e) {}
const whatsappRateLimiter = rateLimit ? rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  message: { error: 'Too many WhatsApp requests. Limit is 10 per minute.', status: 429 },
  standardHeaders: true,
  legacyHeaders: false
}) : (req, res, next) => next();

// 8. Authentication & Password Reset Endpoints
app.post(['/api/register', '/api/auth/register'], validateRegisterInput, authController.register);
app.post(['/api/login', '/api/auth/login'], validateLoginInput, authController.login);
app.get(['/api/auth/me', '/api/users/profile'], authenticateToken, authController.getMe);
app.put('/api/users/profile', authenticateToken, validateProfileUpdate, authController.updateProfile);
app.post('/api/auth/forgot-password', validateForgotPasswordInput, authController.forgotPassword);
app.get('/api/auth/verify-reset-token/:token', authController.verifyResetToken);
app.post('/api/auth/reset-password', validateResetPasswordInput, authController.resetPassword);

// 9. Book / Textbook Endpoints
app.get('/api/books', optionalAuth, bookController.getBooks);
app.get('/api/books/:id', optionalAuth, bookController.getBookById);
app.post('/api/books', authenticateToken, validateBookInput, (req, res, next) => bookController.createBook(req, res, next, io));
app.put('/api/books/:id', authenticateToken, validateBookUpdate, (req, res, next) => bookController.updateBook(req, res, next, io));
app.patch(['/api/books/:id/status', '/api/books/:id'], authenticateToken, validateBookUpdate, (req, res, next) => bookController.updateBook(req, res, next, io));
app.delete('/api/books/:id', authenticateToken, (req, res, next) => bookController.deleteBook(req, res, next, io));

// 10. Persistent Real-Time Chat & Messaging Endpoints
app.get('/api/conversations', authenticateToken, chatController.getConversations);
app.post('/api/conversations', authenticateToken, chatController.getOrCreateConversation);
app.get('/api/conversations/:id/messages', authenticateToken, chatController.getMessages);
app.post('/api/conversations/:id/messages', authenticateToken, validateMessageInput, (req, res, next) => chatController.sendMessage(req, res, next, io));
app.get('/api/conversations/:id/whatsapp', authenticateToken, whatsappRateLimiter, chatController.getConversationWhatsApp);
app.post(['/api/conversations/:id/whatsapp/approve', '/api/conversations/:id/share-whatsapp'], authenticateToken, (req, res, next) => chatController.approveConversationWhatsApp(req, res, next, io));
app.post(['/api/conversations/:id/report', '/api/users/report'], authenticateToken, chatController.reportUser);
app.post(['/api/conversations/:id/block', '/api/users/block'], authenticateToken, chatController.blockUser);

app.get('/api/notifications', authenticateToken, chatController.getNotifications);
app.put('/api/notifications/read', authenticateToken, chatController.markNotificationsRead);

// Legacy Messaging API support (backward compatibility for existing frontend)
app.get('/api/messages', authenticateToken, chatController.getLegacyMessages);
app.post('/api/messages', authenticateToken, validateMessageInput, (req, res, next) => chatController.sendLegacyMessage(req, res, next, io));

// 10.5 Contact Inquiries Endpoint (Default destination: bookbridgee@gmail.com)
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }
    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim();
    const cleanSubject = String(subject || 'General Inquiry').trim();
    const cleanMessage = String(message).trim();

    console.log(`[Contact Inquiry] From: "${cleanName}" <${cleanEmail}> | Subject: "${cleanSubject}" -> Destination: bookbridgee@gmail.com`);

    // Record in AuditLog for administrative tracking
    try {
      const { AuditLog } = require('./models');
      if (AuditLog) {
        await AuditLog.create({
          action: 'CONTACT_INQUIRY',
          userId: req.user ? req.user.id : null,
          targetResource: 'bookbridgee@gmail.com',
          details: JSON.stringify({
            name: cleanName,
            email: cleanEmail,
            subject: cleanSubject,
            messagePreview: cleanMessage.substring(0, 150)
          }),
          ipAddress: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
        });
      }
    } catch (e) {
      // non-blocking
    }

    // Try direct email transmission via Brevo API / Nodemailer if configured
    let mailResult = null;
    try {
      const mailEngine = require('./config/mail');
      if (mailEngine && mailEngine.isConfigured) {
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
            <div style="background: #3E6B3A; color: #ffffff; padding: 24px; text-align: center;">
              <h2 style="margin: 0; font-size: 20px;">BookBridge Campus Marketplace</h2>
              <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">New Student Contact Inquiry</p>
            </div>
            <div style="padding: 24px; background: #ffffff;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 120px;"><strong>Student Name:</strong></td><td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: bold;">${cleanName}</td></tr>
                <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;"><strong>Student Email:</strong></td><td style="padding: 8px 0; color: #0f172a; font-size: 14px;"><a href="mailto:${cleanEmail}">${cleanEmail}</a></td></tr>
                <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;"><strong>Subject:</strong></td><td style="padding: 8px 0; color: #0f172a; font-size: 14px;">${cleanSubject}</td></tr>
                <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;"><strong>Received:</strong></td><td style="padding: 8px 0; color: #0f172a; font-size: 13px;">${new Date().toLocaleString('en-IN')}</td></tr>
              </table>
              <div style="background: #f8fafc; border-left: 4px solid #3E6B3A; padding: 16px; border-radius: 6px; font-size: 14px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${cleanMessage}</div>
              <div style="margin-top: 24px; text-align: center;">
                <a href="mailto:${cleanEmail}?subject=${encodeURIComponent('Re: ' + cleanSubject)}" style="background: #3E6B3A; color: #ffffff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reply to ${cleanName}</a>
              </div>
            </div>
            <div style="background: #f1f5f9; padding: 14px; text-align: center; font-size: 12px; color: #64748b;">
              Delivered directly to bookbridgee@gmail.com via Brevo Transactional Email Engine
            </div>
          </div>
        `;

        mailResult = await mailEngine.sendMail({
          to: mailEngine.TARGET_EMAIL,
          replyTo: cleanEmail,
          replyToName: cleanName,
          subject: `[BookBridge ${cleanSubject}] Inquiry from ${cleanName}`,
          text: `Student Name: ${cleanName}\nStudent Email: ${cleanEmail}\nCategory: ${cleanSubject}\nDate: ${new Date().toLocaleString('en-IN')}\n\nStudent Query:\n${cleanMessage}\n\n-- Sent via BookBridge Student Platform`,
          html
        });
      }
    } catch (mailErr) {
      console.warn('[Contact Mail Dispatch Note]:', mailErr.message);
    }

    return res.status(200).json({
      status: 'ok',
      destination: 'bookbridgee@gmail.com',
      sentViaEmail: Boolean(mailResult?.sent),
      provider: mailResult?.provider || null,
      messageId: mailResult?.messageId || null,
      message: mailResult?.sent
        ? `Inquiry emailed directly to bookbridgee@gmail.com via ${mailResult.provider === 'brevo' ? 'Brevo' : 'SMTP'}!`
        : 'Inquiry received and addressed to bookbridgee@gmail.com'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process inquiry' });
  }
});

// 11. Admin Endpoints (RBAC Enforced: Only Role 'admin')
app.get('/api/admin/stats', authenticateToken, authorizeRoles('admin'), adminController.getStats);
app.get('/api/admin/users', authenticateToken, authorizeRoles('admin'), adminController.getUsers);
app.put('/api/admin/users/:id/role', authenticateToken, authorizeRoles('admin'), adminController.updateUserRole);
app.put('/api/admin/users/:id/status', authenticateToken, authorizeRoles('admin'), adminController.toggleUserStatus);
app.get('/api/admin/logs', authenticateToken, authorizeRoles('admin'), adminController.getAuditLogs);

// 12. Catch-all HTML Route
app.get('/:page.html', (req, res) => {
  const pageFile = `${req.params.page}.html`;
  serveStaticFile(res, pageFile);
});

// 13. Centralized Error Handler Middleware
app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS policy violation: ' + err.message, status: 403 });
  }

  const statusCode = err.status || err.statusCode || 500;
  console.error(`[Server Error] [${req.method} ${req.url}] ${err.stack || err.message}`);

  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    status: statusCode
  });
});

// 14. Server Initialization Function
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    // Sync relational tables if database engine is active
    if (getSQLStatus()) {
      try {
        await syncDatabase({ alter: false });
        if (process.env.NODE_ENV !== 'production') {
          await seedDatabase();
        } else {
          console.log('[Seed] Skipping automatic database seed in production environment.');
        }
      } catch (syncError) {
        console.warn('[DB Sync Notice] Schema sync notice:', syncError.message);
      }
    }

    server.listen(PORT, HOST, () => {
      console.log(`===================================================`);
      console.log(` 🌉 BookBridgee 2.0 Production Engine Active`);
      console.log(` 📍 Local URL:     http://localhost:${PORT}`);
      console.log(` 📊 Health Check:  http://localhost:${PORT}/api/health`);
      console.log(` 📚 Browse Books:  http://localhost:${PORT}/browse.html`);
      console.log(` ⚡ Socket.IO:     Active on /socket.io/socket.io.js`);
      console.log(` 🗄️  Database:      ${getDialect().toUpperCase()} Engine (${getSQLStatus() ? 'Connected' : 'Degraded Mode'})`);
      console.log(`===================================================`);

      // Initialize Keep-Alive Heartbeat if KEEP_ALIVE_URL is provided
      initKeepAliveHeartbeat();
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[Startup Fatal Error] Fatal error during production startup:`, error.message);
      process.exit(1);
    }
    console.error(`[Startup Notice] Encountered non-fatal error during startup:`, error.message);
    server.listen(PORT, HOST, () => {
      console.log(`[Resilient Startup] Server listening on port ${PORT} to keep instance alive.`);
      initKeepAliveHeartbeat();
    });
  }
};

// 15. Keep-Alive Service (Prevents Render Free Tier from Sleeping on Inactivity)
const initKeepAliveHeartbeat = () => {
  const rawUrl = process.env.KEEP_ALIVE_URL;
  if (!rawUrl) return;

  const targetUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;
  const pingUrl = `${targetUrl}/api/health`;

  // Render spins down after 15 minutes of inactivity; we ping every 14 minutes
  const INTERVAL_MS = 14 * 60 * 1000;

  setInterval(() => {
    try {
      const client = pingUrl.startsWith('https') ? require('https') : require('http');
      client.get(pingUrl, (res) => {
        console.log(`[Keep-Alive Ping] Heartbeat sent to ${pingUrl} - Status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.warn(`[Keep-Alive Ping] Heartbeat probe: ${err.message}`);
      });
    } catch (e) {
      // Ignored
    }
  }, INTERVAL_MS);

  console.log(`[Keep-Alive Service] Heartbeat active every 14 minutes for: ${pingUrl}`);
};

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('[Shutdown] SIGTERM received. Closing HTTP server and database pool...');
  server.close(async () => {
    if (sequelize) await sequelize.close();
    console.log('[Shutdown] Server and database cleanly closed.');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Shutdown] SIGINT received. Closing HTTP server and database pool...');
  server.close(async () => {
    if (sequelize) await sequelize.close();
    console.log('[Shutdown] Server and database cleanly closed.');
    process.exit(0);
  });
});

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer };
