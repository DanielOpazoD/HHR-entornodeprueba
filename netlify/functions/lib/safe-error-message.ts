const MAX_ERROR_MESSAGE_LENGTH = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD = /^[a-z]{1,24}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Plain words joined by `_` or `-`, such as an error code or a collection name. */
const isWordCode = (value: string): boolean => value.split(/[_-]/).every(word => WORD.test(word));

/**
 * The only long values that stay in an error message: an episode or deploy id (UUID), a code made
 * of plain words, and a path whose every segment is one of those or a date. Anything else that
 * long, including a base64 value with `/` or `+`, is treated as a credential.
 */
const isReadableValue = (value: string): boolean =>
  UUID.test(value) ||
  isWordCode(value) ||
  (value.includes('/') &&
    value
      .split('/')
      .filter(Boolean)
      .every(segment => isWordCode(segment) || ISO_DATE.test(segment) || UUID.test(segment)));

/** Keep diagnostics, never serialize provider exceptions or their attached request/response. */
export const safeErrorMessage = (error: unknown, fallback = 'unknown error'): string => {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  return (
    message
      // Header values can contain spaces, multiple cookies, or arbitrary authentication schemes.
      .replace(
        /\b(Authorization|Cookie|Set-Cookie)(["']?\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi,
        '$1$2[redacted]'
      )
      .replace(/\bBearer\s+(?!token\.(?:\s|$))[a-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(
        /\b(access_token|token|key|password|secret|session)(\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&#;,"']+)/gi,
        '$1$2[redacted]'
      )
      .replace(/\b([a-z0-9_-]+)\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, (value, header: string) => {
        // A JWT has a JSON JOSE header; dotted RUTs and hostnames are diagnostics.
        try {
          const decoded: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
          return decoded && typeof decoded === 'object' && 'alg' in decoded ? '[redacted]' : value;
        } catch {
          return value;
        }
      })
      // Any long unbroken value is redacted unless it is plainly readable (see isReadableValue).
      .replace(/[a-z0-9_+/-]{32,}={0,2}/gi, value =>
        isReadableValue(value) ? value : '[redacted]'
      )
      .slice(0, MAX_ERROR_MESSAGE_LENGTH)
  );
};

/** For server logs: the stack locates the failure, and goes through the same redaction. */
export const safeErrorLog = (error: unknown): string =>
  safeErrorMessage(error instanceof Error ? (error.stack ?? error.message) : error);
