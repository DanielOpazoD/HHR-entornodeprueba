/**
 * Una lectura clínica que falla (timeout de 30 s, pestaña de Rayen ocupada,
 * service worker reciclado) se reintenta UNA vez, re-encolándose en su
 * compuerta de concurrencia para no retener el cupo mientras espera. En el run
 * medido del 31-08-2026, 12 de 69 lecturas agotaron su timeout y dejaron 9
 * pacientes con «fuente clínica incompleta»; la mayoría de esas fallas son
 * transitorias. Las fallas señaladas por VALOR (history/forms devuelven
 * `{error}`) conservan el resultado original si el reintento también falla,
 * para no cambiar la forma del error que ve el caller.
 */
export const retryClinicalReadOnce = async <T>(
  read: () => Promise<T>,
  didFail: (result: T) => boolean,
  onRetry: () => void
): Promise<T> => {
  let first: T;
  try {
    first = await read();
  } catch {
    onRetry();
    return read();
  }
  if (!didFail(first)) return first;
  onRetry();
  try {
    const second = await read();
    return didFail(second) ? first : second;
  } catch {
    return first;
  }
};
