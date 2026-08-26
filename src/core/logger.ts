import pino from 'pino';

export const logger = pino({
  name: 'pepsa-admin-backend',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers.set-cookie',
      '*.password',
      '*.token',
      'req.body.password',
      'req.body.temporaryPassword',
      'req.body.token',
      'req.body.code',
      'req.body.payload.secret',
      'req.body.payload.apiKey',
    ],
    censor: '[REDACTED]',
  },
});
