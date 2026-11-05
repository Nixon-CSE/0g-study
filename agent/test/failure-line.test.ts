import { describe, it, expect } from 'vitest';
import { failureLine } from '../src/runtime/agent.js';

describe('failureLine (NFR2)', () => {
  it('is generic when there was no error (empty model output)', () => {
    expect(failureLine(null)).toContain("couldn't form a reply");
  });
  it('names 0G on network failures', () => {
    const e = Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
    expect(failureLine(e)).toContain("couldn't reach 0G Private Computer");
  });
  it('names 0G on upstream HTTP errors, with specific text for auth and rate limits', () => {
    expect(failureLine(Object.assign(new Error('Not Found'), { statusCode: 404 }))).toContain("couldn't reach 0G");
    expect(failureLine(Object.assign(new Error('Unauthorized'), { statusCode: 401 }))).toContain('API key');
    expect(failureLine(Object.assign(new Error('Too Many'), { statusCode: 429 }))).toContain('rate-limiting');
    expect(failureLine(Object.assign(new Error('Payment Required'), { statusCode: 402 }))).toContain('Top it up');
  });
  it('stays generic for unrelated errors', () => {
    expect(failureLine(new Error('something odd'))).toContain("couldn't form a reply");
  });
});
