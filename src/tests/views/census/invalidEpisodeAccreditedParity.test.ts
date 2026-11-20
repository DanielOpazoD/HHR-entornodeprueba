// @vitest-environment node
/**
 * «Paciente no válido» against main (W21-ID2). Each case runs the real decision, the real mark
 * service and the real previous-day cleanup over an in-memory repository, and counts what reaches
 * storage: marks written, beds cleared today, beds cleared yesterday (own episode or another
 * person). The legacy rows reproduce the W20 probe: two newborns first saved as «RN» on the same
 * day share one `legacy_ep_` hash after they get their names.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { DataFactory } from '@/tests/factories/DataFactory';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` })),
  setDoc: vi.fn(async () => undefined),
  getDocFromServer: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIME'),
}));
vi.mock('firebase/firestore', async importOriginal => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  ...firestore,
}));

import { ensurePatientClinicalEpisodeId } from '@/domain/clinical-episode/clinicalEpisodeIdPolicy';
import { executeRowActionController } from '@/features/census/controllers/censusRowActionRuntimeController';
import { cleanAndDescribePreviousDay } from '@/features/census/controllers/invalidEpisodePreviousDayCleanup';
import { buildDischargeRowActions } from '@/features/census/controllers/censusDischargesTableController';
import { buildPatientActionSectionBinding } from '@/features/census/controllers/patientRowActionSectionBindingsController';
import { markClinicalEpisodeInvalid } from '@/services/census/invalidClinicalEpisodeService';

// 13:00 in Rapa Nui on 2026-11-05: today's census day is 2026-11-05, yesterday is still editable.
const now = new Date('2026-11-05T18:00:00Z');
const TODAY = '2026-11-05';

const adapter = {
  readyFirestore: Promise.resolve(),
  getDb: () => ({}),
  getAuth: () => ({ currentUser: { uid: 'usuario_sintetico' } }),
} as unknown as FirebaseConfigRuntimeAdapter;

const newbornSavedAsRn = (bedId: string, name: string): PatientData => {
  const saved = ensurePatientClinicalEpisodeId(
    DataFactory.createMockPatient(bedId, {
      patientName: 'RN',
      rut: '',
      age: '1d',
      admissionDate: '2026-11-04',
      admissionTime: '',
      clinicalEpisodeId: undefined,
    })
  );
  return { ...saved, patientName: name };
};
const legacyAlfa = newbornSavedAsRn('NEO1', 'RN Alfa');
const legacyBeta = newbornSavedAsRn('NEO2', 'RN Beta');

const patient = (bedId: string, clinicalEpisodeId: string, patientName = 'Paciente Sintética') =>
  DataFactory.createMockPatient(bedId, { patientName, clinicalEpisodeId });

const yesterdayWith = (
  beds: Record<string, PatientData>,
  overrides: Partial<DailyRecord> = {}
): DailyRecord =>
  DataFactory.createMockDailyRecord('2026-11-04', {
    lastUpdated: '2026-11-04T23:00:00.000Z',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    ...overrides,
  });

interface Measured {
  marks: number;
  today: number;
  yesterdayOwn: number;
  yesterdayForeign: number;
  result: string;
}

/** The bed row menu → command → mark → clear today → previous-day cleanup, as the census wires it. */
const runBedAction = async (
  action: 'invalid' | 'clear',
  selected: PatientData,
  yesterday: DailyRecord
): Promise<Measured> => {
  firestore.setDoc.mockClear();
  const clearedYesterday: string[] = [];
  let today = 0;
  const result = await executeRowActionController({
    action,
    bedId: selected.bedId,
    patient: selected,
    stabilityRules: { canPerformActions: true } as never,
    confirmRuntime: { confirm: async () => true },
    confirmedLastUpdated: '2026-11-05T16:00:00.000Z',
    actions: {
      clearPatient: async () => {
        today += 1;
        return true;
      },
      addCMA: vi.fn(),
      setMovement: vi.fn(),
      openDischarge: vi.fn(),
      openTransfer: vi.fn(),
      markInvalidEpisode: mark =>
        markClinicalEpisodeInvalid({ ...mark, censusDate: TODAY }, adapter),
      cleanInvalidEpisodePreviousDay: clinicalEpisodeId =>
        cleanAndDescribePreviousDay({
          censusDate: TODAY,
          clinicalEpisodeId,
          now,
          repository: {
            getAuthoritativeForDate: async () => yesterday,
            updatePartialDetailed: async (_day, patch) => {
              Object.keys(patch)
                .filter(path => /^beds\.[^.]+$/.test(path))
                .forEach(path => clearedYesterday.push(path.slice('beds.'.length)));
              return {
                date: '2026-11-04',
                state: 'confirmed',
                localCopy: 'current',
                savedHere: true,
              };
            },
          },
        }),
    },
  });
  const ownEpisode = selected.clinicalEpisodeId?.trim();
  const isOwn = (bedId: string) =>
    yesterday.beds[bedId]?.patientName === selected.patientName &&
    yesterday.beds[bedId]?.clinicalEpisodeId?.trim() === ownEpisode;
  return {
    marks: firestore.setDoc.mock.calls.length,
    today,
    yesterdayOwn: clearedYesterday.filter(isOwn).length,
    yesterdayForeign: clearedYesterday.filter(bedId => !isOwn(bedId)).length,
    result: result.ok ? `applied:${result.value.applied}` : result.error.code,
  };
};

const menuOffersInvalid = (data: PatientData): boolean =>
  buildPatientActionSectionBinding({
    isBlocked: false,
    readOnly: false,
    actionMenuAlign: 'top',
    data,
    currentDateString: TODAY,
    indicators: { hasClinicalDocument: false, isNewAdmission: false },
    mainRowViewState: {
      canToggleBedType: true,
      rowClassName: 'row',
      rowActionsAvailability: {
        canOpenClinicalDocuments: false,
        canOpenExamRequest: false,
        canOpenImagingRequest: false,
        canOpenHistory: false,
        canShowClinicalDocumentIndicator: false,
      },
      showBlockedContent: false,
    },
    onAction: vi.fn(),
    onOpenDemographics: vi.fn(),
    onOpenClinicalDocuments: vi.fn(),
    onOpenExamRequest: vi.fn(),
    onOpenImagingRequest: vi.fn(),
    onOpenHistory: vi.fn(),
  }).canMarkInvalid === true;

const dischargeOffersInvalid = (clinicalEpisodeId: string): boolean =>
  buildDischargeRowActions(
    DataFactory.createMockDischarge({ id: 'alta-1', bedId: 'NEO1', clinicalEpisodeId }),
    {
      undoDischarge: vi.fn(),
      viewClinicalDocuments: vi.fn(),
      openHospitalizationReports: vi.fn(),
      editDischarge: vi.fn(),
      deleteDischarge: vi.fn(),
      convertDischargeToCma: vi.fn(),
      markDischargeInvalid: vi.fn(),
    }
  ).some(action => action.kind === 'invalid');

describe('«Paciente no válido» parity with main (W21-ID2)', () => {
  beforeEach(() => firestore.setDoc.mockClear());

  it('the two newborns of the probe share one legacy hash', () => {
    expect(legacyAlfa.clinicalEpisodeId).toMatch(/^legacy_ep_/);
    expect(legacyAlfa.clinicalEpisodeId).toBe(legacyBeta.clinicalEpisodeId);
  });

  it('a legacy episode: marks, clears today and clears the other newborn yesterday', async () => {
    expect(await runBedAction('invalid', legacyAlfa, yesterdayWith({ NEO2: legacyBeta }))).toEqual({
      marks: 1,
      today: 1,
      yesterdayOwn: 0,
      yesterdayForeign: 1,
      result: 'applied:true',
    });
  });

  it('a legacy episode is offered in the bed menu and on its alta', () => {
    expect(menuOffersInvalid(legacyAlfa)).toBe(true);
    expect(dischargeOffersInvalid(String(legacyAlfa.clinicalEpisodeId))).toBe(true);
  });

  it.each([
    ['an Eloísa episode', '900200'],
    ['an Eloísa episode with spaces', ' 900200 '],
    ['a local admission episode', 'ep_0f9c2a'],
  ])('%s: marks, clears today and clears only its own bed yesterday', async (_case, episode) => {
    const selected = patient('BOX2', episode);
    const yesterday = yesterdayWith({
      BOX2: patient('BOX2', episode.trim()),
      H1C1: patient('H1C1', '900100', 'Otra Paciente'),
    });
    expect(await runBedAction('invalid', selected, yesterday)).toEqual({
      marks: 1,
      today: 1,
      yesterdayOwn: 1,
      yesterdayForeign: 0,
      result: 'applied:true',
    });
    expect(menuOffersInvalid(selected)).toBe(true);
    expect(dischargeOffersInvalid(episode)).toBe(true);
  });

  it('an accredited episode on a signed previous day leaves that day for review', async () => {
    const yesterday = yesterdayWith(
      { BOX2: patient('BOX2', '900200') },
      { medicalSignature: { doctorName: 'Médico Sintético', signedAt: '2026-11-05T09:00:00Z' } }
    );
    expect(await runBedAction('invalid', patient('BOX2', '900200'), yesterday)).toEqual({
      marks: 1,
      today: 1,
      yesterdayOwn: 0,
      yesterdayForeign: 0,
      result: 'PREVIOUS_DAY_PENDING',
    });
  });

  it.each([
    ['no episode', ''],
    ['a blank episode', '   '],
  ])('%s: nothing is marked or cleared', async (_case, episode) => {
    const selected = patient('BOX2', episode);
    expect(await runBedAction('invalid', selected, yesterdayWith({}))).toEqual({
      marks: 0,
      today: 0,
      yesterdayOwn: 0,
      yesterdayForeign: 0,
      result: 'EPISODE_REQUIRED',
    });
    expect(menuOffersInvalid(selected)).toBe(false);
    expect(dischargeOffersInvalid(episode)).toBe(false);
  });

  it('«Limpiar» still clears a legacy patient today and writes no mark', async () => {
    expect(await runBedAction('clear', legacyAlfa, yesterdayWith({ NEO2: legacyBeta }))).toEqual({
      marks: 0,
      today: 1,
      yesterdayOwn: 0,
      yesterdayForeign: 0,
      result: 'applied:true',
    });
  });
});
