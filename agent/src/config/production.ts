/**
 * In production these aren't optional: without AGENT_ADMIN_TOKEN the admin API is open to anyone on the
 * internet, without STUDY_JWT_SECRET the study routes are, and without STUDY_ALLOWED_ORIGINS no browser
 * could reach the agent. Better to refuse to boot than to run half-protected.
 */
export function productionEnvProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const name of ['AGENT_ADMIN_TOKEN', 'STUDY_JWT_SECRET']) {
    if (!env[name]) problems.push(`${name} is required`);
    else if (env[name]!.length < 32) problems.push(`${name} must be at least 32 characters`);
  }
  if (!allowedOrigins(env).length) problems.push('STUDY_ALLOWED_ORIGINS is required (the app URL)');
  return problems;
}

export function assertProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionEnvProblems(env);
  if (problems.length) throw new Error(`Refusing to start in production:\n  ${problems.join('\n  ')}`);
}

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.STUDY_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * The CORS origin to allow, or null. Production: only STUDY_ALLOWED_ORIGINS. Development: those plus
 * localhost, or any origin when no list is set (nothing is deployed, and tokens still guard the routes).
 */
export function corsOrigin(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!origin) return null;
  const list = allowedOrigins(env);
  if (list.includes(origin)) return origin;
  if (env.NODE_ENV === 'production') return null;
  return list.length === 0 || LOCALHOST.test(origin) ? origin : null;
}
