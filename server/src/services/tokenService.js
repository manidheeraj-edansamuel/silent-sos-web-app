/**
 * ==============================================================================
 * Silent SOS - JWT Token Service
 * Description: Generates and verifies minimal-claim JSON Web Tokens.
 * Security constraint: JWT payload must contain ONLY { "sub": "<user-id>" }.
 * ==============================================================================
 */

import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../server/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_change_in_production_9f82b71c04';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required in production.');
}

/**
 * Generates a signed JWT with minimal identity payload: { sub: userId }
 * @param {string} userId - UUID of the authenticated user
 * @param {string} [expiresIn] - Optional override for token expiry
 * @returns {string} Signed JWT token
 */
export function generateToken(userId, expiresIn = JWT_EXPIRES_IN) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid user ID string is required for token generation');
  }

  // Strict constraint: ONLY "sub" claim in payload
  const payload = {
    sub: userId,
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn,
    algorithm: 'HS256',
  });
}

/**
 * Verifies a JWT token and returns the decoded payload.
 * @param {string} token - The raw JWT token string
 * @returns {object} The verified payload containing { sub: userId, iat, exp }
 * @throws {Error} If token is invalid or expired
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token must be a non-empty string');
  }

  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
  });
}

export default {
  generateToken,
  verifyToken,
};
