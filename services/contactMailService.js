import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import {
  COMMENT_NOTIFY_ENABLED,
  COMMENT_NOTIFY_SUBJECT_PREFIX,
  COMMENT_NOTIFY_TO,
  CONTACT_FORM_FROM,
  CONTACT_FORM_SUBJECT_PREFIX,
  CONTACT_FORM_TO,
  SMTP_CLIENT_NAME,
  SMTP_HOST,
  SMTP_PASS,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_TLS_REJECT_UNAUTHORIZED,
  SMTP_USER,
} from '../config/config.js';

// Display name of the contact form mail. The spam filter exempts web contact forms only when
// From equals To, so the form mail is sent from the recipient address; the visitor is in Reply-To.
const CONTACT_FROM_DISPLAY_NAME = 'Blog Kontakt';

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const transportOptions = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    tls: {
      rejectUnauthorized: SMTP_TLS_REJECT_UNAUTHORIZED,
    },
  };

  if (SMTP_CLIENT_NAME) {
    transportOptions.name = SMTP_CLIENT_NAME;
  }

  if (SMTP_USER && SMTP_PASS) {
    transportOptions.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  cachedTransporter = nodemailer.createTransport(transportOptions);
  return cachedTransporter;
}

function resolveToAddress() {
  if (!CONTACT_FORM_TO) {
    throw new Error('CONTACT_FORM_TO is not configured');
  }
  return CONTACT_FORM_TO;
}

function resolveCommentNotifyAddress() {
  return COMMENT_NOTIFY_TO || CONTACT_FORM_TO;
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function sanitizeHeaderValue(value) {
  const normalized = String(value || '')
    .replace(/\r\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ');

  let cleaned = '';
  for (const char of normalized) {
    const charCode = char.charCodeAt(0);
    const isControlChar = (charCode >= 0 && charCode <= 31) || charCode === 127;
    cleaned += isControlChar ? ' ' : char;
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

function sanitizeMessageText(value) {
  return String(value || '')
    .split('\u0000').join('')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function buildSubject(name) {
  const safeName = sanitizeHeaderValue(name) || 'Unbekannt';
  return `${CONTACT_FORM_SUBJECT_PREFIX} ${safeName}`;
}

function buildTextBody({ name, email, message, ip, userAgent }) {
  const safeName = sanitizeHeaderValue(name);
  const safeEmail = sanitizeHeaderValue(email);
  const safeMessage = sanitizeMessageText(message);
  return [
    'Neue Kontaktanfrage',
    '',
    `Name: ${safeName}`,
    `E-Mail: ${safeEmail}`,
    '',
    'Nachricht:',
    safeMessage,
    '',
    `IP: ${ip || 'unknown'}`,
    `User-Agent: ${userAgent || 'unknown'}`,
  ].join('\n');
}

async function sendContactMail({ name, email, message, ip, userAgent }) {
  const transporter = getTransporter();
  const to = resolveToAddress();
  const safeReplyTo = sanitizeHeaderValue(email);

  if (!isValidEmailAddress(safeReplyTo)) {
    throw new Error('Invalid reply-to email address');
  }

  const info = await transporter.sendMail({
    from: { name: CONTACT_FROM_DISPLAY_NAME, address: to },
    to,
    replyTo: safeReplyTo,
    subject: buildSubject(name),
    text: buildTextBody({ name, email, message, ip, userAgent }),
  });

  logger.info('[CONTACT] Contact email sent', {
    messageId: info && info.messageId ? info.messageId : null,
    to,
  });

  return info;
}

function buildCommentSubject(postTitle) {
  const safePostTitle = sanitizeHeaderValue(postTitle) || 'Unbekannter Beitrag';
  return `${COMMENT_NOTIFY_SUBJECT_PREFIX} ${safePostTitle}`;
}

function buildCommentTextBody({ postId, postTitle, postUrl, username, text, ip, userAgent }) {
  const safePostId = Number(postId) || 0;
  const safePostTitle = sanitizeHeaderValue(postTitle) || 'Unbekannter Beitrag';
  const safePostUrl = sanitizeHeaderValue(postUrl) || '-';
  const safeUsername = sanitizeHeaderValue(username) || 'Anonym';
  const safeText = sanitizeMessageText(text);

  return [
    'Neuer Kommentar eingegangen',
    '',
    `Beitrag: ${safePostTitle}`,
    `Post-ID: ${safePostId}`,
    `Link: ${safePostUrl}`,
    '',
    `Benutzer: ${safeUsername}`,
    'Kommentar:',
    safeText,
    '',
    `IP: ${ip || 'unknown'}`,
    `User-Agent: ${userAgent || 'unknown'}`,
  ].join('\n');
}

async function sendCommentNotificationMail({ postId, postTitle, postUrl, username, text, ip, userAgent }) {
  if (!COMMENT_NOTIFY_ENABLED) return null;

  const to = resolveCommentNotifyAddress();
  if (!to) {
    logger.warn('[COMMENT_NOTIFY] No recipient configured; skipping comment notification email');
    return null;
  }

  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from: CONTACT_FORM_FROM,
    to,
    subject: buildCommentSubject(postTitle),
    text: buildCommentTextBody({ postId, postTitle, postUrl, username, text, ip, userAgent }),
  });

  logger.info('[COMMENT_NOTIFY] Comment notification email sent', {
    messageId: info && info.messageId ? info.messageId : null,
    to,
    postId,
  });

  return info;
}

export default {
  sendContactMail,
  sendCommentNotificationMail,
};
