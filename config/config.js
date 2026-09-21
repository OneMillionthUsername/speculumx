import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', `.env.${process.env.NODE_ENV || 'development'}`) });

// config/config.js

export const APP_VERSION = '4.1.0';

export const NODE_ENV = process.env.NODE_ENV || 'development';
//export const IS_PLESK = Boolean(process.env.PLESK_ENV && process.env.PLESK_ENV === 'true');
export const IS_PRODUCTION = NODE_ENV === 'production';
// Common defaults: allow rich HTML editor payloads without being overly permissive
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '2mb';
export const URLENCODED_BODY_LIMIT = process.env.URLENCODED_BODY_LIMIT || '2mb';
export const PORT = process.env.PORT || (3000);
export const HTTPS_PORT = process.env.HTTPS_PORT || (IS_PRODUCTION ? 443 : 3443);
export const HOST = process.env.HOST || '0.0.0.0';
export const DOMAIN = process.env.DOMAIN || 'localhost';
export const DB_HOST = process.env.DB_HOST;
export const DB_USER = process.env.DB_USER;
export const DB_PASSWORD = process.env.DB_PASSWORD;
export const DB_NAME = process.env.DB_NAME;
export const JWT_SECRET = process.env.JWT_SECRET;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your_gemini_api_key_here';


function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export const SMTP_HOST = process.env.SMTP_HOST || 'host.docker.internal';
export const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
export const SMTP_SECURE = parseBoolean(process.env.SMTP_SECURE, false);
export const SMTP_USER = process.env.SMTP_USER || '';
export const SMTP_PASS = process.env.SMTP_PASS || '';
export const CONTACT_FORM_TO = process.env.CONTACT_FORM_TO || '';
export const CONTACT_FORM_FROM = process.env.CONTACT_FORM_FROM || `no-reply@${DOMAIN}`;
export const CONTACT_FORM_SUBJECT_PREFIX = process.env.CONTACT_FORM_SUBJECT_PREFIX || '[Blog Kontakt]';
export const COMMENT_NOTIFY_ENABLED = parseBoolean(process.env.COMMENT_NOTIFY_ENABLED, true);
export const COMMENT_NOTIFY_TO = process.env.COMMENT_NOTIFY_TO || '';
export const COMMENT_NOTIFY_SUBJECT_PREFIX = process.env.COMMENT_NOTIFY_SUBJECT_PREFIX || '[Neuer Kommentar]';
