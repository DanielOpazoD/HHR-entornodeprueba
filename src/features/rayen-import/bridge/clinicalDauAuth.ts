export interface ClinicalDauAuth {
  flowId: string;
  url: string;
  reason?: 'profile';
}

/** Only the packaged extension's login page may receive credentials. */
export const decodeClinicalDauAuth = (value: unknown): ClinicalDauAuth | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  if (!('flowId' in value) || typeof value.flowId !== 'string') return;
  if (!('url' in value) || typeof value.url !== 'string') return;
  if (!/^[0-9a-f-]{36}$/.test(value.flowId)) return;
  try {
    const url = new URL(value.url);
    if (
      url.protocol !== 'chrome-extension:' ||
      !/^[a-p]{32}$/.test(url.hostname) ||
      url.pathname !== '/urgency-login.html' ||
      url.username ||
      url.password ||
      url.hash ||
      Array.from(url.searchParams.keys()).length !== 1 ||
      url.searchParams.get('flow') !== value.flowId
    )
      return;
    return {
      flowId: value.flowId,
      url: url.href,
      ...('reason' in value && value.reason === 'profile' ? { reason: 'profile' as const } : {}),
    };
  } catch {
    return;
  }
};
