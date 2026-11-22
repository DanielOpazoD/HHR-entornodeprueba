import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  authoredOptions,
  isAuthoringSessionCurrent,
  type PublicWriteOptions,
} from '@/services/session/authoringSession';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import {
  canApplyClinicalCribCreate,
  rebaseClinicalCribCreate,
  rebaseClinicalCribCreatePatch,
} from '@/hooks/controllers/clinicalCribController';
import {
  buildAppliedBedClearPatch,
  canRebaseIntentionalBedClear,
  isIntentionalBedClearAlreadyApplied,
  rebaseIntentionalBedClear,
} from '@/hooks/controllers/intentionalBedClearController';
import { patchDailyRecordWithCompatibility } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import {
  getDailyRecordPatchBaseRecord,
  rememberDailyRecordPatchBaseRecord,
  type DailyRecordPatchBaseRecordRegistry,
} from '@/hooks/controllers/dailyRecordPatchBaseRecordController';
import type { DailyRecordPatchMutationVariables } from '@/hooks/controllers/dailyRecordPatchMutationController';

export type PatchMutationInput = {
  date?: string;
  partial: DailyRecordPatch;
  options: PartialUpdateDailyRecordOptions;
};

const resolveInput = (
  input: DailyRecordPatchMutationVariables
): {
  date?: string;
  partial: DailyRecordPatch;
  options?: PublicWriteOptions<PartialUpdateDailyRecordOptions>;
} => {
  if (
    'partial' in input &&
    input.partial !== null &&
    typeof input.partial === 'object' &&
    !Array.isArray(input.partial)
  ) {
    return input as {
      date?: string;
      partial: DailyRecordPatch;
      options?: PublicWriteOptions<PartialUpdateDailyRecordOptions>;
    };
  }
  return { partial: input as DailyRecordPatch };
};

/**
 * Logout clears the census cache. An edit whose session has ended since it began must not write
 * into the cache of whoever comes next; its durable copy and queue task stay with its author.
 */
export const isAuthorSessionCurrent = (input: PatchMutationInput): boolean =>
  isAuthoringSessionCurrent(input.options.authoringSession);

export const capturePatchMutationInput = (
  input: DailyRecordPatchMutationVariables
): PatchMutationInput => {
  const resolved = resolveInput(input);
  return {
    ...resolved,
    options: authoredOptions<PartialUpdateDailyRecordOptions>(resolved.options ?? {}),
  };
};

/** Server decisions wait for the network; plain local-first edits may enter the outbox offline. */
export const requiresRemoteAuthority = ({ options }: PatchMutationInput): boolean =>
  Boolean(
    options.requireRemoteAuthorityFirst ||
    options.intentionalBedClear ||
    options.clinicalCribCreate ||
    options.specialtyIntent
  );

const mutationTails = new Map<string, Promise<void>>();

export const acquireDailyRecordMutationTurn = async (date: string): Promise<() => void> => {
  const previousTurn = mutationTails.get(date) ?? Promise.resolve();
  let releaseCurrentTurn!: () => void;
  const currentTurn = new Promise<void>(resolve => {
    releaseCurrentTurn = resolve;
  });
  mutationTails.set(date, currentTurn);
  await previousTurn;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseCurrentTurn();
    if (mutationTails.get(date) === currentTurn) mutationTails.delete(date);
  };
};

export class AuthoritativeDailyRecordConflictError extends ConcurrencyError {
  constructor(
    message: string,
    readonly authoritativeRecord: DailyRecord
  ) {
    super(message);
    this.name = 'AuthoritativeDailyRecordConflictError';
  }
}

export interface ExecuteDailyRecordPatchWriteParams {
  input: PatchMutationInput;
  currentDate: string;
  dailyRecord: DailyRecordRepositoryPort;
  patchBaseRecords: DailyRecordPatchBaseRecordRegistry;
}

export const executeDailyRecordPatchWrite = async ({
  input,
  currentDate,
  dailyRecord,
  patchBaseRecords,
}: ExecuteDailyRecordPatchWriteParams) => {
  const { partial, options, date = currentDate } = input;
  let writePatch = partial;
  const baseRecord = getDailyRecordPatchBaseRecord(patchBaseRecords, partial);
  const buildOptions = (record: DailyRecord | undefined) => ({
    ...options,
    ...(record ? { baseRecord: record } : {}),
    ...(options?.intentionalBedClear && record
      ? {
          intentionalBedClear: rebaseIntentionalBedClear(options.intentionalBedClear, record),
        }
      : {}),
    ...(options?.clinicalCribCreate && record
      ? { clinicalCribCreate: rebaseClinicalCribCreate(options.clinicalCribCreate, record) }
      : {}),
  });
  const write = (record: DailyRecord | undefined) =>
    patchDailyRecordWithCompatibility(dailyRecord, date, writePatch, buildOptions(record));
  const adoptAlreadyAppliedClear = async (record: DailyRecord) => {
    const intent = options?.intentionalBedClear;
    const appliedPatch = buildAppliedBedClearPatch(intent, record, partial);
    const adoptedRecord = await dailyRecord.adoptAuthoritativeRecord(record, appliedPatch);
    const alreadyApplied: DailyRecordWriteResult = {
      date,
      savedHere: true,
      state: 'confirmed',
      localCopy: 'current',
      confirmedRecord: record,
      localProjectionRecord: adoptedRecord,
    };
    return alreadyApplied;
  };

  let writeBaseRecord = baseRecord;
  if (options?.intentionalBedClear) {
    // The visible census can legitimately lag one Firestore revision behind a background
    // update. Keep the row optimistic, but bind the destructive command to a fresh server
    // snapshot before its first write. The occupant/crib identity guard makes this a safe
    // rebase; it is not a blind retry.
    const authoritativeRecord = await dailyRecord.getAuthoritativeForDate(date);
    if (
      isIntentionalBedClearAlreadyApplied(options.intentionalBedClear, authoritativeRecord, partial)
    ) {
      return {
        partial,
        options,
        result: await adoptAlreadyAppliedClear(authoritativeRecord),
      };
    }
    if (!canRebaseIntentionalBedClear(options.intentionalBedClear, authoritativeRecord)) {
      if (authoritativeRecord) {
        throw new AuthoritativeDailyRecordConflictError(
          'La cama cambió desde que se confirmó la limpieza. Se cargó la versión del servidor; revísela antes de confirmar otra limpieza.',
          authoritativeRecord
        );
      }
      throw new ConcurrencyError(
        'La cama cambió desde que se confirmó la limpieza. Recargue antes de intentarlo nuevamente.'
      );
    }
    writeBaseRecord = authoritativeRecord;
    rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, authoritativeRecord);
  } else if (options?.clinicalCribCreate) {
    const authoritativeRecord = await dailyRecord.getAuthoritativeForDate(date);
    if (!authoritativeRecord) {
      throw new ConcurrencyError(
        'No fue posible confirmar la versión vigente del censo. Recargue antes de crear la cuna.'
      );
    }
    if (!canApplyClinicalCribCreate(options.clinicalCribCreate, authoritativeRecord)) {
      throw new AuthoritativeDailyRecordConflictError(
        'La cama o su cuna cambiaron antes de confirmar la creación. Se cargó la versión vigente del censo.',
        authoritativeRecord
      );
    }
    writePatch = rebaseClinicalCribCreatePatch(
      partial,
      options.clinicalCribCreate,
      authoritativeRecord
    );
    writeBaseRecord = authoritativeRecord;
    rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, authoritativeRecord);
  }

  let result;
  try {
    result = await write(writeBaseRecord);
  } catch (error) {
    if (!(error instanceof ConcurrencyError) || !options?.intentionalBedClear) {
      throw error;
    }

    const latestRecord = await dailyRecord.getAuthoritativeForDate(date);
    if (isIntentionalBedClearAlreadyApplied(options.intentionalBedClear, latestRecord, partial)) {
      result = await adoptAlreadyAppliedClear(latestRecord);
    } else if (!canRebaseIntentionalBedClear(options.intentionalBedClear, latestRecord)) {
      throw new ConcurrencyError(
        'La cama cambió desde que se confirmó la limpieza. Recargue antes de intentarlo nuevamente.'
      );
    } else {
      rememberDailyRecordPatchBaseRecord(patchBaseRecords, partial, latestRecord);
      result = await write(latestRecord);
    }
  }
  return { partial, options, result };
};
