import { isInstitutionalAccount } from '@/constants/identities';
import type { AuditAction } from '@/types/auditActionTypes';

export const VIEW_THROTTLE_KEY = 'hhr_audit_view_throttle';
export const VIEW_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** Last time each (screen, patient) pair was recorded in this tab. */
export interface ViewThrottleState {
  [viewKey: string]: string;
}

const isViewAction = (action: AuditAction): boolean =>
  action.startsWith('VIEW_') || action === 'PATIENT_VIEWED';

/**
 * Reads are throttled per patient, not per screen: opening patient A and then patient B within
 * the window records both accesses; reopening A does not.
 */
export const buildViewThrottleKey = (action: AuditAction, subject?: string): string =>
  subject ? `${action}|${subject.trim().toLowerCase()}` : action;

export const shouldExcludeAuditEmail = (email?: string | null): boolean =>
  isInstitutionalAccount(email);

export const parseViewThrottleState = (rawState: string | null | undefined): ViewThrottleState => {
  if (!rawState) return {};

  try {
    const parsed = JSON.parse(rawState);
    return parsed && typeof parsed === 'object' ? (parsed as ViewThrottleState) : {};
  } catch {
    return {};
  }
};

export const serializeViewThrottleState = (state: ViewThrottleState): string =>
  JSON.stringify(state);

export const shouldThrottleAuditViewAction = (
  action: AuditAction,
  state: ViewThrottleState,
  nowMs: number,
  throttleWindowMs: number = VIEW_THROTTLE_WINDOW_MS,
  subject?: string
): boolean => {
  if (!isViewAction(action)) return false;

  const lastLogged = state[buildViewThrottleKey(action, subject)];
  if (!lastLogged) return false;

  const elapsed = nowMs - new Date(lastLogged).getTime();
  return elapsed < throttleWindowMs;
};

/** Records the read and forgets entries older than the window, so the state stays small. */
export const buildNextViewThrottleState = (
  action: AuditAction,
  state: ViewThrottleState,
  timestampIso: string,
  subject?: string
): ViewThrottleState => {
  if (!isViewAction(action)) return state;
  const nowMs = new Date(timestampIso).getTime();
  const fresh = Object.fromEntries(
    Object.entries(state).filter(
      ([, loggedAt]) => nowMs - new Date(loggedAt).getTime() < VIEW_THROTTLE_WINDOW_MS
    )
  );
  return { ...fresh, [buildViewThrottleKey(action, subject)]: timestampIso };
};
