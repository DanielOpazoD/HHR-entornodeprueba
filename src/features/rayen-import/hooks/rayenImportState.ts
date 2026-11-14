import type { ApplyResult } from '../domain/applyCensusImportDiff';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { RayenPlanningStop } from '../domain/rayenPlanningStop';

export interface RayenImportState {
  diff: CensusImportDiff | null;
  /** View visibility intent only; the execution stage decides whether review is allowed. */
  isPreviewOpen: boolean;
  result: ApplyResult | null;
  hasSkippedItems: boolean;
  error: string | null;
  /**
   * Texto técnico de la fuente detrás de `error`, ligado al mensaje que acompaña. Solo lo ve el
   * administrador y nunca se guarda.
   */
  errorTechnicalDetail?: RayenImportErrorTechnicalDetail | null;
}

export interface RayenImportErrorTechnicalDetail {
  /** El mensaje de `error` al que pertenece; otro mensaje posterior no lo hereda. */
  message: string;
  detail: string;
}

/** The source text behind the message on screen, only for administrators and only for that message. */
export const visibleErrorTechnicalDetail = (
  state: Pick<RayenImportState, 'error' | 'errorTechnicalDetail'>,
  isAdmin: boolean
): string | null =>
  isAdmin && state.errorTechnicalDetail && state.errorTechnicalDetail.message === state.error
    ? state.errorTechnicalDetail.detail
    : null;

export const INITIAL_RAYEN_IMPORT_STATE: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  result: null,
  hasSkippedItems: false,
  error: null,
  errorTechnicalDetail: null,
};

/** A dropped connection reaches the box as a browser or SDK phrase; the person reads a remedy. */
const CONNECTION_FAILURE = /failed to fetch|networkerror|load failed|network request failed/i;
const CONNECTION_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'functions/unavailable',
  'functions/deadline-exceeded',
]);

/**
 * The structural write timeout keeps an English prefix so diagnostics classify it as a timeout;
 * the person reads only the Spanish remedy behind it.
 */
const DIAGNOSTIC_PREFIX = /^Structural persist timeout:\s*/;

const RAYEN_IMPORT_CONNECTION_MESSAGE =
  'La conexión se cortó antes de terminar. Vuelve a sincronizar cuando haya conexión.';

export const getRayenImportErrorMessage = (error: unknown): string => {
  const fields =
    error !== null && typeof error === 'object'
      ? (error as { message?: unknown; code?: unknown; details?: { reason?: unknown } | null })
      : null;
  const message = typeof fields?.message === 'string' ? fields.message : String(error);
  if (
    fields?.details?.reason === 'specialty_explicit_intent_required' ||
    message === 'Specialty change requires explicit intent.'
  ) {
    return 'La sincronización se detuvo porque intentaba modificar una especialidad protegida. Actualiza la aplicación y vuelve a sincronizar. No necesitas asignar una especialidad para sincronizar.';
  }
  if (
    CONNECTION_FAILURE.test(message) ||
    (typeof fields?.code === 'string' && CONNECTION_CODES.has(fields.code))
  ) {
    return RAYEN_IMPORT_CONNECTION_MESSAGE;
  }
  if (DIAGNOSTIC_PREFIX.test(message)) {
    const remedy = message.replace(DIAGNOSTIC_PREFIX, '');
    return `${remedy.charAt(0).toUpperCase()}${remedy.slice(1)}`;
  }
  return message;
};

const PLANNING_UNFINISHED_MESSAGE =
  'La conciliación del censo quedó sin terminar. Vuelve a sincronizar.';
const MAX_TECHNICAL_DETAIL_LENGTH = 300;

/**
 * What a failed reconciliation shows. A deliberate stop and a dropped connection carry their own
 * remedy. Anything else is unforeseen: the person reads a calm line and the source text stays
 * with the administrator.
 */
export const describeRayenPlanningFailure = (
  error: unknown
): Pick<RayenImportState, 'error' | 'errorTechnicalDetail'> & { unforeseen: boolean } => {
  const message = getRayenImportErrorMessage(error);
  if (error instanceof RayenPlanningStop || message === RAYEN_IMPORT_CONNECTION_MESSAGE) {
    return { error: message, errorTechnicalDetail: null, unforeseen: false };
  }
  return {
    error: PLANNING_UNFINISHED_MESSAGE,
    errorTechnicalDetail: {
      message: PLANNING_UNFINISHED_MESSAGE,
      detail: message.slice(0, MAX_TECHNICAL_DETAIL_LENGTH),
    },
    unforeseen: true,
  };
};
