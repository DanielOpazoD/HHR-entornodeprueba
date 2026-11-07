import type { Firestore } from 'firebase/firestore';
import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

export type FirestoreRestValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
};

const firestoreRestOrigin = (): string => {
  const emulatorHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
  return import.meta.env.DEV && emulatorHost
    ? `http://${emulatorHost}`
    : 'https://firestore.googleapis.com';
};

/** Long enough for a slow connection; short enough that a hung request never holds a screen. */
export const SERVER_DOCUMENT_READ_TIMEOUT_MS = 5000;

type ServerAnswer = {
  status: number;
  body: { fields?: Record<string, FirestoreRestValue> } | null;
};

const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

/**
 * A document's fields as the Firestore server stores them, or null when the server answers that it
 * does not exist. Read straight from the server with the person's own session: the SDK can't be
 * used, because its server reads answer from a listener's view, which is where a stale «does not
 * exist» lived on 2026-11-07. `fieldPaths` limits the answer to those fields. Gives up after
 * {@link SERVER_DOCUMENT_READ_TIMEOUT_MS} with code `deadline-exceeded`.
 */
export const readFirestoreDocumentFromServer = async (
  db: Firestore,
  path: string,
  fieldPaths: string[] = []
): Promise<Record<string, FirestoreRestValue> | null> => {
  // An answer obtained with the previous person's session is never applied to the next one.
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  const sameSession = () =>
    owner === getStoredSessionOwnerKey() && generation === getSessionGeneration();
  const mask = fieldPaths.map(field => `mask.fieldPaths=${encodeURIComponent(field)}`).join('&');
  const url = `${firestoreRestOrigin()}/v1/projects/${db.app.options.projectId}/databases/(default)/documents/${path}${mask ? `?${mask}` : ''}`;
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let answer: ServerAnswer;
  try {
    answer = await Promise.race([
      (async (): Promise<ServerAnswer> => {
        const response = await fetch(url, {
          headers: await resolveCurrentUserAuthHeaders(),
          cache: 'no-store',
          signal: abort.signal,
        });
        return { status: response.status, body: response.ok ? await response.json() : null };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(coded('El servidor no respondió a tiempo.', 'deadline-exceeded'));
        }, SERVER_DOCUMENT_READ_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // A failure after the session changed is reported as that change, never as a plain failure.
    if (!sameSession()) throw coded('La sesión cambió mientras se leía el servidor.', 'cancelled');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  // Checked once the whole answer is in: the session may change while the body is still arriving.
  if (!sameSession()) throw coded('La sesión cambió mientras se leía el servidor.', 'cancelled');
  if (answer.status === 404) return null;
  if (!answer.body) {
    throw coded(
      `El servidor no respondió la lectura (HTTP ${answer.status}).`,
      answer.status === 401 || answer.status === 403 ? 'permission-denied' : 'unavailable'
    );
  }
  return answer.body.fields ?? {};
};
