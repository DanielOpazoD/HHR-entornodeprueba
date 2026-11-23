/**
 * Codes that say what an error-service failure was, derived from its raw context and message.
 *
 * The error message never leaves the device, so without these an alert only says
 * `unclassified_issue`. This runs inside the lazily loaded privacy gate, not in the startup
 * bundle. It only proposes values: the gate still keeps a key only when its value is in a closed
 * list, and reports an unknown error class as `other_error`.
 */

const SOURCE_BY_CONTEXT_TYPE: Record<string, string> = {
  unhandledrejection: 'unhandled_rejection',
  error: 'uncaught_error',
};
const RENDER_CRASH_PREFIX = 'React Error Boundary:';
/** `Uncaught TypeError: …`, `Unhandled Promise Rejection: TypeError: …` or a render crash. */
const ERROR_CLASS_IN_MESSAGE =
  /^(?:Uncaught |Unhandled Promise Rejection: |React Error Boundary: )?([A-Z]\w*Error)\b/;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const withErrorServiceCause = (rawContext: unknown, rawIssues: unknown): unknown => {
  const context = record(rawContext);
  // An already sanitized payload carries the codes; deriving again keeps sanitizing idempotent.
  if (context.errorSource) return rawContext;
  const message = text(Array.isArray(rawIssues) ? rawIssues[0] : undefined) ?? '';
  const reason = record(context.reason);
  const errorName =
    text(context.errorName) ?? text(reason.name) ?? ERROR_CLASS_IN_MESSAGE.exec(message)?.[1];
  const errorCode = text(context.errorCode) ?? text(context.firebaseCode) ?? text(reason.code);
  return {
    ...context,
    errorSource: message.startsWith(RENDER_CRASH_PREFIX)
      ? 'render_crash'
      : (SOURCE_BY_CONTEXT_TYPE[text(context.type) ?? ''] ?? 'logged'),
    ...(errorName ? { errorName } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
};
