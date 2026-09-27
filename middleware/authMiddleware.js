//Middleware functions are executed during the request-response cycle. They can perform tasks like authentication, logging, or validation before the request reaches the route handler.

/**
- Authentication: Middleware is used to secure routes by verifying tokens.
- Reusable Logic: Can be applied to multiple routes to handle common tasks like authentication or logging.
- Flow Control: Uses next() to pass control to the next middleware or route handler.
 */
import * as authService from '../services/authService.js';
import { DatabaseService } from '../databases/mariaDB.js';
import logger from '../utils/logger.js';
import { getClientIp } from '../utils/requestUtils.js';

/**
 * Express middleware to authenticate requests using JWT stored in cookies or headers.
 *
 * Behavior:
 * - Extracts token via `authService.extractTokenFromRequest`.
 * - Verifies token with `authService.verifyToken`.
 * - Attaches `req.user` on success and calls `next()`.
 * - Returns `401` JSON response when missing/invalid/expired token.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function authenticateToken(req, res, next) {
  const token = authService.extractTokenFromRequest(req);

  const ip = getClientIp(req);

  if (!token) {
    logger.auth('[AUTH] 401 No token provided', null, ip);
    return res.status(401).json({
      error: 'Access denied',
      message: 'JWT token required',
    });
  }
  try {
    const decoded = authService.verifyToken(token);
    if (!decoded) {
      logger.auth('[AUTH] 401 Invalid/expired token', null, ip);
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is expired or invalid',
      });
    }

    // Hydrate user profile from DB so JWT stays minimal (id + role only)
    const admin = await DatabaseService.getAdminById(decoded.id);
    if (!admin) {
      logger.auth('[AUTH] 401 Admin not found for token id', null, ip);
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is expired or invalid',
      });
    }
    // A deactivated account must lose access immediately, not when its JWT expires
    if (admin.active === 0 || admin.active === false) {
      logger.auth('[AUTH] 401 Admin account is deactivated', admin.username, ip);
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is expired or invalid',
      });
    }

    req.user = {
      id: decoded.id,
      role: decoded.role,
      isAdmin: decoded.role === 'admin',
      username: admin.username,
      full_name: admin.full_name || 'author',
    };
    next();
  } catch (error) {
    logger.auth('[AUTH] 401 Token verification exception', null, ip);
    logger.error('Error during token authentication:', error);
    return res.status(401).json({
      error: 'Invalid token',
      message: 'Token verification failed',
    });
  }
}

/**
 * Middleware that enforces administrative privileges.
 * Expects `req.user` to be populated (e.g. via `authenticateToken`).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    const ip = getClientIp(req);
    logger.auth(
      `[AUTH] 403 Admin access denied for user "${req.user?.username ?? 'unauthenticated'}" on ${req.method} ${req.originalUrl}`,
      req.user?.username ?? null,
      ip,
    );
    return res.status(403).json({ 
      error: 'Admin privileges required',
      message: 'Only administrators have access to this function', 
    });
  }
  next();
}