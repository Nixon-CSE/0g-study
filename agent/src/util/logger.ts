import pino from 'pino';
const level = (process.env.LOG_LEVEL ?? 'info') as pino.Level;

const KEY_PATTERN = /\b(sk|mk)-[A-Za-z0-9_-]{8,}/g;

/** Mask anything shaped like a 0G key, wherever it sits in what is about to be logged. */
export function scrubKeys<T>(v: T, depth = 0): T {
  if (typeof v === 'string') return v.replace(KEY_PATTERN, '$1-[redacted]') as T;
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (v instanceof Error) {
    const copy = new Error(scrubKeys(v.message));
    copy.name = v.name;
    copy.stack = scrubKeys(v.stack ?? '');
    if (v.cause !== undefined) copy.cause = scrubKeys(v.cause, depth + 1);
    const code = (v as { code?: unknown }).code;
    if (code !== undefined) (copy as { code?: unknown }).code = code;
    return copy as T;
  }
  if (Array.isArray(v)) return v.map((x) => scrubKeys(x, depth + 1)) as T;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubKeys(x, depth + 1)])) as T;
}

/** Shared by `log` and the tests. Field names are redacted by path; values by pattern, as a backstop. */
export const LOG_OPTIONS: pino.LoggerOptions = {
  formatters: { log: (o) => scrubKeys(o) },
  hooks: {
    logMethod(args, method) {
      // log.error(err) makes pino reuse err.message as msg, past the formatter, so pass it scrubbed.
      const first: unknown = args[0];
      if (first instanceof Error) {
        const rest = args.slice(1) as unknown[];
        const msg = typeof rest[0] === 'string' ? rest[0] : first.message;
        return method.call(this, { err: first }, scrubKeys(msg));
      }
      method.apply(this, args.map((a) => (typeof a === 'string' ? scrubKeys(a) : a)) as Parameters<typeof method>);
    },
  },
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
};

export const log = pino({
  ...LOG_OPTIONS,
  level,
  transport: process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
});
