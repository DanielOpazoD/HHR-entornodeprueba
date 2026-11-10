export const providerErrorMessage =
  'HTTP 503 Operation timed out after 8000ms; Bearer abc.def.ghi; Cookie: sid=SYNTHETIC_COOKIE; https://x/y?access_token=SYNTHETIC_ACCESS';

export const createProviderError = () =>
  Object.assign(new Error(providerErrorMessage), {
    cause: new Error('SYNTHETIC_CAUSE'),
    config: { headers: { Authorization: 'SYNTHETIC_CONFIG' } },
    response: { data: 'SYNTHETIC_RESPONSE' },
  });

export const credentialMarkers = [
  'abc.def.ghi',
  'SYNTHETIC_COOKIE',
  'SYNTHETIC_ACCESS',
  'SYNTHETIC_CAUSE',
  'SYNTHETIC_CONFIG',
  'SYNTHETIC_RESPONSE',
];
