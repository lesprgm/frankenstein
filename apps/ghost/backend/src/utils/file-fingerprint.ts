import crypto from 'node:crypto';

/**
 * Compute a stable fingerprint for a file based on path, size, and modified time.
 * Any change to these fields yields a different hash, enabling skip-on-unchanged checks.
 */
export function computeFileFingerprint(
  filePath: string,
  size?: number,
  modified?: string | number | Date
): string {
  const mod =
    modified instanceof Date
      ? modified.toISOString()
      : typeof modified === 'number'
      ? new Date(modified).toISOString()
      : modified || '';
  const basis = `${filePath}|${size ?? 'unknown'}|${mod}`;
  return crypto.createHash('md5').update(basis).digest('hex');
}
