import type { RayenSyncFailureReason } from '@/types/domain/rayenSync';

/**
 * Clasifica el error que la extensión devuelve al capturar el censo
 * (`HHR_RAYEN_IMPORT_ERROR`) en una causa sanitizada para el historial y un
 * mensaje accionable para la barra.
 *
 * Origen: el 02-09 una corrida falló en 1 s con «No se pudo leer Rayen.
 * Recarga la pestaña de Ficha Médico (Cmd+R)… Detalle: Failed to fetch»
 * mientras la salud declaraba Ficha Médico lista. La app descartaba ese
 * texto, mostraba un genérico («Revisa las pestañas de Rayen») y archivaba
 * `snapshot_error`: el operador no sabía que bastaba recargar la pestaña.
 *
 * La causa persistida es siempre una categoría; el texto crudo de la
 * extensión no se guarda (solo se muestra, y solo cuando es de primera
 * parte y no cae en ninguna categoría conocida).
 */
export interface RayenSnapshotErrorClassification {
  reason: RayenSyncFailureReason;
  message: string;
}

const MAX_RAW_MESSAGE_LENGTH = 300;

const FICHA_MEDICO_STALE_MESSAGE =
  'La pestaña de Ficha Médico ya no puede leer datos (sesión de red vencida o pestaña envejecida). Recárgala (Cmd+R), espera a que cargue y vuelve a sincronizar.';
const FICHA_MEDICO_MISSING_MESSAGE =
  'No hay una pestaña de Ficha Médico abierta. Ábrela, inicia sesión y vuelve a sincronizar.';
const GESTION_CAMAS_MESSAGE =
  'Gestión de Camas no está disponible para la lectura. Conéctala desde el monitor de Eloísa y vuelve a sincronizar.';
const SNAPSHOT_TIMEOUT_MESSAGE =
  'Eloísa no respondió a tiempo. Vuelve a intentarlo; si persiste, recarga la pestaña de Ficha Médico.';
const GENERIC_MESSAGE =
  'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen e inténtalo nuevamente.';

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export const classifyRayenSnapshotError = (rawError: unknown): RayenSnapshotErrorClassification => {
  const raw = typeof rawError === 'string' ? rawError.trim() : '';
  const text = normalize(raw);

  if (/no hay una pestana de rayen|abre ficha medico/.test(text)) {
    return { reason: 'ficha_medico_unavailable', message: FICHA_MEDICO_MISSING_MESSAGE };
  }
  if (/recarga la pestana de ficha medico|failed to fetch|networkerror|load failed/.test(text)) {
    return { reason: 'ficha_medico_stale', message: FICHA_MEDICO_STALE_MESSAGE };
  }
  if (/gestion de camas/.test(text)) {
    return { reason: 'gestion_camas_unavailable', message: GESTION_CAMAS_MESSAGE };
  }
  if (/tiempo de espera|no respondio dentro del tiempo|timeout/.test(text)) {
    return { reason: 'snapshot_timeout', message: SNAPSHOT_TIMEOUT_MESSAGE };
  }
  // Texto de primera parte (lo escribió la extensión para el operador): se
  // muestra tal cual, acotado; nunca se persiste.
  return {
    reason: 'snapshot_error',
    message: raw ? raw.slice(0, MAX_RAW_MESSAGE_LENGTH) : GENERIC_MESSAGE,
  };
};
