/**
 * ==========================================================================
 * BOOKBRIDGE EMAIL SERVICE (NODEMAILER)
 * Automated transactional emails and student inquiries to bookbridgee@gmail.com
 * ==========================================================================
 */

const nodemailer = require('nodemailer');

const TARGET_EMAIL = process.env.SUPPORT_EMAIL || 'bookbridgee@gmail.com';
const SMTP_USER = process.env.EMAIL_USER || process.env.SMTP_USER || process.env.GMAIL_USER || '';
const SMTP_PASS = process.env.EMAIL_PASS || process.env.SMTP_PASS || process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 587;

let transporter = null;

if (SMTP_USER && SMTP_PASS) {
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });
    console.log(`[Mail Engine] Configured SMTP transporter for: ${SMTP_USER} -> ${TARGET_EMAIL}`);
  } catch (err) {
    console.warn(`[Mail Engine] Could not initialize SMTP transporter: ${err.message}`);
  }
}

/**
 * Send an email message
 */
async function sendMail({ to = TARGET_EMAIL, replyTo, subject, text, html }) {
  if (!transporter) {
    return {
      sent: false,
      reason: 'NO_SMTP_CREDENTIALS',
      destination: to,
      message: 'SMTP credentials not configured in environment. Inquiries are stored in AuditLog and available via Gmail Web launcher.'
    };
  }

  try {
    const info = await transporter.sendMail({
      from: `"BookBridge Support" <${SMTP_USER}>`,
      to,
      replyTo: replyTo || undefined,
      subject,
      text,
      html: html || `<pre style="font-family: sans-serif; font-size: 14px; line-height: 1.6;">${text}</pre>`
    });
    return {
      sent: true,
      messageId: info.messageId,
      destination: to
    };
  } catch (err) {
    console.error(`[Mail Engine Error] Failed to send email to ${to}:`, err.message);
    return {
      sent: false,
      error: err.message,
      destination: to
    };
  }
}

module.exports = {
  transporter,
  sendMail,
  TARGET_EMAIL,
  isConfigured: Boolean(transporter)
};
