import { decodeClinicalReadFailure } from '../contracts/clinicalReadError';

export const decodeClinicalReadRejection = (failure: unknown) => {
  const value = failure && typeof failure === 'object' ? failure : {};
  return decodeClinicalReadFailure({
    error: 'error' in value ? value.error : 'message' in value ? value.message : String(failure),
    errorCode: 'errorCode' in value ? value.errorCode : undefined,
  });
};

/** Cancellation and permanent refusals must not start another source request. */
export const canRetryClinicalRead = (failure: unknown): boolean => {
  if (failure && typeof failure === 'object' && 'name' in failure && failure.name === 'AbortError')
    return false;
  const code = decodeClinicalReadRejection(failure).errorCode;
  return code !== 'permission_denied' && code !== 'invalid_request' && code !== 'unexpected';
};

/**
 * Una lectura clínica que falla (timeout de 30 s, pestaña de Rayen ocupada,
 * service worker reciclado) se reintenta UNA vez, re-encolándose en su
 * compuerta de concurrencia para no retener el cupo mientras espera. En el run
 * medido del 31-08-2026, 12 de 69 lecturas agotaron su timeout y dejaron 9
 * pacientes con «fuente clínica incompleta»; la mayoría de esas fallas son
 * transitorias. Las fallas señaladas por VALOR (history/forms devuelven
 * `{error}`) conservan el resultado original si el reintento sigue fallando
 * transitoriamente; una negativa permanente posterior tiene precedencia.
 */
export const retryClinicalReadOnce = async <T>(
  read: () => Promise<T>,
  didFail: (result: T) => boolean,
  onRetry: () => void,
  signal?: AbortSignal
): Promise<T> => {
  signal?.throwIfAborted();
  let first: T;
  try {
    first = await read();
  } catch (error) {
    signal?.throwIfAborted();
    if (!canRetryClinicalRead(error)) throw error;
    onRetry();
    const second = await read();
    signal?.throwIfAborted();
    return second;
  }
  signal?.throwIfAborted();
  if (!didFail(first) || !canRetryClinicalRead(first)) return first;
  onRetry();
  try {
    const second = await read();
    signal?.throwIfAborted();
    return didFail(second) && canRetryClinicalRead(second) ? first : second;
  } catch (error) {
    signal?.throwIfAborted();
    if (!canRetryClinicalRead(error)) throw error;
    return first;
  }
};
