import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/services/passwordService.js';
import { generateToken, verifyToken } from '../src/services/tokenService.js';

describe('Security & Cryptographic Service Tests', () => {
  describe('Argon2id Password Security', () => {
    test('1. Hashes password using Argon2id algorithm format', async () => {
      const plaintext = 'SecretEmergencyPassword456!';
      const hash = await hashPassword(plaintext);

      assert.ok(typeof hash === 'string', 'Hash should be a string');
      assert.ok(hash.startsWith('$argon2id$'), 'Hash must use the Argon2id algorithm ($argon2id$)');
      assert.ok(!hash.includes(plaintext), 'Hash must never contain the plaintext password');
    });

    test('2. Successfully verifies matching password', async () => {
      const plaintext = 'CorrectHorseBatteryStaple99#';
      const hash = await hashPassword(plaintext);

      const isValid = await verifyPassword(hash, plaintext);
      assert.equal(isValid, true, 'Matching password must return true');
    });

    test('3. Rejects non-matching password safely', async () => {
      const plaintext = 'RealPassword123!';
      const wrongPassword = 'WrongPassword999!';
      const hash = await hashPassword(plaintext);

      const isValid = await verifyPassword(hash, wrongPassword);
      assert.equal(isValid, false, 'Non-matching password must return false');
    });

    test('4. Handles empty or malformed hash defensively without throwing', async () => {
      assert.equal(await verifyPassword(null, 'test'), false);
      assert.equal(await verifyPassword('', 'test'), false);
      assert.equal(await verifyPassword('invalid_hash_string', 'test'), false);
    });
  });

  describe('JWT Token Security & Minimal Claims', () => {
    test('5. JWT payload contains ONLY { sub: userId } (plus standard iat/exp claims)', () => {
      const userId = '11111111-2222-3333-4444-555555555555';
      const token = generateToken(userId);

      assert.ok(typeof token === 'string', 'Generated token should be a string');

      const decoded = verifyToken(token);
      assert.equal(decoded.sub, userId, 'Decoded token sub claim must equal user ID');

      // Enforce zero PII in payload
      assert.equal(decoded.email, undefined, 'JWT payload must NOT contain email');
      assert.equal(decoded.phone, undefined, 'JWT payload must NOT contain phone');
      assert.equal(decoded.full_name, undefined, 'JWT payload must NOT contain full_name');
      assert.equal(decoded.password, undefined, 'JWT payload must NOT contain password');
      assert.equal(decoded.role, undefined, 'JWT payload must NOT contain role');
      assert.equal(decoded.contacts, undefined, 'JWT payload must NOT contain contacts');
    });

    test('6. Rejects invalid or tampered JWT token', () => {
      const validToken = generateToken('user-123');
      const tamperedToken = validToken.slice(0, -5) + 'abcde';

      assert.throws(() => {
        verifyToken(tamperedToken);
      }, /invalid signature|jwt malformed/i);
    });

    test('7. Rejects expired JWT token', async () => {
      // Generate a token with 1ms expiry
      const shortLivedToken = generateToken('user-expired-test', '1ms');

      // Wait 10ms for expiration
      await new Promise((resolve) => setTimeout(resolve, 15));

      assert.throws(() => {
        verifyToken(shortLivedToken);
      }, /jwt expired/i);
    });
  });
});
