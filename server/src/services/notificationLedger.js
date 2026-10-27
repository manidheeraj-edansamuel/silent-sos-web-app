/**
 * ==============================================================================
 * Silent SOS - Notification Delivery Ledger
 * Description: Persists per-recipient delivery receipts to notification_attempts.
 * Destinations are masked before storage so the ledger never becomes a second
 * copy of contact PII, and provider errors are scrubbed of recipients/tokens.
 * ==============================================================================
 */

import { query } from '../config/database.js';

export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '[redacted]';
  const [local, domain] = email.trim().split('@');
  if (!local || !domain) return '[redacted]';
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(phone) {
  if (typeof phone !== 'string') return '[redacted]';
  const normalized = phone.trim().replace(/[\s().-]/g, '');
  if (normalized.length < 8) return '[redacted]';
  return `${normalized.slice(0, 3)}***${normalized.slice(-4)}`;
}

export function maskDestination(channel, destination) {
  return channel === 'sms' ? maskPhone(destination) : maskEmail(destination);
}

export function sanitizeErrorMessage(message, secrets = []) {
  let sanitized = String(message || 'delivery_failed');
  for (const secret of secrets) {
    if (!secret) continue;
    sanitized = sanitized.split(String(secret)).join('[redacted]');
  }
  return sanitized.slice(0, 500);
}

/**
 * Writes one delivery receipt. Ledger failures are logged and swallowed so an
 * audit-side problem can never block an emergency notification.
 */
export async function recordNotificationAttempt({
  alertId,
  contactId,
  channel,
  destination,
  status,
  providerMessageId = null,
  attemptNumber = 1,
  errorMessage = null,
}) {
  try {
    await query(
      `INSERT INTO notification_attempts (
         alert_id, emergency_contact_id, channel, destination, status,
         provider_message_id, attempt_number, error_message, attempted_at, delivered_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9);`,
      [
        alertId,
        contactId,
        channel,
        maskDestination(channel, destination),
        status,
        providerMessageId,
        attemptNumber,
        errorMessage,
        status === 'sent' ? new Date() : null,
      ]
    );
  } catch (err) {
    // Contact ids only: destinations and tokens must not reach the log.
    console.error(
      `[Ledger] Failed to record ${channel} attempt for alert ${alertId}, contact ${contactId}:`,
      err.message
    );
  }
}

export default {
  maskEmail,
  maskPhone,
  maskDestination,
  sanitizeErrorMessage,
  recordNotificationAttempt,
};
