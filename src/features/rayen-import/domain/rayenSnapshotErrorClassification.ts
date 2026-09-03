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
 * Contrato del transporte (fichamedico-transport-runtime.js): TODO error del
 * lector de Ficha Médico llega envuelto con ese mismo prefijo y el error real
 * detrás de «Detalle:». Por eso se clasifica sobre el detalle, nunca sobre el
 * envoltorio; el prefijo solo dice que el lector falló, no por qué.
 *
 * La causa persistida es siempre una categoría; el texto de primera parte
 * (lo escribió la extensión para el operador) se muestra acotado y nunca se
 * guarda.
 */
export interface RayenSnapshotErrorClassification {
  reason: RayenSyncFailureReason;
  message: string;
}

const MAX_MESSAGE_LENGTH = 300;

const GENERIC_MESSAGE =
  'Eloísa no pudo leer la información solicitada. Revisa las pestañas de Rayen e inténtalo nuevamente.';

const TRANSPORT_WRAPPER =
  /^no se pudo leer rayen\. recarga la pestana de ficha medico[\s\S]*?\bdetalle:\s*/;

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const capAtWordBoundary = (value: string): string => {
  if (value.length <= MAX_MESSAGE_LENGTH) return value;
  const cut = value.slice(0, MAX_MESSAGE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > MAX_MESSAGE_LENGTH / 2 ? cut.slice(0, lastSpace) : cut}…`;
};

const withDetail = (remedy: string, detail: string): string =>
  capAtWordBoundary(detail ? `${remedy} Detalle: ${detail}` : remedy);

interface ClassificationRule {
  test: RegExp;
  reason: RayenSyncFailureReason;
  /** Remedio enlatado (el detalle se anexa); null = el texto de la extensión ya es el remedio. */
  remedy: string | null;
}

/** En orden: lo más específico primero; el fallo de red de Ficha Médico va después de las de GC. */
const RULES: readonly ClassificationRule[] = [
  {
    test: /no hay una pestana de rayen|abre ficha medico/,
    reason: 'ficha_medico_unavailable',
    remedy:
      'No hay una pestaña de Ficha Médico disponible. Ábrela, inicia sesión y vuelve a sincronizar.',
  },
  {
    // Establecimientos distintos: el remedio (misma sede en ambas sesiones) lo dice la extensión.
    test: /no corresponden al mismo establecimiento/,
    reason: 'snapshot_error',
    remedy: null,
  },
  {
    test: /tiempo de espera|no respondio dentro del tiempo/,
    reason: 'snapshot_timeout',
    remedy:
      'Eloísa no respondió a tiempo. Vuelve a intentarlo; si persiste, recarga la pestaña correspondiente.',
  },
  {
    // Descarga del reporte de egresos (service worker → backend de GC): un fallo de red aquí es de GC.
    test: /fallo la descarga del reporte|servidor de reportes|gestion de camas/,
    reason: 'gestion_camas_unavailable',
    remedy:
      'Gestión de Camas no está disponible para la lectura. Revisa su conexión en el monitor de Eloísa y vuelve a sincronizar.',
  },
  {
    test: /failed to fetch|networkerror|load failed|fallo de red|no puede leer datos|versi[oó]n anterior de la extensi[oó]n/,
    reason: 'ficha_medico_stale',
    remedy:
      'La pestaña de Ficha Médico ya no puede leer datos (sesión de red vencida o pestaña envejecida). Recárgala (Cmd+R), espera a que cargue y vuelve a sincronizar.',
  },
  {
    // Sesión clínica ausente/vencida en Ficha Médico: la instrucción precisa la trae la extensión.
    test: /sesion clinica|inicia sesion|vencio/,
    reason: 'ficha_medico_unavailable',
    remedy: null,
  },
];

/** Texto real del error: el detalle detrás del envoltorio del transporte, o el mensaje entero. */
const unwrapTransportDetail = (raw: string): string => {
  const normalized = normalize(raw);
  const match = TRANSPORT_WRAPPER.exec(normalized);
  // Quitar diacríticos combinados no cambia la longitud del texto visible, así
  // que el corte por longitud del envoltorio es válido sobre el texto crudo.
  return match ? raw.slice(raw.length - (normalized.length - match[0].length)).trim() : raw;
};

export const classifyRayenSnapshotError = (rawError: unknown): RayenSnapshotErrorClassification => {
  const raw = typeof rawError === 'string' ? rawError.trim() : '';
  const detail = unwrapTransportDetail(raw);
  const detailNormalized = normalize(detail);

  for (const rule of RULES) {
    if (!rule.test.test(detailNormalized)) continue;
    return {
      reason: rule.reason,
      message: rule.remedy ? withDetail(rule.remedy, detail) : capAtWordBoundary(detail),
    };
  }
  return {
    reason: 'snapshot_error',
    message: detail ? capAtWordBoundary(detail) : GENERIC_MESSAGE,
  };
};
