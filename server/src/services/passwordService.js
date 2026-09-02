/**
 * ==============================================================================
 * Silent SOS - Password Hashing Service (Argon2id)
 * Description: Secure password hashing and verification using the Argon2id algorithm.
 * Passwords and plaintext credentials must never be logged.
 * ==============================================================================
 */

import argon2 from 'argon2';

// Argon2id parameters suitable for development and production security
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,       // 3 iterations
  parallelism: 4,    // 4 threads
};

/**
 * Hashes a plaintext password using Argon2id.
 * @param {string} plaintextPassword - The plaintext password to hash
 * @returns {Promise<string>} The encoded Argon2id hash string
 */
export async function hashPassword(plaintextPassword) {
  if (!plaintextPassword || typeof plaintextPassword !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return await argon2.hash(plaintextPassword, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against an Argon2id hash.
 * @param {string} hash - The stored Argon2id hash
 * @param {string} plaintextPassword - The candidate password
 * @returns {Promise<boolean>} True if matching, false otherwise
 */
export async function verifyPassword(hash, plaintextPassword) {
  if (!hash || !plaintextPassword || typeof hash !== 'string' || typeof plaintextPassword !== 'string') {
    return false;
  }
  try {
    return await argon2.verify(hash, plaintextPassword);
  } catch (err) {
    // Malformed hash or verification failure returns false safely
    return false;
  }
}

export default {
  hashPassword,
  verifyPassword,
};
