import pino from 'pino';
const level = (process.env.LOG_LEVEL ?? 'info') as pino.Level;
export const log = pino({
  level,
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  redact: {
    paths: [
      '*.token',
      '*.apiKey',
      '*.managementKey',       // FR9: user 0G keys
      '*.zerogApiKey',
      'managementKey',
      'zerogApiKey',
      '*.botToken',
      '*.apiKeyEnv',           // env-var names are not secret but PATCH bodies might include real keys
      'token',
      'apiKey',
      'config.llm.apiKey',
      'err.config.headers.authorization',
      'req.headers.authorization',
    ],
    remove: true,
  },
});
