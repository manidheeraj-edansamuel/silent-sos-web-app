import http from 'http';
import app from './app.js';
import { initSocketServer, closeSocketServer } from './services/socketService.js';

const PORT = parseInt(process.env.PORT, 10) || 5000;

const server = http.createServer(app);

// Initialize Socket.IO real-time gateway on the HTTP server
initSocketServer(server);

server.listen(PORT, () => {
  console.log(`[Silent SOS Server] Running on http://localhost:${PORT}`);
  console.log(`[Silent SOS Server] Socket.IO Gateway active on ws://localhost:${PORT}`);
  console.log(`[Silent SOS Server] Health endpoint: http://localhost:${PORT}/api/v1/health`);
  console.log(`[Silent SOS Server] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('[Silent SOS Server] SIGTERM received. Shutting down gracefully...');
  await closeSocketServer();
  server.close(() => {
    console.log('[Silent SOS Server] Process terminated.');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Silent SOS Server] SIGINT received. Shutting down gracefully...');
  await closeSocketServer();
  server.close(() => {
    console.log('[Silent SOS Server] Process terminated.');
    process.exit(0);
  });
});

export default server;
