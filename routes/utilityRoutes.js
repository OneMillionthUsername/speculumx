import express from 'express';
import * as config from '../config/config.js';
import logger from '../middleware/loggerMiddleware.js';
import csrfProtection from '../utils/csrf.js';
const utilityRouter = express.Router();

/**
 * Utility endpoints (health, redirect, csrf-token).
 *
 * The CSRF token endpoint is intentionally unauthenticated so clients
 * can fetch a token before making protected POST/PUT/DELETE requests.
 */

utilityRouter.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    version: process.env.npm_package_version || '1.0.0',
  });
});

utilityRouter.get('/redirect', (req, res) => {
  try {
    const url = new URL(req.query.url);
    // Enforce HTTPS and restrict to our domain(s)
    const allowedHosts = new Set([
      config.DOMAIN,
      `www.${config.DOMAIN}`,
    ]);
    // Fixed messages: echoing the untrusted URL back would allow content injection
    if (url.protocol !== 'https:' || !allowedHosts.has(url.host)) {
      return res.status(400).type('text/plain').send('Unsupported redirect target');
    }
    res.redirect(url.toString());
  } catch (_e) {
    return res.status(400).type('text/plain').send('Invalid url');
  }
});

// CSRF token endpoint - creates a new token for clients to use
utilityRouter.get('/csrf-token', csrfProtection, (req, res) => {
  try {
    // Prevent caching of CSRF token responses (defensive headers)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    // Check if csrfToken function is available
    if (typeof req.csrfToken === 'function') {
      res.json({ csrfToken: req.csrfToken() });
    } else {
      // Fallback - this shouldn't happen but provides graceful degradation
      logger.warn('req.csrfToken function not available in csrf-token endpoint');
      res.status(500).json({ error: 'CSRF token generation unavailable' });
    }
  } catch (error) {
    logger.error('Error generating CSRF token', { error: error.message });
    res.status(500).json({ error: 'Failed to generate CSRF token' });
  }
});

export default utilityRouter;