/** Page deadlines include the extension's 45 s backend read and 50 s tab relay. */
export const CLINICAL_READ_TIMEOUT_MS = 55_000;
/** CUDYR can refresh its session before reading official history and fallback worklists. */
export const CUDYR_READ_TIMEOUT_MS = 120_000;
export const CLINICAL_STAGE_TIMEOUT_MS = 5 * 60 * 1000;
