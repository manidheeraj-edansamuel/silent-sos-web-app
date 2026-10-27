import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEmailStatus,
  buildTrackingUrl,
  buildAlertEmail,
  sendAlertEmail,
} from '../src/services/emailService.js';

describe('Phase C: Email Notification Service', () => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  const originalRenderExternalUrl = process.env.RENDER_EXTERNAL_URL;

  after(() => {
    if (originalAppBaseUrl === undefined) {
      delete process.env.APP_BASE_URL;
    } else {
      process.env.APP_BASE_URL = originalAppBaseUrl;
    }

    if (originalRenderExternalUrl === undefined) {
      delete process.env.RENDER_EXTERNAL_URL;
    } else {
      process.env.RENDER_EXTERNAL_URL = originalRenderExternalUrl;
    }
  });

  test('1. Reports a non-production transport when SMTP is not configured', () => {
    if (process.env.SMTP_HOST) {
      // Environment supplies a real SMTP server; the fallback cannot be asserted.
      return;
    }

    const status = getEmailStatus();
    assert.equal(status.configured, false);
    assert.ok(
      ['json', 'none'].includes(status.transport),
      `expected json/none transport, got ${status.transport}`
    );
  });

  test('2. Tracking links use APP_BASE_URL without duplicate slashes', () => {
    process.env.APP_BASE_URL = 'https://sos.example.test/';
    assert.equal(
      buildTrackingUrl('abcDEF123_-xyz'),
      'https://sos.example.test/?track=abcDEF123_-xyz'
    );
  });

  test('3. Alert email contains recipient-safe tracking link and victim name', () => {
    const email = buildAlertEmail({
      victimName: 'Ada Lovelace',
      triggeredAt: '2026-10-23T12:00:00.000Z',
      trackingToken: 'token_ABC1234567890',
    });

    assert.match(email.subject, /Ada Lovelace/);
    assert.match(email.text, /Ada Lovelace/);
    assert.match(email.html, /Ada Lovelace/);
    assert.ok(email.trackingUrl.includes('?track=token_ABC1234567890'));
    assert.ok(email.text.includes(email.trackingUrl));
    assert.ok(email.html.includes(email.trackingUrl));
    assert.match(email.text, /Fri, 23 Oct 2026/);
  });

  test('4. Victim names are HTML-escaped to prevent template injection', () => {
    const email = buildAlertEmail({
      victimName: '<script>alert("xss")</script>',
      triggeredAt: Date.now(),
      trackingToken: 'token_ABC1234567890',
    });

    assert.ok(!email.html.includes('<script>'), 'raw script tag must not appear in HTML');
    assert.ok(email.html.includes('&lt;script&gt;'));
    assert.ok(email.html.includes('&quot;xss&quot;'));
  });

  test('5. sendAlertEmail sends through the JSON transport with a message id', async () => {
    if (process.env.SMTP_HOST) return;

    const result = await sendAlertEmail({
      to: 'recipient@example.local',
      victimName: 'Grace Hopper',
      triggeredAt: '2026-10-23T12:00:00.000Z',
      trackingToken: 'token_ABC1234567890',
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.transport, 'json');
    assert.ok(result.messageId, 'expected a generated message id');
  });

  test('6. Invalid recipients and missing tokens are skipped without sending', async () => {
    const invalidRecipient = await sendAlertEmail({
      to: 'not-an-email',
      victimName: 'Grace Hopper',
      triggeredAt: Date.now(),
      trackingToken: 'token_ABC1234567890',
    });
    assert.deepEqual(invalidRecipient, { status: 'skipped', reason: 'invalid_recipient' });

    const missingToken = await sendAlertEmail({
      to: 'recipient@example.local',
      victimName: 'Grace Hopper',
      triggeredAt: Date.now(),
    });
    assert.deepEqual(missingToken, { status: 'skipped', reason: 'missing_tracking_token' });
  });

  test('7. Tracking links fall back to RENDER_EXTERNAL_URL when hosted', () => {
    const previousAppBaseUrl = process.env.APP_BASE_URL;
    delete process.env.APP_BASE_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://silent-sos.onrender.com/';

    try {
      assert.equal(
        buildTrackingUrl('abcDEF123_-xyz'),
        'https://silent-sos.onrender.com/?track=abcDEF123_-xyz'
      );
    } finally {
      process.env.APP_BASE_URL = previousAppBaseUrl;
      if (originalRenderExternalUrl === undefined) {
        delete process.env.RENDER_EXTERNAL_URL;
      } else {
        process.env.RENDER_EXTERNAL_URL = originalRenderExternalUrl;
      }
    }
  });
});
