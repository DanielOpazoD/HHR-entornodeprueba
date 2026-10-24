import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import {
  AUTHORITY_READBACK_TIMEOUT_MS,
  DAILY_RECORD_AUTHORITY_CALLABLE_TIMEOUT_MS,
  DAILY_RECORD_AUTHORITY_FUNCTIONS_REGION,
  normalizeDailyRecordAuthorityError,
} from './dailyRecordAuthorityCallableClient';
import { getDocFromServer } from 'firebase/firestore';
import { docToRecord, getRecordDocRef } from './firestoreShared';
import { withClientRuntimeContractVersion } from '@/services/storage/clinicalAuthorityClientVersion';
import { withoutStoredIdentityReviews } from '@/shared/census/patientIdentityReview';
import type {
  DailyRecordAuthorityCallablePayload,
  DailyRecordAuthorityCallableResponse,
  DailyRecordAuthorityPatchCallablePayload,
} from './dailyRecordAuthorityCallableClient';

/**
 * The authority callables store lastUpdated as a Firestore Timestamp (Timestamp.now()); older
 * copies carry ISO text. Either is a commit stamp; anything else is not evidence.
 */
const hasCommitStamp = (value: unknown): boolean => {
  if (typeof value === 'string') return Number.isFinite(Date.parse(value));
  const toMillis = (value as { toMillis?: unknown } | null)?.toMillis;
  return typeof toMillis === 'function' && Number.isFinite(toMillis.call(value));
};

/** A server-only read proves one exact commit; matching field values are not a receipt. */
const readConfirmedAuthorityMutation = async (
  payload: DailyRecordAuthorityCallablePayload | DailyRecordAuthorityPatchCallablePayload
): Promise<DailyRecordAuthorityCallableResponse | null> => {
  const mutationId = payload.syncContract?.mutationId;
  if (!mutationId || payload.dryRun || payload.mode !== 'enforced') return null;
  try {
    const snapshot = await getDocFromServer(getRecordDocRef(payload.date));
    if (!snapshot?.exists() || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
      return null;
    const data = snapshot.data();
    const meta = data.meta;
    if (
      data.date !== payload.date ||
      meta?.lastMutationId !== mutationId ||
      !Number.isSafeInteger(meta.revision) ||
      meta.revision <= 0 ||
      !hasCommitStamp(data.lastUpdated)
    )
      return null;
    const record = docToRecord(data, payload.date);
    return {
      success: true,
      date: payload.date,
      mode: 'enforced',
      authorityStatus: 'ok',
      revision: meta.revision,
      mutationId,
      recordState: { lastUpdated: record.lastUpdated, meta, record },
      violations: [],
    };
  } catch {
    // Unavailable evidence must preserve the original write error and its recovery policy.
    return null;
  }
};

const recoverLostAuthorityResponse = async (
  error: unknown,
  payload: DailyRecordAuthorityCallablePayload | DailyRecordAuthorityPatchCallablePayload
): Promise<DailyRecordAuthorityCallableResponse> => {
  if (
    payload.mode === 'enforced' &&
    !payload.dryRun &&
    payload.syncContract?.mutationId &&
    ['deadline-exceeded', 'unavailable', 'internal', 'unknown'].includes(
      String((error as { code?: unknown })?.code ?? '')
        .toLowerCase()
        .replace(/^functions\//, '')
    )
  ) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const confirmed = await Promise.race([
        readConfirmedAuthorityMutation(payload),
        new Promise<null>(resolve => {
          timer = setTimeout(() => {
            resolve(null);
          }, AUTHORITY_READBACK_TIMEOUT_MS);
        }),
      ]);
      if (confirmed) return confirmed;
    } catch {
      // Failed confirmation must not mask the original callable error.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  throw normalizeDailyRecordAuthorityError(error);
};

export const invokeAuthority = async (
  operation: 'save' | 'patch',
  payload: DailyRecordAuthorityCallablePayload | DailyRecordAuthorityPatchCallablePayload
): Promise<DailyRecordAuthorityCallableResponse> => {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(
    DAILY_RECORD_AUTHORITY_FUNCTIONS_REGION
  );
  const callable = httpsCallable<typeof payload, DailyRecordAuthorityCallableResponse>(
    functions,
    `${operation}DailyRecordWithClinicalAuthority`,
    { timeout: DAILY_RECORD_AUTHORITY_CALLABLE_TIMEOUT_MS }
  );
  try {
    // The answer carries the stored day: it is read like one.
    return withoutStoredIdentityReviews(
      (await callable(withClientRuntimeContractVersion(payload))).data
    );
  } catch (error) {
    return recoverLostAuthorityResponse(error, payload);
  }
};
