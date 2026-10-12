/**
 * ==============================================================================
 * Silent SOS - Authentication Rate Limiting Middleware
 * Description: Protects authentication endpoints (login, registration) against
 * brute-force and credential stuffing attacks using express-rate-limit.
 * ==============================================================================
 */

import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints (login/register).
 * In test environments, requests bypass the limiter to avoid interfering with automated tests.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                  // Limit each IP to 20 auth requests per windowMs
  standardHeaders: true,    // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,     // Disable `X-RateLimit-*` headers
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many authentication attempts. Please try again after 15 minutes.',
    });
  },
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                  // Limit each IP to 10 login attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
    });
  },
});

/**
 * Rate limiter for public emergency alert recipient tracking endpoints.
 * Protects against brute-force token enumeration and denial of service.
 */
export const trackingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,                  // 60 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many tracking requests. Please try again after 15 minutes.',
    });
  },
});

export default {
  authRateLimiter,
  loginRateLimiter,
  trackingRateLimiter,
};
