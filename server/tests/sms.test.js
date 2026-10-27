import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlertSms,
  getSmsStatus,
  maskPhoneNumber,
  normalizePhoneNumber,
  sendAlertSms,
} from '../src/services/smsService.js';

describe('Phase C: SMS Notification Service', () => {
  const originalEnv = {
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
  };

  before(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
  });

  after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('1. Reports an unconfigured transport without Twilio credentials', () => {
    const status = getSmsStatus();
    assert.equal(status.configured, false);
    assert.equal(status.transport, 'none');
  });

  test('2. Normalizes formatted phone numbers to E.164 and rejects unsafe input', () => {
    assert.equal(normalizePhoneNumber('+1 (555) 019-9001'), '+15550199001');
    assert.equal(normalizePhoneNumber('+44 20 7946 0958'), '+442079460958');
    assert.equal(normalizePhoneNumber('555-019-9001'), null, 'missing country code must be rejected');
    assert.equal(normalizePhoneNumber('not-a-phone'), null);
    assert.equal(normalizePhoneNumber(null), null);
  });

  test('3. Builds an emergency SMS containing the private tracking link', () => {
    const { body, trackingUrl } = buildAlertSms({
      victimName: 'Jane Doe',
      triggeredAt: '2026-10-27T07:00:00.000Z',
      trackingToken: 'testtoken1234567890',
    });

    assert.ok(body.startsWith('SILENT SOS: Jane Doe'));
    assert.ok(body.includes(trackingUrl));
    assert.ok(trackingUrl.includes('?track=testtoken1234567890'));
    assert.ok(body.length < 320, 'SMS should stay within two segments');
  });

  test('4. Sends through the injected transport with normalized values', async () => {
    process.env.TWILIO_FROM_NUMBER = '+15550199000';
    const calls = [];

    const result = await sendAlertSms({
      to: '+1 (555) 123-4567',
      victimName: 'Jane Doe',
      triggeredAt: new Date().toISOString(),
      trackingToken: 'testtoken1234567890',
      sendFn: async (payload) => {
        calls.push(payload);
        return { sid: 'SM_test_123', status: 'queued' };
      },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.messageId, 'SM_test_123');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to, '+15551234567');
    assert.equal(calls[0].from, '+15550199000');
    assert.ok(calls[0].body.includes('?track=testtoken1234567890'));
  });

  test('5. Skips invalid recipients and missing tokens without invoking the sender', async () => {
    let called = false;
    const sendFn = async () => {
      called = true;
      return { sid: 'never' };
    };

    const invalid = await sendAlertSms({
      to: '555-1234',
      victimName: 'Jane',
      triggeredAt: new Date(),
      trackingToken: 'testtoken1234567890',
      sendFn,
    });
    assert.equal(invalid.status, 'skipped');
    assert.equal(invalid.reason, 'invalid_recipient');

    const missingToken = await sendAlertSms({
      to: '+15551234567',
      victimName: 'Jane',
      triggeredAt: new Date(),
      trackingToken: '',
      sendFn,
    });
    assert.equal(missingToken.status, 'skipped');
    assert.equal(missingToken.reason, 'missing_tracking_token');
    assert.equal(called, false);
  });

  test('6. Skips delivery when Twilio is not configured', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;

    const result = await sendAlertSms({
      to: '+15551234567',
      victimName: 'Jane',
      triggeredAt: new Date(),
      trackingToken: 'testtoken1234567890',
    });

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'sms_not_configured');
  });

  test('7. Propagates transport failures so the queue can retry', async () => {
    await assert.rejects(
      () =>
        sendAlertSms({
          to: '+15551234567',
          victimName: 'Jane',
          triggeredAt: new Date(),
          trackingToken: 'testtoken1234567890',
          sendFn: async () => {
            throw new Error('carrier unavailable');
          },
        }),
      /carrier unavailable/
    );
  });

  test('8. Masks phone numbers for the delivery ledger', () => {
    assert.equal(maskPhoneNumber('+15550199001'), '+15***9001');
    assert.equal(maskPhoneNumber('bad'), '[redacted]');
  });
});
