/**
 * ==============================================================================
 * Silent SOS - Allowed Origin Resolution
 * Description: Single source of truth for HTTP CORS and Socket.IO handshake
 * origins, including the public URL of a hosted deployment.
 * ==============================================================================
 */

function normalizeOrigin(origin) {
  return origin.trim().replace(/\/+$/, '');
}

/**
 * Resolve the browser origins allowed to call the API or open a WebSocket.
 * CORS_ORIGIN is a comma-separated allowlist. Hosted deployments also allow
 * their own public URL (Render exposes RENDER_EXTERNAL_URL at runtime), and the
 * local development origins stay available.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
export function getAllowedOrigins(env = process.env) {
  const port = parseInt(env.PORT, 10) || 5000;

  return [
    ...(env.CORS_ORIGIN || 'http://localhost:5173').split(','),
    env.RENDER_EXTERNAL_URL || '',
    env.APP_BASE_URL || '',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]
    .map(normalizeOrigin)
    .filter(Boolean);
}

/**
 * @param {string|undefined} origin - Origin header from the browser
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isOriginAllowed(origin, env = process.env) {
  // Non-browser clients (curl, server-to-server, native apps) send no Origin.
  if (!origin) return true;

  const allowed = getAllowedOrigins(env);
  return allowed.includes('*') || allowed.includes(normalizeOrigin(origin));
}

export default {
  getAllowedOrigins,
  isOriginAllowed,
};
