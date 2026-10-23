/**
 * ==============================================================================
 * Silent SOS - Email Notification Service
 * Description: Sends emergency alert emails to registered recipient contacts.
 * Uses SMTP when configured; falls back to nodemailer's JSON transport outside
 * production so local development and tests never require a mail server.
 *
 * Security notes:
 * - Tracking tokens are embedded in the tracking URL and never logged.
 * - Recipient addresses are never included in audit records or logs.
 * - Victim display names are HTML-escaped before template interpolation.
 * ==============================================================================
 */

import nodemailer from 'nodemailer';

let transportInstance = null;
let transportMode = null;

function resolveTransport() {
  if (transportInstance !== null || transportMode === 'none') {
    return { transport: transportInstance, mode: transportMode };
  }

  const host = process.env.SMTP_HOST;
  if (host) {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const secure =
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE === 'true'
        : port === 465;

    const auth =
      process.env.SMTP_USER || process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' }
        : undefined;

    transportInstance = nodemailer.createTransport({ host, port, secure, auth });
    transportMode = 'smtp';
    return { transport: transportInstance, mode: transportMode };
  }

  // Production must never silently pretend an email was delivered.
  if (process.env.NODE_ENV === 'production') {
    transportMode = 'none';
    return { transport: null, mode: transportMode };
  }

  transportInstance = nodemailer.createTransport({ jsonTransport: true });
  transportMode = 'json';
  return { transport: transportInstance, mode: transportMode };
}

/**
 * Public, non-secret email subsystem status for the health endpoint.
 * @returns {{ configured: boolean, transport: 'smtp'|'json'|'none' }}
 */
export function getEmailStatus() {
  const { mode } = resolveTransport();
  return { configured: mode === 'smtp', transport: mode };
}

function getAppBaseUrl() {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const port = process.env.PORT || '5000';
  return `http://localhost:${port}`;
}

export function buildTrackingUrl(trackingToken) {
  return `${getAppBaseUrl()}/?track=${encodeURIComponent(trackingToken)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds the emergency notification content. Pure and deterministic so the
 * wording and escaping can be verified without sending mail.
 * @param {{ victimName: string, triggeredAt: string|Date, trackingToken: string }} params
 */
export function buildAlertEmail({ victimName, triggeredAt, trackingToken }) {
  const safeName = escapeHtml(victimName || 'Someone you know');
  const trackingUrl = buildTrackingUrl(trackingToken);
  const triggeredDate = new Date(triggeredAt);
  const triggeredLabel = isNaN(triggeredDate.getTime())
    ? 'just now'
    : triggeredDate.toUTCString();

  const subject = `Emergency SOS alert from ${victimName || 'a contact'}`;

  const text = [
    'EMERGENCY SOS ALERT',
    '',
    `${victimName || 'Someone you know'} triggered a Silent SOS emergency alert at ${triggeredLabel}.`,
    '',
    'Follow their live location here:',
    trackingUrl,
    '',
    'This link is private and unguessable. Do not share it publicly.',
    'If you cannot reach them, contact local emergency services immediately.',
    '',
    'Silent SOS',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border-top:4px solid #dc2626;">
      <h1 style="margin:0 0 16px;font-size:22px;color:#b91c1c;">Emergency SOS Alert</h1>
      <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
        <strong>${safeName}</strong> triggered a Silent SOS emergency alert at ${escapeHtml(triggeredLabel)}.
      </p>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
        Follow their live location on the tracking map:
      </p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(trackingUrl)}"
           style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">
          Open live tracking map
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#4b5563;">
        This link is private and unguessable. Do not share it publicly.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#4b5563;">
        If you cannot reach them, contact local emergency services immediately.
      </p>
    </div>
  </body>
</html>`;

  return { subject, text, html, trackingUrl };
}

/**
 * Sends one emergency alert email.
 * @param {{ to: string, victimName: string, triggeredAt: string|Date, trackingToken: string }} params
 * @returns {Promise<{ status: 'sent', messageId: string, transport: string }
 *   | { status: 'skipped', reason: string }>}
 * @throws on transport failure so the queue can retry
 */
export async function sendAlertEmail({ to, victimName, triggeredAt, trackingToken }) {
  if (!to || typeof to !== 'string' || !to.includes('@')) {
    return { status: 'skipped', reason: 'invalid_recipient' };
  }

  if (!trackingToken || typeof trackingToken !== 'string') {
    return { status: 'skipped', reason: 'missing_tracking_token' };
  }

  const { transport, mode } = resolveTransport();
  if (!transport) {
    return { status: 'skipped', reason: 'smtp_not_configured' };
  }

  const { subject, text, html } = buildAlertEmail({ victimName, triggeredAt, trackingToken });

  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM || '"Silent SOS" <no-reply@silent-sos.local>',
    to,
    subject,
    text,
    html,
  });

  return { status: 'sent', messageId: info.messageId || null, transport: mode };
}

export default {
  getEmailStatus,
  buildTrackingUrl,
  buildAlertEmail,
  sendAlertEmail,
};
