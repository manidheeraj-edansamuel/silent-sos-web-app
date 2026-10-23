import http from 'http';
import app from './app.js';
import { initSocketServer, closeSocketServer } from './services/socketService.js';
import { initQueueService, closeQueueService } from './services/queueService.js';

const PORT = parseInt(process.env.PORT, 10) || 5000;

const server = http.createServer(app);

// Initialize Socket.IO real-time gateway on the HTTP server
initSocketServer(server);

// Start the pg-boss async dispatch queue. Non-fatal: core alerting remains
// available even if the queue cannot start; the health endpoint reports it.
try {
  await initQueueService();
  console.log('[Silent SOS Server] Async dispatch queue active (pg-boss)');
} catch (err) {
  console.error('[Silent SOS Server] Queue initialization failed:', err.message);
}

server.listen(PORT, () => {
  console.log(`[Silent SOS Server] Running on http://localhost:${PORT}`);
  console.log(`[Silent SOS Server] Socket.IO Gateway active on ws://localhost:${PORT}`);
  console.log(`[Silent SOS Server] Health endpoint: http://localhost:${PORT}/api/v1/health`);
  console.log(`[Silent SOS Server] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('[Silent SOS Server] SIGTERM received. Shutting down gracefully...');
  await closeQueueService();
  await closeSocketServer();
  server.close(() => {
    console.log('[Silent SOS Server] Process terminated.');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Silent SOS Server] SIGINT received. Shutting down gracefully...');
  await closeQueueService();
  await closeSocketServer();
  server.close(() => {
    console.log('[Silent SOS Server] Process terminated.');
    process.exit(0);
  });
});

export default server;
