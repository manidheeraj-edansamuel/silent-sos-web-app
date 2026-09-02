/**
 * ==============================================================================
 * Silent SOS - Authentication Routes (`/api/v1/auth`)
 * Description: Registration, login with Argon2id, JWT token issuance, logout,
 * and current user profile inspection.
 * ==============================================================================
 */

import { Router } from 'express';
import { query } from '../config/database.js';
import { hashPassword, verifyPassword } from '../services/passwordService.js';
import { generateToken } from '../services/tokenService.js';
import { authenticateToken } from '../middleware/auth.js';
import { authRateLimiter, loginRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Basic email regex for format validation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/v1/auth/register
 * Register a new user account with Argon2id password hashing
 */
router.post('/register', authRateLimiter, async (req, res, next) => {
  try {
    const { full_name, email, phone_number, password } = req.body;

    // Validation: full_name
    if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: full_name is required and must be at least 2 characters.',
      });
    }

    if (full_name.trim().length > 150) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: full_name cannot exceed 150 characters.',
      });
    }

    // Validation: email
    if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: A valid email address is required.',
      });
    }

    // Validation: password
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: Password is required and must be at least 8 characters long.',
      });
    }

    if (password.length > 128) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: Password cannot exceed 128 characters.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = full_name.trim();
    const cleanPhone = phone_number ? String(phone_number).trim() : null;

    // Check for existing duplicate user with case-insensitive email
    const existingRes = await query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1);',
      [normalizedEmail]
    );

    if (existingRes.rowCount > 0) {
      return res.status(409).json({
        status: 'error',
        message: 'An account with this email address already exists.',
      });
    }

    // Hash password with Argon2id (never store plaintext)
    const passwordHash = await hashPassword(password);

    // Insert user into database
    const insertRes = await query(
      `INSERT INTO users (full_name, email, phone_number, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, full_name, email, phone_number, created_at;`,
      [cleanName, normalizedEmail, cleanPhone, passwordHash]
    );

    const newUser = insertRes.rows[0];

    // Generate JWT access token with { sub: user.id }
    const token = generateToken(newUser.id);

    return res.status(201).json({
      status: 'ok',
      message: 'User registered successfully.',
      data: {
        user: newUser,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/login
 * Authenticate user with credentials, verify Argon2id hash, and issue JWT
 */
router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'Validation error: Email and password are required.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Query user by case-insensitive email
    const userRes = await query(
      `SELECT id, full_name, email, phone_number, password_hash, created_at, last_login_at
       FROM users 
       WHERE LOWER(email) = LOWER($1);`,
      [normalizedEmail]
    );

    // Generic failure message to prevent user enumeration
    const authFailedResponse = () =>
      res.status(401).json({
        status: 'error',
        message: 'Invalid email or password.',
      });

    if (userRes.rowCount === 0) {
      return authFailedResponse();
    }

    const user = userRes.rows[0];

    // Check if account has a configured password_hash
    if (!user.password_hash) {
      return authFailedResponse();
    }

    // Verify candidate password against Argon2id hash
    const isValid = await verifyPassword(user.password_hash, password);
    if (!isValid) {
      return authFailedResponse();
    }

    // Record login timestamp
    const now = new Date();
    await query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2;', [
      now,
      user.id,
    ]);

    // Issue JWT token with only { sub: user.id }
    const token = generateToken(user.id);

    // Build safe response (password_hash is explicitly stripped)
    const safeUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      phone_number: user.phone_number,
      created_at: user.created_at,
      last_login_at: now.toISOString(),
    };

    return res.status(200).json({
      status: 'ok',
      message: 'Login successful.',
      data: {
        user: safeUser,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/logout
 * Explicit logout endpoint for client session termination
 */
router.post('/logout', (req, res) => {
  return res.status(200).json({
    status: 'ok',
    message: 'Logged out successfully. Please remove your access token from client storage.',
  });
});

/**
 * GET /api/v1/auth/me
 * Protected endpoint returning the authenticated user profile
 */
router.get('/me', authenticateToken, (req, res) => {
  return res.status(200).json({
    status: 'ok',
    data: {
      user: req.user,
    },
  });
});

export default router;
