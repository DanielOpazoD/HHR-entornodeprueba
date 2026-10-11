import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';
import {
  createClinicalAdminMock,
  createRayenClinicalEnrichmentFunctions,
  makePayload,
} from './rayenClinicalEnrichmentFunctions.test-support';
import { getRayenImportErrorMessage } from '@/features/rayen-import/hooks/rayenImportState';
import {
  normalizeDailyRecordAuthorityError,
  shouldRetryDailyRecordAuthorityError,
} from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const require = createRequire(import.meta.url);
const { SpecialtyDecisionError } = require('../../../functions/lib/specialtyDecisionContract.js');
const reason = 'specialty_explicit_intent_required';
const legacyMessage = 'Specialty change requires explicit intent.';
const friendlyMessage =
  'No se pudo completar la sincronización porque se intentó modificar una especialidad protegida. Actualiza la aplicación y vuelve a capturar el censo. No necesitas asignar una especialidad para sincronizar.';

describe('specialty reason across server and client boundaries', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each(['save', 'patch'])('returns an additive reason from the %s callable', async mode => {
    vi.stubEnv('HHR_SPECIALTY_EPISODE_ASSIGNMENT', 'enabled');
    const remote = {
      ...makeRecord(),
      meta: { revision: 2 },
      beds: { R1: { ...makeRecord().beds.R1, specialty: '' } },
    };
    const { admin, update, set } = createAdminMock({ remoteData: remote });
    const api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const common = {
      date: remote.date,
      mode: 'enforced',
      origin: 'rayen',
      expectedLastUpdated: remote.lastUpdated,
      syncContract: {
        mutationId: 'synthetic-rejected',
        baseRevision: 2,
        changedPaths: ['beds.R1.specialty'],
      },
    };
    const call =
      mode === 'save'
        ? api.saveDailyRecordWithClinicalAuthority.run(
            {
              ...common,
              record: { ...remote, beds: { R1: { ...remote.beds.R1, specialty: 'Cirugía' } } },
            },
            makeContext()
          )
        : api.patchDailyRecordWithClinicalAuthority.run(
            { ...common, patch: { 'beds.R1.specialty': 'Cirugía' } },
            makeContext()
          );
    const error = await call.then(
      () => {
        throw new Error('Expected authority rejection');
      },
      (failure: unknown) => failure
    );
    expect(error).toMatchObject({
      code: 'failed-precondition',
      message: legacyMessage,
      details: { reason },
    });
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    // Firebase prefixes the status code; domain details survive SDK normalization.
    const wireError = {
      code: 'functions/failed-precondition',
      message: 'Changed server wording',
      details: JSON.parse(JSON.stringify((error as { details: unknown }).details)),
    };
    expect(normalizeDailyRecordAuthorityError(wireError)).toBe(wireError);
    expect(shouldRetryDailyRecordAuthorityError(wireError)).toBe(false);
    expect(getRayenImportErrorMessage(wireError)).toBe(friendlyMessage);
  });

  it('preserves the reason when clinical failures add transaction diagnostics', async () => {
    const admin = createClinicalAdminMock();
    admin.runTransaction.mockRejectedValueOnce(
      new SpecialtyDecisionError('failed-precondition', legacyMessage, reason)
    );
    const api = createRayenClinicalEnrichmentFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    await expect(
      api.applyRayenClinicalEnrichmentBatch.run(makePayload(), makeContext())
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: legacyMessage,
      details: { reason, targetScope: 'current', transactionAttempts: 0, transactionRetries: 0 },
    });
    expect(admin.set).not.toHaveBeenCalled();
  });

  it('does not expose unrelated error details while adding clinical diagnostics', async () => {
    const functionsRequire = createRequire(
      require.resolve('../../../functions/lib/rayenClinicalEnrichmentFunctions.js')
    );
    const { https } = functionsRequire('firebase-functions/v1');
    const admin = createClinicalAdminMock();
    admin.runTransaction.mockRejectedValueOnce(
      new https.HttpsError('failed-precondition', 'Other failure', {
        internalOnly: 'synthetic detail',
      })
    );
    const api = createRayenClinicalEnrichmentFunctions({
      firestore: admin.firestore(),
      Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      monotonicNow: () => 100,
    });
    const error = await api.applyRayenClinicalEnrichmentBatch
      .run(makePayload(), makeContext())
      .catch((failure: unknown) => failure);
    expect(error.details).toEqual({
      targetScope: 'current',
      transactionAttempts: 0,
      transactionRetries: 0,
      serverTimingsMs: { authorizationMs: 0, transactionMs: 0, telemetryMs: 0, handlerMs: 0 },
      transactionTimingsMs: {
        callbackMs: 0,
        documentReadMs: 0,
        specialtyAuditMs: 0,
        otherCallbackMs: 0,
        outsideCallbackMs: 0,
      },
    });
    expect(error.details).not.toHaveProperty('internalOnly');
  });

  it('supports older servers and ordinary serialized errors', () => {
    expect(getRayenImportErrorMessage(new Error(legacyMessage))).toBe(friendlyMessage);
    expect(getRayenImportErrorMessage({ message: legacyMessage })).toBe(friendlyMessage);
    expect(
      getRayenImportErrorMessage({ message: 'Other failure', details: { reason: 'unknown' } })
    ).toBe('Other failure');
    expect(getRayenImportErrorMessage({ message: 'Other failure', details: null })).toBe(
      'Other failure'
    );
    expect(getRayenImportErrorMessage(null)).toBe('null');
    expect(getRayenImportErrorMessage('Plain failure')).toBe('Plain failure');
  });
});
