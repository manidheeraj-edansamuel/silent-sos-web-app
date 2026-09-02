/**
 * ==============================================================================
 * Silent SOS - Authentication Middleware
 * Description: Validates Bearer JWT access tokens, extracts the 'sub' user ID,
 * checks user existence, and attaches safe user identity to req.user.
 * ==============================================================================
 */

import { verifyToken } from '../services/tokenService.js';
import { query } from '../config/database.js';

/**
 * Express middleware to protect routes requiring authentication.
 */
export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || typeof authHeader !== 'string') {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required. Missing Authorization header.',
    });
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid Authorization header format. Expected "Bearer <token>".',
    });
  }

  const token = parts[1];

  try {
    const decoded = verifyToken(token);

    if (!decoded || !decoded.sub) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token payload. Subject claim missing.',
      });
    }

    // Verify user exists in database and load safe identity
    const userRes = await query(
      'SELECT id, full_name, email, phone_number, created_at, last_login_at FROM users WHERE id = $1;',
      [decoded.sub]
    );

    if (userRes.rowCount === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Authenticated user no longer exists or session is invalid.',
      });
    }

    // Attach safe user record to request (password_hash is explicitly excluded in query)
    req.user = userRes.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Access token has expired. Please log in again.',
      });
    }

    return res.status(401).json({
      status: 'error',
      message: 'Invalid or malformed access token.',
    });
  }
}

export default authenticateToken;
