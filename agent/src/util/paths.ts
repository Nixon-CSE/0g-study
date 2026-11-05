import fs from 'node:fs';
import path from 'node:path';

/** Ensure `target` is inside `root` after realpath; throws if not.
 *  Tolerates non-existent targets by realpathing the longest existing prefix. */
export function assertInside(root: string, target: string): string {
  const rRoot = fs.realpathSync(root);
  const abs = path.resolve(root, target);
  // realpath only the longest existing prefix
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const rProbe = fs.realpathSync(probe);
  const tail = path.relative(probe, abs);
  const rTarget = tail ? path.join(rProbe, tail) : rProbe;
  if (!rTarget.startsWith(rRoot + path.sep) && rTarget !== rRoot) {
    throw new Error(`path escapes root: ${target}`);
  }
  return rTarget;
}
