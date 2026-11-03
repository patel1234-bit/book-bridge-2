/**
 * ==========================================================================
 * BOOKBRIDGE EMAIL ENGINE (BREVO API & NODEMAILER SMTP)
 * Delivers real emails directly to bookbridgee@gmail.com and students
 * ==========================================================================
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const TARGET_EMAIL = process.env.SUPPORT_EMAIL || 'bookbridgee@gmail.com';
const BREVO_API_KEY = process.env.BREVO_API_KEY || process.env.SENDINBLUE_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'bookbridgee@gmail.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'BookBridge Support';

const SMTP_USER = process.env.EMAIL_HOST_USER || process.env.EMAIL_USER || process.env.SMTP_USER || process.env.GMAIL_USER || '';
const SMTP_PASS = process.env.EMAIL_HOST_PASSWORD || process.env.EMAIL_PASS || process.env.SMTP_PASS || process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT, 10) || 587;

let transporter = null;
if (SMTP_USER && SMTP_PASS) {
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    console.log(`[Mail Engine] Configured SMTP transporter for: ${SMTP_USER} -> ${TARGET_EMAIL}`);
  } catch (err) {
    console.warn(`[Mail Engine] Could not initialize SMTP transporter: ${err.message}`);
  }
}

/**
 * Send an email via Brevo HTTPS API or fallback to Nodemailer SMTP
 */
async function sendMail({ to = TARGET_EMAIL, replyTo, replyToName, subject, text, html }) {
  // Option 1: Brevo (Sendinblue) Transactional API (Fastest, direct HTTPS, 0 port blocks)
  if (BREVO_API_KEY) {
    try {
      const toArray = Array.isArray(to)
        ? to.map(e => typeof e === 'string' ? { email: e } : e)
        : [{ email: to }];

      const bodyPayload = {
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: toArray,
        subject: subject,
        htmlContent: html || `<pre style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">${text}</pre>`,
        textContent: text || ''
      };

      if (replyTo) {
        bodyPayload.replyTo = {
          email: typeof replyTo === 'string' ? replyTo : replyTo.email,
          name: replyToName || (typeof replyTo === 'object' ? replyTo.name : undefined) || 'Student'
        };
      }

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': BREVO_API_KEY,
          'content-type': 'application/json'
        },
        body: JSON.stringify(bodyPayload)
      });

      const data = await res.json();
      if (res.ok && data.messageId) {
        console.log(`[Brevo Email Sent] MessageId: ${data.messageId} -> To: ${JSON.stringify(to)} | Subject: "${subject}"`);
        return {
          sent: true,
          provider: 'brevo',
          messageId: data.messageId,
          destination: to
        };
      } else {
        console.warn(`[Brevo Email Warning] HTTP ${res.status}:`, data.message || JSON.stringify(data));
      }
    } catch (brevoErr) {
      console.warn(`[Brevo Email Exception]:`, brevoErr.message);
    }
  }

  // Option 2: Nodemailer SMTP
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: `"${BREVO_SENDER_NAME}" <${SMTP_USER}>`,
        to,
        replyTo: replyTo || undefined,
        subject,
        text,
        html: html || `<pre style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6;">${text}</pre>`
      });
      console.log(`[SMTP Email Sent] MessageId: ${info.messageId} -> To: ${to}`);
      return {
        sent: true,
        provider: 'smtp',
        messageId: info.messageId,
        destination: to
      };
    } catch (smtpErr) {
      console.error(`[SMTP Email Error]:`, smtpErr.message);
    }
  }

  return {
    sent: false,
    reason: 'NO_ACTIVE_EMAIL_PROVIDER',
    destination: to,
    message: 'Email service configured with fallback logging.'
  };
}

module.exports = {
  transporter,
  sendMail,
  TARGET_EMAIL,
  isConfigured: Boolean(BREVO_API_KEY || transporter)
};
