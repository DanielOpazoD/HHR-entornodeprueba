import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import type { ExalabExam } from '@/types/domain/labExamTypes';
export type { ExalabExam } from '@/types/domain/labExamTypes';
export class ExalabRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
  }
}
const request = async (
  action: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
  link?: string
) => {
  const epoch = getSessionEpoch();
  const headers = await resolveCurrentUserAuthHeaders();
  if (signal.aborted || epoch !== getSessionEpoch())
    throw new DOMException('Consulta cancelada.', 'AbortError');
  if (!headers.Authorization) throw new ExalabRequestError('Inicia sesión en HHR.');
  const query = new URLSearchParams({ action, ...(link ? { link } : {}) });
  const response = await fetch(`/.netlify/functions/exalab-proxy?${query}`, {
    method: ['pair', 'search', 'disconnect'].includes(action) ? 'POST' : 'GET',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: 'no-store',
    redirect: 'error',
  });
  if (signal.aborted || epoch !== getSessionEpoch())
    throw new DOMException('Consulta cancelada.', 'AbortError');
  if (action === 'pdf' && response.ok) {
    const blob = await response.blob();
    if (
      blob.size > 4 * 1024 * 1024 ||
      blob.type !== 'application/pdf' ||
      (await blob.slice(0, 5).text()) !== '%PDF-'
    )
      throw new ExalabRequestError('Exalab no devolvió un PDF válido.');
    if (signal.aborted || epoch !== getSessionEpoch())
      throw new DOMException('Consulta cancelada.', 'AbortError');
    return blob;
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ExalabRequestError('El puente Exalab no está disponible.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ExalabRequestError('El puente Exalab no devolvió datos válidos.');
  const data = raw as Record<string, unknown>;
  if (signal.aborted || epoch !== getSessionEpoch())
    throw new DOMException('Consulta cancelada.', 'AbortError');
  if (!response.ok || data.success !== true)
    throw new ExalabRequestError(
      typeof data.error === 'string' ? data.error : 'No se pudo completar la consulta Exalab.',
      typeof data.code === 'string' ? data.code : undefined
    );
  return data;
};
export const exalabStatus = async (signal: AbortSignal): Promise<boolean> => {
  const data = await request('status', signal);
  return !(data instanceof Blob) && data.connected === true;
};
export const searchExalab = async (
  rut: string,
  from: string,
  to: string,
  signal: AbortSignal
): Promise<ExalabExam[]> => {
  const data = await request('search', signal, { rut, from, to });
  if (
    data instanceof Blob ||
    !Array.isArray(data.data) ||
    data.data.some(
      item =>
        !item ||
        typeof item !== 'object' ||
        ['id', 'rut', 'date', 'time', 'patientName', 'laboratory', 'exams', 'link'].some(
          key => typeof item[key] !== 'string'
        ) ||
        item.rut !== rut ||
        !item.link.startsWith('hhr-exalab://report/')
    )
  )
    throw new ExalabRequestError('La respuesta Exalab no permite verificar los informes.');
  return data.data as ExalabExam[];
};
export const fetchExalabPdf = async (link: string, signal: AbortSignal): Promise<Blob> => {
  const result = await request('pdf', signal, undefined, link);
  if (!(result instanceof Blob)) throw new ExalabRequestError('Exalab no devolvió el PDF.');
  return result;
};
export const disconnectExalab = (signal: AbortSignal) => request('disconnect', signal);
export const connectExalab = async (signal: AbortSignal): Promise<void> => {
  const result = await request('pair', signal);
  if (
    result instanceof Blob ||
    typeof result.pair !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(result.pair)
  )
    throw new ExalabRequestError('No se pudo iniciar la conexión Exalab.');
  const pair = result.pair;
  if (signal.aborted) throw new DOMException('Conexión cancelada.', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const reqId = crypto.randomUUID();
    const cleanup = () => {
      window.removeEventListener('message', listener);
      signal.removeEventListener('abort', abort);
      clearTimeout(timer);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Conexión cancelada.', 'AbortError'));
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'HHR_EXALAB_CONNECT_RESULT' ||
        event.data.reqId !== reqId
      )
        return;
      cleanup();
      if (event.data.opened === true) resolve();
      else
        reject(new ExalabRequestError('Actualiza la extensión Eloísa y vuelve a conectar Exalab.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new ExalabRequestError(
          'Para conectar Exalab, usa Chrome en este PC con la extensión Eloísa actualizada y recarga HHR.'
        )
      );
    }, 3000);
    window.addEventListener('message', listener);
    signal.addEventListener('abort', abort, { once: true });
    window.postMessage({ type: 'HHR_EXALAB_CONNECT_REQUEST', reqId, pair }, window.location.origin);
  });
};
