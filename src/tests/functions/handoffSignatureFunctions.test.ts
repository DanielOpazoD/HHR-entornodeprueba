import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { BEDS } from '@/constants/beds';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
const {
  createHandoffSignatureFunctions,
} = require('../../../functions/lib/handoffSignatureFunctions.js');
type RecordData = Record<string, unknown>;
type Ref = { name: string; id: string; get: () => Promise<unknown> };

const clone = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, clone(nested)])
    ) as T;
  }
  return value;
};

const createFirestoreMock = (initial: RecordData | null) => {
  let record = clone(initial);
  let version = 0;
  const updateRecord = vi.fn();
  const setAudit = vi.fn();
  const snapshot = () => {
    const current = clone(record);
    return { exists: current !== null, data: () => current };
  };
  const firestore = {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({
          doc: (id: string): Ref => ({ name, id, get: async () => snapshot() }),
        }),
      }),
    }),
    runTransaction: vi.fn(async (handler: (transaction: unknown) => Promise<unknown>) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const readVersion = version;
        const readSnapshot = snapshot();
        let patch: RecordData | undefined;
        let audit: RecordData | undefined;
        const result = await handler({
          get: async () => readSnapshot,
          update: (_ref: Ref, data: RecordData) => {
            patch = data;
          },
          set: (_ref: Ref, data: RecordData) => {
            audit = data;
          },
        });
        if (readVersion !== version) continue;
        if (patch && record) {
          if (audit) setAudit(audit);
          const next = clone(record);
          for (const [path, value] of Object.entries(patch)) {
            if (path.startsWith('medicalSignatureByScope.')) {
              next.medicalSignatureByScope = {
                ...((next.medicalSignatureByScope as RecordData) || {}),
                [path.split('.')[1]]: value,
              };
            } else next[path] = value;
          }
          record = next;
          version++;
          updateRecord(patch);
        }
        return result;
      }
      throw new Error('Transaction retries exhausted');
    }),
  };
  return { firestore, updateRecord, setAudit, readRecord: () => record };
};

const signatureRequest = (overrides: RecordData = {}) => ({
  date: '2026-03-03',
  scope: 'upc',
  token: 'upc-token',
  doctorName: 'Dra. Sintética',
  ...overrides,
});
const fixture = () => ({
  date: '2026-03-03',
  lastUpdated: '2026-03-03T12:00:00Z',
  medicalSignatureLinkTokenByScope: {
    all: 'all-token',
    upc: 'upc-token',
    'no-upc': 'no-upc-token',
  },
  activeExtraBeds: ['R4', 'E1'],
  nursesNightShift: ['NURSING-SECRET'],
  handoffNovedadesDayShift: 'NURSING-SECRET',
  discharges: [{ patientName: 'MOVEMENT-SECRET' }],
  rayenSync: { secret: 'SYNC-SECRET' },
  medicalHandoffNovedades: 'GLOBAL-MEDICAL-NOTE',
  medicalHandoffBySpecialty: { medicinaInterna: { note: 'GLOBAL-MEDICAL-NOTE' } },
  beds: {
    R4: {
      patientName: 'Paciente UPC sintético',
      isUPC: false,
      upcChecklist: { uciCriteria: ['criterion'], utiCriteria: [] },
      handoffNoteNightShift: 'NURSING-SECRET',
      fhir_resource: { secret: 'FHIR-SECRET' },
      medicalHandoffNote: 'Nota médica',
      medicalHandoffEntries: [
        {
          id: 'note',
          specialty: 'Medicina',
          note: 'Evolución',
          updatedBy: { displayName: 'Dra. Sintética', email: 'PRIVATE-EMAIL', uid: 'PRIVATE-UID' },
          unexpected: 'ENTRY-SECRET',
        },
      ],
      clinicalCrib: {
        patientName: 'RN sintético',
        medicalHandoffNote: 'Nota RN',
        handoffNoteDayShift: 'NURSING-SECRET',
        devices: ['DEVICE-SECRET'],
      },
    },
    H1C1: {
      patientName: 'Paciente No UPC sintético',
      isUPC: true,
      medicalHandoffNote: 'Otra nota',
    },
    E1: { patientName: 'Extra sintético', isUPC: false },
  },
});

describe('functions handoffSignatureFunctions', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['all', 'upc', 'no-upc'])(
    'returns only medical data for scope %s without any link tokens',
    async scope => {
      const { firestore } = createFirestoreMock(fixture());
      const api = createHandoffSignatureFunctions({ firestore });
      const result = await api.getMedicalHandoffSignaturePayload.run(
        signatureRequest({ scope, token: `${scope}-token` })
      );
      expect(Object.keys(result.record.beds)).toEqual(
        scope === 'upc' ? ['R4'] : scope === 'no-upc' ? ['H1C1', 'E1'] : ['R4', 'H1C1', 'E1']
      );
      expect(result.record.activeExtraBeds).toEqual(
        scope === 'upc' ? ['R4'] : scope === 'no-upc' ? ['E1'] : ['R4', 'E1']
      );
      expect(result.record.discharges).toEqual([]);
      const serialized = JSON.stringify(result);
      for (const secret of [
        'all-token',
        'upc-token',
        'no-upc-token',
        'NURSING-SECRET',
        'MOVEMENT-SECRET',
        'SYNC-SECRET',
        'FHIR-SECRET',
        'ENTRY-SECRET',
        'PRIVATE-EMAIL',
        'PRIVATE-UID',
        'DEVICE-SECRET',
      ]) {
        expect(serialized).not.toContain(secret);
      }
      if (scope !== 'no-upc') {
        expect(result.record.beds.R4.isUPC).toBe(true);
        expect(result.record.beds.R4.clinicalCrib.medicalHandoffNote).toBe('Nota RN');
        expect(result.record.beds.R4.medicalHandoffEntries[0].note).toBe('Evolución');
      }
      expect(serialized.includes('GLOBAL-MEDICAL-NOTE')).toBe(scope === 'all');
    }
  );

  it('matches the client effective UPC policy for all bed definitions and legacy/checklist states', async () => {
    for (const checklist of [
      undefined,
      {
        uciCriteria: ['uci'],
        utiCriteria: [],
        classification: 'UPC_UCI' as const,
        evaluatedAt: '2026-03-03T12:00:00Z',
      },
      {
        uciCriteria: [],
        utiCriteria: ['uti'],
        classification: 'UPC_UTI' as const,
        evaluatedAt: '2026-03-03T12:00:00Z',
      },
      {
        uciCriteria: [],
        utiCriteria: [],
        classification: 'UPC_UTI' as const,
        evaluatedAt: '2026-03-03T12:00:00Z',
      },
    ]) {
      for (const isUPC of [false, true]) {
        const beds = Object.fromEntries(
          BEDS.map(bed => [bed.id, { isUPC, upcChecklist: checklist }])
        );
        const { firestore } = createFirestoreMock({ ...fixture(), beds });
        const api = createHandoffSignatureFunctions({ firestore });
        for (const scope of ['upc', 'no-upc']) {
          const result = await api.getMedicalHandoffSignaturePayload.run(
            signatureRequest({ scope, token: `${scope}-token` })
          );
          expect(Object.keys(result.record.beds)).toEqual(
            BEDS.filter(
              bed =>
                resolveEffectiveUpcState({ bedId: bed.id, isUPC, checklist }).isUpc ===
                (scope === 'upc')
            ).map(bed => bed.id)
          );
        }
      }
    }
  });

  it('returns only the requested signature and delivery timestamp, normalized for the client', async () => {
    const { firestore } = createFirestoreMock({
      ...fixture(),
      medicalSignatureByScope: {
        upc: { doctorName: 'Dra. UPC', signedAt: '2026-03-03T12:00:00Z', userAgent: 'PRIVATE-UA' },
        all: { doctorName: 'OTHER-SCOPE' },
      },
      medicalHandoffSentAtByScope: {
        upc: { toDate: () => new Date('2026-03-03T11:00:00Z'), toMillis: () => 0 },
        all: 'OTHER-SCOPE',
      },
    });
    const api = createHandoffSignatureFunctions({ firestore });
    const result = await api.getMedicalHandoffSignaturePayload.run(signatureRequest());
    expect(result.record.medicalSignatureByScope).toEqual({
      upc: { doctorName: 'Dra. UPC', signedAt: '2026-03-03T12:00:00Z' },
    });
    expect(result.record.medicalHandoffSentAtByScope).toEqual({ upc: '2026-03-03T11:00:00.000Z' });
    expect(result.alreadySigned).toBe(true);
  });

  it.each(['getMedicalHandoffSignaturePayload', 'submitMedicalHandoffSignature'])(
    'rejects invalid tokens in %s without writes',
    async method => {
      const { firestore, updateRecord, setAudit } = createFirestoreMock(fixture());
      const api = createHandoffSignatureFunctions({ firestore });
      await expect(
        api[method].run(signatureRequest({ token: 'invalid-token' }))
      ).rejects.toMatchObject({ code: 'permission-denied' });
      expect(updateRecord).not.toHaveBeenCalled();
      expect(setAudit).not.toHaveBeenCalled();
    }
  );

  it.each(['getMedicalHandoffSignaturePayload', 'submitMedicalHandoffSignature'])(
    'rejects missing records in %s',
    async method => {
      const { firestore } = createFirestoreMock(null);
      const api = createHandoffSignatureFunctions({ firestore });
      await expect(api[method].run(signatureRequest())).rejects.toMatchObject({
        code: 'not-found',
      });
    }
  );

  it('stores a scoped signature and audit atomically, including calls without userAgent', async () => {
    const { firestore, updateRecord, setAudit, readRecord } = createFirestoreMock(fixture());
    const api = createHandoffSignatureFunctions({ firestore });
    const result = await api.submitMedicalHandoffSignature.run(signatureRequest());
    expect(updateRecord).toHaveBeenCalledOnce();
    expect(updateRecord).toHaveBeenCalledWith(
      expect.objectContaining({ 'medicalSignatureByScope.upc': result.signature })
    );
    expect(setAudit).toHaveBeenCalledOnce();
    expect(setAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MEDICAL_HANDOFF_SIGNED',
        details: expect.objectContaining({ scope: 'upc' }),
      })
    );
    expect(result).toMatchObject({
      scope: 'upc',
      alreadySigned: false,
      signature: { doctorName: 'Dra. Sintética' },
    });
    expect(result.signature).not.toHaveProperty('userAgent');
    expect(readRecord()).not.toHaveProperty('medicalSignature');
  });

  it('preserves the first same-scope signature during concurrent submissions and sequential replay', async () => {
    const { firestore, updateRecord, setAudit, readRecord } = createFirestoreMock(fixture());
    const api = createHandoffSignatureFunctions({ firestore });
    const results = await Promise.all(
      ['Dra. Uno', 'Dr. Dos'].map(doctorName =>
        api.submitMedicalHandoffSignature.run(signatureRequest({ doctorName }))
      )
    );
    expect(results.map(result => result.alreadySigned).sort()).toEqual([false, true]);
    expect(results[0].signature).toEqual(results[1].signature);
    expect(readRecord()?.medicalSignatureByScope).toEqual({ upc: results[0].signature });
    const replay = await api.submitMedicalHandoffSignature.run(
      signatureRequest({ doctorName: 'Dr. Tres' })
    );
    expect(replay).toMatchObject({ alreadySigned: true, signature: results[0].signature });
    expect(updateRecord).toHaveBeenCalledOnce();
    expect(setAudit).toHaveBeenCalledOnce();
  });

  it('does not lose signatures when different scopes submit concurrently and mirrors all for legacy readers', async () => {
    const { firestore, updateRecord, setAudit, readRecord } = createFirestoreMock(fixture());
    const api = createHandoffSignatureFunctions({ firestore });
    const results = await Promise.all(
      ['all', 'upc', 'no-upc'].map(scope =>
        api.submitMedicalHandoffSignature.run(
          signatureRequest({ scope, token: `${scope}-token`, doctorName: scope })
        )
      )
    );
    expect(results.every(result => !result.alreadySigned)).toBe(true);
    expect(Object.keys(readRecord()?.medicalSignatureByScope as RecordData).sort()).toEqual([
      'all',
      'no-upc',
      'upc',
    ]);
    expect(readRecord()?.medicalSignature).toEqual(results[0].signature);
    expect(updateRecord).toHaveBeenCalledTimes(3);
    expect(setAudit).toHaveBeenCalledTimes(3);
  });

  it('keeps legacy all-scope signatures idempotent', async () => {
    const signature = { doctorName: 'Dr. Anterior', signedAt: '2026-03-03T08:00:00Z' };
    const { firestore, updateRecord, setAudit } = createFirestoreMock({
      ...fixture(),
      medicalSignature: signature,
    });
    const api = createHandoffSignatureFunctions({ firestore });
    expect(
      await api.submitMedicalHandoffSignature.run(
        signatureRequest({ scope: 'all', token: 'all-token' })
      )
    ).toMatchObject({ alreadySigned: true, signature });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(setAudit).not.toHaveBeenCalled();
  });

  it('does not commit a signature if the atomic audit write fails', async () => {
    const { firestore, updateRecord, setAudit, readRecord } = createFirestoreMock(fixture());
    setAudit.mockImplementation(() => {
      throw new Error('Synthetic audit failure');
    });
    const api = createHandoffSignatureFunctions({ firestore });
    await expect(api.submitMedicalHandoffSignature.run(signatureRequest())).rejects.toThrow(
      'Synthetic audit failure'
    );
    expect(updateRecord).not.toHaveBeenCalled();
    expect(readRecord()).not.toHaveProperty('medicalSignatureByScope');
  });
});
