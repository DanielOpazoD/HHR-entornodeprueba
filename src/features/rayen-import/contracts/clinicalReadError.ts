/** Additive wire contract: messages are presentation; codes select recovery. */
export const CLINICAL_READ_ERROR_CODES = [
  'episode_not_authorized',
  'session_required',
  'permission_denied',
  'source_timeout',
  'source_unavailable',
  'invalid_request',
  'invalid_response',
  'unexpected',
] as const;
export type ClinicalReadErrorCode = (typeof CLINICAL_READ_ERROR_CODES)[number];
export interface ClinicalReadFailure {
  error?: string;
  errorCode?: ClinicalReadErrorCode;
}

/** Only a missing code permits legacy decoding. Unknown/new codes never authorize recovery. */
export const decodeClinicalReadFailure = (
  data: { error?: unknown; errorCode?: unknown },
  fallback?: string
): ClinicalReadFailure => {
  const message = typeof data.error === 'string' && data.error ? data.error : fallback;
  if (data.errorCode !== undefined) {
    const code = CLINICAL_READ_ERROR_CODES.find(value => value === data.errorCode);
    return {
      error: message || 'No se pudo verificar la fuente clínica.',
      errorCode: code ?? 'unexpected',
    };
  }
  if (!message) return {};
  if (!data.error && fallback) return { error: message, errorCode: 'invalid_response' };
  const code: ClinicalReadErrorCode =
    message === 'Las escalas no fueron autorizadas para el episodio de esta pestaña.' ||
    message === 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.'
      ? 'episode_not_authorized'
      : /tiempo de espera agotado|timeout|timed out/i.test(message)
        ? 'source_timeout'
        : /sin token de Ficha Médico|inicia sesión|HTTP 401\b/i.test(message)
          ? 'session_required'
          : /HTTP 403\b/i.test(message)
            ? 'permission_denied'
            : 'source_unavailable';
  return { error: message, errorCode: code };
};
