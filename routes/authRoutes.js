/**
 * authRoutes: Für Login, Logout, Registrierung, Token usw.
 * adminRoutes: Für Admin-spezifische Funktionen
 * adminController: Für die Logik hinter Admin-Funktionen
 */
import express from 'express';
import { loginLimiter, strictLimiter } from '../utils/limiters.js';
import adminController from '../controllers/adminController.js';
import * as authService from '../services/authService.js';
import { AUTH_COOKIE_NAME } from '../services/authService.js';
import { celebrate, Joi, Segments } from 'celebrate';
import { IS_PRODUCTION } from '../config/config.js';
import logger from '../utils/logger.js';
import csrfProtection from '../utils/csrf.js';

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.headers['x-real-ip']
    || req.ip
    || req.socket?.remoteAddress
    || 'unknown';
}

// Nur same-origin Referer als Redirect-Ziel akzeptieren (verhindert Open Redirect)
function resolveSafeRedirect(req, fallback) {
  const referer = req.get('Referer');
  if (!referer) return fallback;
  try {
    const refUrl = new URL(referer);
    if (refUrl.hostname === req.hostname) {
      return refUrl.pathname + refUrl.search;
    }
  } catch { /* invalid URL, use fallback */ }
  return fallback;
}

/**
 * Authentication routes
 *
 * - `POST /login`  : authenticate admin credentials and set auth cookie
 * - `POST /verify` : verify a token from header, cookie or body
 * - `POST /logout` : clear auth cookie and sign out
 *
 * These routes apply rate limiting and input validation. Login responses
 * explicitly avoid leaking token details and carefully log audit info.
 */
const authRouter = express.Router();
// authRouter.all('*', requireJsonContent, async (req, res) => {
//   //hier allgemeine Logik ausführen
//   //logging
//   //sanitazing
// });
/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Admin Login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Erfolgreich eingeloggt
 *       401:
 *         description: Ungültige Anmeldedaten
 */
// Login-Validierung
authRouter.post('/login',
  loginLimiter,
  csrfProtection,
  celebrate({
    [Segments.BODY]: Joi.object({
      username: Joi.string().min(1).max(100).required(),
      password: Joi.string().min(1).max(100).required(),
    }),
  }),
  async (req, res) => {
    try {
      const wantsHtml = req.accepts && req.accepts('html') && !req.is('application/json');
      const ip = getClientIp(req);
      const attemptedUsername = req.body?.username || 'unknown';
      logger.authEvent('AUTH_LOGIN_ATTEMPT', {
        ip,
        username: attemptedUsername,
        route: req.originalUrl,
        method: req.method,
        userAgent: req.get('User-Agent') || 'unknown',
      }, 'INFO');
      logger.debug('[AUTH] /auth/login request received', {
        bodyKeys: Object.keys(req.body || {}),
        hasUsername: Boolean(req.body && req.body.username),
        hasPassword: Boolean(req.body && typeof req.body.password === 'string'),
        csrfHeader: req.get('x-csrf-token') || req.get('x-xsrf-token') || req.get('csrf-token') || null,
        hasCsrfCookie: Boolean(req.cookies && req.cookies._csrf),
      });
      // Timeout für Auth-Operationen (ohne unhandled rejection)
      const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS || 8000);
      const TIMEOUT_SENTINEL = Symbol('AUTH_TIMEOUT');
      let timer;
      const authPromise = adminController.authenticateAdmin(req.body.username, req.body.password);
      // Mit Promise.race werden zwei Promises "ins Rennen geschickt":
      // die Authentifizierung und ein Timeout. 
      // Wenn die Authentifizierung zu lange dauert, 
      // gewinnt das Timeout und wir können entsprechend reagieren,
      // ohne dass eine unhandled rejection entsteht.
      const raced = await Promise.race([
        authPromise,
        new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), AUTH_TIMEOUT_MS); }),
      ]);
      if (timer) clearTimeout(timer);

      if (raced === TIMEOUT_SENTINEL) {
        logger.warn(`[AUTH AUDIT] Authentication timed out for username: ${req.body.username}`);
        logger.authEvent('AUTH_LOGIN_TIMEOUT', {
          ip,
          username: attemptedUsername,
          route: req.originalUrl,
          reason: 'authentication_timeout',
        }, 'WARN');
        return res.status(503).json({ success: false, error: 'Authentication timeout' });
      }
      const admin = raced;
      if (!admin) {
        logger.warn(`[AUTH AUDIT] Failed login for username: ${req.body.username}`);
        logger.authEvent('AUTH_LOGIN_FAILURE', {
          ip,
          username: attemptedUsername,
          route: req.originalUrl,
          reason: 'invalid_credentials',
        }, 'WARN');
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
      // Token generation
      const { id, username, role, full_name } = admin;
      const token = authService.generateToken({ id, role });
      logger.debug('[AUTH] Token generated successfully for user', { id, username, role, full_name });
      res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,           // Nicht per JavaScript lesbar
        secure: IS_PRODUCTION,    // Nur über HTTPS
        sameSite: 'strict',       // CSRF-Schutz
        maxAge: 24 * 60 * 60 * 1000, // 24h
        path: '/',                 // Für ganze Domain
      });
      logger.info(`[AUTH AUDIT] Successful login for username: ${username} (id: ${id}, role: ${role})`);
      logger.authEvent('AUTH_LOGIN_SUCCESS', {
        ip,
        username,
        userId: id,
        role,
        route: req.originalUrl,
      }, 'INFO');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (wantsHtml) {
        return res.redirect(303, resolveSafeRedirect(req, '/createPost'));
      }
      res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          full_name: admin.full_name,
        },
      });
    } catch (error) {
      const wantsHtml = req.accepts && req.accepts('html') && !req.is('application/json');
      const ip = getClientIp(req);
      const attemptedUsername = req.body?.username || 'unknown';
      logger.error(`[AUTH AUDIT] Login error for username: ${req.body && req.body.username}`, error);
      logger.authEvent('AUTH_LOGIN_ERROR', {
        ip,
        username: attemptedUsername,
        route: req.originalUrl,
        error: error?.message || 'unknown_error',
      }, 'ERROR');
      logger.debug('[AUTH] Login error details', {
        message: error && error.message,
        stack: error && error.stack,
        hasCsrfHeader: Boolean(req.get('x-csrf-token') || req.get('x-xsrf-token') || req.get('csrf-token')),
        hasCsrfCookie: Boolean(req.cookies && req.cookies._csrf),
      });
      if (wantsHtml) {
        return res.redirect(303, resolveSafeRedirect(req, '/createPost?login=error'));
      }
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });
// POST /auth/verify - Token-Verifikation
// Response:
//   - On success:
authRouter.post('/verify',
  strictLimiter,
  celebrate({
    [Segments.BODY]: Joi.object({
      token: Joi.string().min(10).max(512).optional(),
    }),
  }),
  (req, res) => {
    let tokenSource = 'unknown';
    try {
      const token = authService.extractTokenFromRequest(req);
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        tokenSource = 'Authorization header';
      } else if (req.cookies && req.cookies[AUTH_COOKIE_NAME]) {
        tokenSource = 'authToken cookie';
      } else if (req.body && req.body.token) {
        tokenSource = 'request body';
      }
      if (!token) {
        logger.warn(`[AUTH AUDIT] Token verification failed: No token found (source: ${tokenSource})`);
        return res.status(401).json({ 
          success: false,
          data: {
            valid: false,
            error: 'Kein Token gefunden', 
          },
        });
      }
      const admin = authService.verifyToken(token);
      if (!admin) {
        logger.warn(`[AUTH AUDIT] Token verification failed: Invalid or expired token (source: ${tokenSource})`);
        return res.status(403).json({ 
          success: false,
          data: {
            valid: false,
            error: 'Token invalid or expired', 
          },
        });
      }
      res.json({
        success: true,
        data: {
          valid: true,
          user: {
            id: Number(admin.id), // BigInt zu Number konvertieren
            username: admin.username,
          },
        },
      });
    } catch (error) {
      logger.error(`[AUTH AUDIT] Error during token verification (source: ${tokenSource}):`, error);
      return res.status(403).json({ 
        success: false,
        data: {
          valid: false,
          error: 'Token invalid or expired', 
        },
      });
    }
  });
// POST /auth/logout - Abmeldung
authRouter.post('/logout', csrfProtection, (req, res) => {
  const wantsHtml = req.accepts && req.accepts('html') && !req.is('application/json');
  // Cookie entfernen (auch wenn nicht vorhanden, ist das idempotent)
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });

  // Optional: Logging
  //console.info(`[AUTH AUDIT] Logout for user: ${req.user?.username || 'unknown'}`);

  // Klare Antwort für das Frontend
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (wantsHtml) {
    return res.redirect(303, '/');
  }
  res.status(200).json({
    success: true,
    message: 'Logout erfolgreich. Sie wurden abgemeldet.',
  });
});
export default authRouter;


