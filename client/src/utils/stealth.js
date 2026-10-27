const PIN_HASH_KEY = 'silent_sos_stealth_pin_hash';
const PIN_LENGTH_KEY = 'silent_sos_stealth_pin_length';

export const STEALTH_PIN_PATTERN = /^\d{4,8}$/;

export function getStealthPin() {
  const hash = localStorage.getItem(PIN_HASH_KEY);
  const length = Number.parseInt(localStorage.getItem(PIN_LENGTH_KEY) || '0', 10);
  if (!hash || !Number.isInteger(length) || length < 4 || length > 8) return null;
  return { hash, length };
}

export function isStealthPinConfigured() {
  return getStealthPin() !== null;
}

export function clearStealthPin() {
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_LENGTH_KEY);
}

export async function hashStealthPin(pin) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Stealth PIN requires a secure context (HTTPS or localhost).');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function saveStealthPin(pin) {
  if (!STEALTH_PIN_PATTERN.test(pin)) {
    throw new Error('PIN must be 4 to 8 digits.');
  }
  const hash = await hashStealthPin(pin);
  localStorage.setItem(PIN_HASH_KEY, hash);
  localStorage.setItem(PIN_LENGTH_KEY, String(pin.length));
  return { hash, length: pin.length };
}
