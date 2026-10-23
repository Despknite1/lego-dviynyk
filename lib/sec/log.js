// Structured logging (pino). Never log passwords, tokens, codes, cookies or PII.
const pino = require('pino');
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { svc: 'lego-dviynyk' },
  redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]', '*.password', '*.new_password', '*.code', '*.token', '*.email', '*.backup_email', '*.phone', '*.image', '*.crop'], censor: '[redacted]' },
});
module.exports = logger;
