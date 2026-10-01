import type { NextFunction, Request, Response } from 'express';

/** Lower-cases and drops a trailing slash so ".env" typos like "https://Site/" still match. */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Decides whether a request's Origin header is acceptable.
 *
 * Browsers send Origin on every POST/PUT/PATCH/DELETE, even same-origin ones.
 * The frontend reaches this API through its Next.js rewrite proxy, which passes
 * the browser's Origin through and sets X-Forwarded-Host to the host the user
 * opened (req.host reads it only when the proxy is trusted — see TRUST_PROXY).
 * So a request is allowed when:
 *  - it has no Origin (same-origin GET, server-to-server, curl), or
 *  - its Origin is listed in CORS_ORIGINS, or
 *  - its Origin is the very host the user opened (same-origin via the proxy),
 *    which keeps the site working even if CORS_ORIGINS misses a domain/IP alias.
 * A page on another site still fails: its Origin never matches our host.
 */
export function isOriginAllowed(
  origin: string | undefined,
  requestHost: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.includes(normalized)) return true;
  if (!requestHost) return false;
  try {
    const originUrl = new URL(normalized);
    // Re-parse the host with the origin's scheme so default ports compare equal
    // (e.g. Host "site:443" vs Origin "https://site").
    const requestUrl = new URL(`${originUrl.protocol}//${requestHost}`);
    return originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

/** Rejects disallowed origins with a 403 in the API's usual error envelope (not a 500). */
export function createOriginGuard(allowedOrigins: readonly string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isOriginAllowed(req.headers.origin, req.host, allowedOrigins)) {
      next();
      return;
    }
    console.warn(
      `Blocked request from origin "${req.headers.origin}" (host "${req.host}"). Add it to CORS_ORIGINS if it is legitimate.`,
    );
    res.status(403).json({
      success: false,
      message: 'ไม่อนุญาตให้เข้าถึงจากโดเมนนี้',
      errors: [],
    });
  };
}
