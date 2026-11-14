import type { RayenCaptureFailureCheck, RayenSyncFailureReason } from '@/types/domain/rayenSync';

/**
 * Clasifica el error que la extensión devuelve al capturar el censo
 * (`HHR_RAYEN_IMPORT_ERROR`) en una causa sanitizada para el historial y un
 * mensaje accionable para la barra.
 *
 * Contrato del transporte (fichamedico-transport-runtime.js): TODO error del
 * lector de Ficha Médico llega envuelto con ese mismo prefijo y el error real
 * detrás de «Detalle:». Por eso se clasifica sobre el detalle, nunca sobre el
 * envoltorio; el prefijo solo dice que el lector falló, no por qué.
 *
 * La causa persistida es siempre una categoría. El mensaje para la persona es
 * siempre un remedio en tono sereno, sin el texto de la extensión; ese texto
 * (acotado) viaja aparte como detalle técnico, que solo ve el administrador en
 * «Ver detalle» y que nunca se guarda.
 */
export interface RayenSnapshotErrorClassification {
  reason: RayenSyncFailureReason;
  /** Qué pasó y qué hacer, sin palabras de avería ni texto técnico. */
  message: string;
  /** Texto de la extensión detrás del mensaje, acotado; solo para el administrador. */
  technicalDetail?: string;
  /** Which check failed; finer than `reason`, for telemetry only. */
  check: RayenCaptureFailureCheck;
}

const MAX_MESSAGE_LENGTH = 300;

const GENERIC_MESSAGE =
  'Eloísa todavía no entregó la lectura. Revisa las pestañas de Eloísa y vuelve a sincronizar.';

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

const technicalDetailOf = (
  detail: string
): Pick<RayenSnapshotErrorClassification, 'technicalDetail'> =>
  detail ? { technicalDetail: capAtWordBoundary(detail) } : {};

interface ClassificationRule {
  test: RegExp;
  reason: RayenSyncFailureReason;
  /** Remedio para la persona; el texto de la extensión queda como detalle técnico. */
  remedy: string;
}

/** En orden: lo más específico primero; el fallo de red de Ficha Médico va después de las de GC. */
const RULES: readonly ClassificationRule[] = [
  {
    test: /no hay una pestana de rayen|abre ficha medico/,
    reason: 'ficha_medico_unavailable',
    remedy: 'Falta una pestaña de Ficha Médico. Ábrela, inicia sesión y vuelve a sincronizar.',
  },
  {
    // Establecimientos distintos: el remedio es abrir la misma sede en ambas sesiones.
    test: /no corresponden al mismo establecimiento/,
    reason: 'snapshot_error',
    remedy:
      'Ficha Médico y Gestión de Camas tienen abiertos establecimientos distintos. Abre ambas en el mismo establecimiento y vuelve a sincronizar.',
  },
  {
    test: /tiempo de espera|no respondio dentro del tiempo/,
    reason: 'snapshot_timeout',
    remedy:
      'Eloísa tardó más de lo esperado en responder. Vuelve a sincronizar; si se repite, recarga la pestaña correspondiente.',
  },
  {
    // Descarga del reporte de egresos (service worker → backend de GC): un fallo de red aquí es de GC.
    test: /fallo la descarga del reporte|servidor de reportes|gestion de camas/,
    reason: 'gestion_camas_unavailable',
    remedy:
      'Gestión de Camas no está disponible para la lectura. Revisa su conexión en el monitor de Eloísa y vuelve a sincronizar.',
  },
  {
    // Sesión clínica ausente/vencida en Ficha Médico: el remedio es volver a iniciar sesión.
    test: /sesion clinica|inicia sesion|vencio/,
    reason: 'ficha_medico_unavailable',
    remedy:
      'La sesión clínica de Ficha Médico no está activa. Inicia sesión en Ficha Médico y vuelve a sincronizar.',
  },
  {
    test: /failed to fetch|networkerror|load failed|fallo de red|http\s*(502|503|504)\b/,
    reason: 'snapshot_network_error',
    remedy:
      'La conexión con Eloísa se cortó durante la lectura. Esto no confirma que la sesión haya vencido. Vuelve a sincronizar; si se repite, revisa la conexión y las pestañas de Eloísa.',
  },
  {
    test: /no puede leer datos|versi[oó]n anterior de la extensi[oó]n/,
    reason: 'ficha_medico_stale',
    remedy:
      'La pestaña de Ficha Médico dejó de entregar datos. Recárgala (Cmd+R), espera a que cargue y vuelve a sincronizar.',
  },
  {
    // Va al final: misma causa que el caso genérico; solo conserva la acción que la persona necesita.
    test: /no corresponde a la identidad clinica/,
    reason: 'snapshot_error',
    remedy: 'La lista abierta en Eloísa es de otra sesión. Recarga Eloísa y vuelve a sincronizar.',
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

/** Gestión de Camas checks, in order; Ficha Médico's causes are already told apart by `reason`. */
const CHECK_RULES: readonly (readonly [RegExp, RayenCaptureFailureCheck])[] = [
  [/desconecto durante la captura.*gestion de camas/, 'gc_after_capture'],
  [/desconecto durante la captura/, 'ficha_after_capture'],
  [
    /(gestion de camas|puente interno).*(no respondio|perdio conexion|no confirmo)|agotado .*gestion de camas/,
    'gc_tab_unresponsive',
  ],
  [/gestion de camas.*(desactualizada|vigente)/, 'gc_tab_outdated'],
  [/sesion de gestion de camas vencio|ventana oficial de gestion/, 'gc_session_expired'],
  [/sesion cambio durante/, 'gc_session_changed'],
  [/mismo establecimiento/, 'other'],
  [/reporte|informe de egresos/, 'gc_report_failed'],
  [/gestion de camas|token de gestion/, 'gc_session_missing'],
];
const classifyCheck = (detailNormalized: string): RayenCaptureFailureCheck =>
  CHECK_RULES.find(([test]) => test.test(detailNormalized))?.[1] ?? 'other';

/** Health message of a Ficha Médico tab whose reads stay blocked after a network failure. */
const FICHA_READ_BLOCKED = /no puede leer datos desde esta pestana/;

/** A connection failure does not say which read failed; only Ficha Médico wraps its errors. */
const networkCheck = (
  check: RayenCaptureFailureCheck,
  detailNormalized: string,
  fromFichaReader: boolean
): RayenCaptureFailureCheck => {
  if (check !== 'other') return check;
  if (FICHA_READ_BLOCKED.test(detailNormalized)) return 'ficha_read_blocked';
  return fromFichaReader ? 'ficha_network' : 'other';
};

export const classifyRayenSnapshotError = (
  rawError: unknown,
  timeoutStage?: string
): RayenSnapshotErrorClassification => {
  if (timeoutStage === 'ficha_main_relay') {
    return {
      reason: 'snapshot_timeout',
      message:
        'El lector de Ficha Médico tardó más de lo esperado. Revisa esa pestaña y vuelve a sincronizar.',
      check: 'ficha_relay_timeout',
    };
  }
  if (timeoutStage === 'ficha_tab_relay') {
    return {
      reason: 'snapshot_timeout',
      message:
        'La pestaña de Ficha Médico tardó en responder a la extensión. Recárgala y vuelve a sincronizar.',
      check: 'ficha_relay_timeout',
    };
  }
  const raw = typeof rawError === 'string' ? rawError.trim() : '';
  const detail = unwrapTransportDetail(raw);
  const detailNormalized = normalize(detail);
  const check = classifyCheck(detailNormalized);

  for (const rule of RULES) {
    if (!rule.test.test(detailNormalized)) continue;
    return {
      reason: rule.reason,
      message: rule.remedy,
      ...technicalDetailOf(detail),
      check:
        rule.reason === 'snapshot_network_error'
          ? networkCheck(check, detailNormalized, detail !== raw)
          : check,
    };
  }
  return {
    reason: 'snapshot_error',
    message: GENERIC_MESSAGE,
    ...technicalDetailOf(detail),
    check,
  };
};
