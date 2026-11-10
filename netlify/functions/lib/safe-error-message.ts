const MAX_ERROR_MESSAGE_LENGTH = 2000;

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
      // Require the whole contiguous value, including base64 padding, to disappear.
      .replace(/[a-z0-9_+/-]{32,}={0,2}/gi, '[redacted]')
      .slice(0, MAX_ERROR_MESSAGE_LENGTH)
  );
};
