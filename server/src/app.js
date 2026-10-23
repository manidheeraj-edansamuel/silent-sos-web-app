import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import contactsRouter from './routes/contacts.js';
import alertsRouter from './routes/alerts.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../../client/dist');

const app = express();

// Security middleware - Helmet
// CSP relaxed for Leaflet OpenStreetMap tiles and same-origin Socket.IO WebSockets
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
      },
    },
  })
);

// Serve the production client build when present (single-service local deployment).
// Registered before CORS: static assets and the SPA shell are public same-origin
// files and must not be subject to the API's cross-origin policy.
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA fallback for non-API routes (e.g. recipient tracking portal query URLs)
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// CORS configuration
// Includes the server's own origin(s) so a same-origin production deployment
// (client served by this Express server) passes same-origin POST/WebSocket checks.
const serverPort = parseInt(process.env.PORT, 10) || 5000;
const allowedOrigins = [
  ...(process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
  `http://localhost:${serverPort}`,
  `http://127.0.0.1:${serverPort}`,
]
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
);

// Request body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Request logging
// Tracking tokens grant access to live location data, so they are redacted
// before any URL is written to the request log.
morgan.token('url', (req) => {
  const url = req.originalUrl || req.url || '';
  return url
    .replace(/(\/alerts\/track\/)[^/?#]+/gi, '$1[redacted]')
    .replace(/([?&]track=)[^&#]+/gi, '$1[redacted]');
});

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// API Routes
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/contacts', contactsRouter);
app.use('/api/v1/alerts', alertsRouter);

// 404 & Global Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
