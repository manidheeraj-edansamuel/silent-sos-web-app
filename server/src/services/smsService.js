/**
 * ==============================================================================
 * Silent SOS - SMS Notification Service
 * Description: Sends emergency alert SMS messages to emergency contacts through
 * Twilio's REST API. Delivery is disabled unless all three Twilio environment
 * variables are configured, so development and tests never contact a carrier.
 *
 * Security notes:
 * - Phone numbers and tracking tokens are never logged.
 * - The tracking token is embedded in the tracking URL, not stored here.
 * - Errors propagate to the queue so failed sends can be retried.
 * ==============================================================================
 */

import { buildTrackingUrl } from './emailService.js';

const PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

function getConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim();
  const configured = Boolean(accountSid && authToken && fromNumber);
  return { accountSid, authToken, fromNumber, configured };
}

/**
 * Public, non-secret SMS subsystem status for the health endpoint.
 * @returns {{ configured: boolean, transport: 'twilio'|'none' }}
 */
export function getSmsStatus() {
  const { configured } = getConfig();
  return { configured, transport: configured ? 'twilio' : 'none' };
}

/**
 * Normalizes user-entered phone numbers to E.164. Returns null when the value
 * cannot be safely converted (e.g. missing country code).
 */
export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\s().-]/g, '');
  return PHONE_REGEX.test(normalized) ? normalized : null;
}

/**
 * Builds a compact emergency SMS. Kept short enough for a single SMS segment
 * whenever the victim name is reasonable.
 * @param {{ victimName: string, triggeredAt: string|Date, trackingToken: string }} params
 */
export function buildAlertSms({ victimName, triggeredAt, trackingToken }) {
  const name = String(victimName || 'A contact').slice(0, 80);
  const triggeredDate = new Date(triggeredAt);
  const triggeredLabel = isNaN(triggeredDate.getTime())
    ? 'just now'
    : triggeredDate.toUTCString();
  const trackingUrl = buildTrackingUrl(trackingToken);

  return {
    body: `SILENT SOS: ${name} triggered an emergency alert at ${triggeredLabel}. Live location: ${trackingUrl}`,
    trackingUrl,
  };
}

async function defaultSendSms({ to, from, body }) {
  const { accountSid, authToken } = getConfig();
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    }
  );

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(payload?.message || `Twilio request failed with status ${res.status}`);
    err.statusCode = res.status;
    throw err;
  }

  return { sid: payload?.sid || null, status: payload?.status || null };
}

/**
 * Sends one emergency alert SMS.
 * @param {{ to: string, victimName: string, triggeredAt: string|Date, trackingToken: string,
 *           sendFn?: Function }} params
 * @returns {Promise<{ status: 'sent', messageId: string|null, transport: string }
 *   | { status: 'skipped', reason: string }>}
 * @throws on transport failure so the queue can retry
 */
export async function sendAlertSms({
  to,
  victimName,
  triggeredAt,
  trackingToken,
  sendFn,
}) {
  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) {
    return { status: 'skipped', reason: 'invalid_recipient' };
  }

  if (!trackingToken || typeof trackingToken !== 'string') {
    return { status: 'skipped', reason: 'missing_tracking_token' };
  }

  const config = getConfig();
  const sender = sendFn || defaultSendSms;
  if (!sendFn && !config.configured) {
    return { status: 'skipped', reason: 'sms_not_configured' };
  }

  const { body } = buildAlertSms({ victimName, triggeredAt, trackingToken });
  const result = await sender({ to: normalizedTo, from: config.fromNumber, body });

  return { status: 'sent', messageId: result?.sid || null, transport: 'twilio' };
}

/**
 * Masked destination for the delivery ledger, e.g. +15***9001.
 * @param {string} phone
 */
export function maskPhoneNumber(phone) {
  const normalized = normalizePhoneNumber(phone) || String(phone || '');
  if (normalized.length < 8) return '[redacted]';
  return `${normalized.slice(0, 3)}***${normalized.slice(-4)}`;
}

export default {
  getSmsStatus,
  normalizePhoneNumber,
  buildAlertSms,
  sendAlertSms,
  maskPhoneNumber,
};
