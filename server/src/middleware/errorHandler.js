/**
 * 404 Not Found Middleware
 */
export const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
  });
};

/**
 * Global Error Handler Middleware
 */
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';

  // Do not log sensitive credentials or data in error logs
  console.error(`[Error] ${req.method} ${req.originalUrl} - ${err.message}`);

  res.status(statusCode).json({
    status: 'error',
    message: statusCode === 500 && !isDev ? 'Internal Server Error' : err.message,
    ...(isDev && { stack: err.stack }),
  });
};
