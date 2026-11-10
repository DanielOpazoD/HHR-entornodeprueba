import type { NetlifyEventLike } from './http';

// Preserve the legacy two spellings and lowercase precedence, including empty strings.
export const readAuthorizationHeader = (event: NetlifyEventLike): string | undefined =>
  typeof event.headers?.authorization === 'string'
    ? event.headers.authorization
    : typeof event.headers?.Authorization === 'string'
      ? event.headers.Authorization
      : undefined;
