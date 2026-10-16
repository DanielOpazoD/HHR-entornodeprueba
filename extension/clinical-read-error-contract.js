/** Stable source codes; messages remain compatible with older HHR clients. */
(function (root) {
  'use strict';

  const create = (kind, message, details = {}) => {
    const error = new Error(message);
    error.kind = kind;
    return Object.assign(error, details);
  };
  const classify = error => {
    if (error.kind === 'session' || error.status === 401) return 'session_required';
    if (error.status === 403) return 'permission_denied';
    if (error.kind === 'invalid-json' || error.kind === 'invalid-buffer') return 'invalid_response';
    if (error.cause?.name === 'AbortError' || error.cause?.name === 'TimeoutError' ||
        error.cause?.code === 'source_timeout') return 'source_timeout';
    return error.kind === 'network' || error.kind === 'http' ? 'source_unavailable' : 'unexpected';
  };
  root.HhrClinicalReadErrors = Object.freeze({ create, classify });
})(typeof self !== 'undefined' ? self : globalThis);
