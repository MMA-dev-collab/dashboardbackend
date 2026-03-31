/**
 * Logger — Winston structured logging
 *
 * Outputs:
 *  - Console: pretty-printed in development, JSON in production
 *  - File:    logs/error.log  (errors only)
 *             logs/combined.log (all levels)
 */
const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs = require('fs');

// ── Ensure logs directory exists ─────────────────────────────────
const logsDir = path.resolve(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

// ── Shared formats ───────────────────────────────────────────────
const baseFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.errors({ stack: true }),
);

const devFormat = format.combine(
  baseFormat,
  format.colorize(),
  format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}${stackStr}`;
  })
);

const prodFormat = format.combine(
  baseFormat,
  format.json()
);

// ── Create logger ────────────────────────────────────────────────
const logger = createLogger({
  level: isDev ? 'debug' : 'info',
  silent: isTest,
  format: isDev ? devFormat : prodFormat,
  transports: [
    new transports.Console(),
    new transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,  // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
    new transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 20 * 1024 * 1024,  // 20 MB
      maxFiles: 10,
      tailable: true,
    }),
  ],
});

// ── Morgan stream adapter ────────────────────────────────────────
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
