import app from './app.js';

const PORT = parseInt(process.env.PORT, 10) || 5000;

const server = app.listen(PORT, () => {
  console.log(`[Silent SOS Server] Running on http://localhost:${PORT}`);
  console.log(`[Silent SOS Server] Health endpoint: http://localhost:${PORT}/api/v1/health`);
  console.log(`[Silent SOS Server] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('[Silent SOS Server] SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('[Silent SOS Server] Process terminated.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Silent SOS Server] SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('[Silent SOS Server] Process terminated.');
    process.exit(0);
  });
});

export default server;
