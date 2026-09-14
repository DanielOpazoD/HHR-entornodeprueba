import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCrossDayDiff,
  type CrossDayEntry,
} from '@/features/rayen-import/domain/applyCrossDayDiff';
import type { DischargeEntry } from '@/features/rayen-import/contracts/censusImportDiff';
import type {
  DailyRecord,
  PatientData,
} from '@/features/rayen-import/contracts/rayenDomainContracts';

const day = '2026-07-11';
const ctx = {
  idFactory: () => 'random-id',
  now: new Date(2026, 6, 12, 15, 30, 0),
  syncRunId: 'cross-day-run-1',
};
const sharedRun = '11.111.111-1';

const makeRecord = (discharges: DailyRecord['discharges'] = []): DailyRecord => ({
  date: day,
  beds: {},
  discharges,
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const dischargeEntry = (patientName: string, encounterId: string): DischargeEntry => ({
  bedId: 'H4C2',
  rut: sharedRun,
  patientName,
  encounterId,
  kind: 'alta',
  status: 'Vivo',
  reason: 'administrative-discharge',
  correctedDay: day,
  correctedTime: '14:44',
});

const patient = (patientName: string, clinicalEpisodeId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId: 'H4C2',
  rut: sharedRun,
  patientName,
  clinicalEpisodeId,
});

describe('historical mother and newborn discharge writer', () => {
  it('uses exact episodes, preserves nested scope, replays safely and repairs a partial run', () => {
    const motherEntry = dischargeEntry('Paciente Madre Sintética', '910001');
    const newbornEntry = dischargeEntry('Rn De Paciente Madre Sintética', '910080');
    const entries: CrossDayEntry[] = [
      { entry: motherEntry, patient: patient(motherEntry.patientName, '910001') },
      {
        entry: newbornEntry,
        patient: { ...patient(newbornEntry.patientName, '910080'), bedMode: 'Cuna' },
        isNested: true,
      },
    ];

    const first = applyCrossDayDiff(makeRecord(), entries, ctx);
    expect(first.applied).toBe(2);
    expect(first.record.discharges.map(discharge => discharge.id).sort()).toEqual([
      'rayen-egreso:episode-910001:2026-07-11',
      'rayen-egreso:episode-910080:2026-07-11',
    ]);
    expect(first.record.discharges.filter(discharge => discharge.isNested)).toHaveLength(1);

    const replay = applyCrossDayDiff(first.record, entries, ctx);
    expect(replay.applied).toBe(0);
    expect(replay.record.discharges).toHaveLength(2);

    const motherOnly = makeRecord(
      first.record.discharges.filter(discharge => discharge.clinicalEpisodeId === '910001')
    );
    const repaired = applyCrossDayDiff(motherOnly, entries, ctx);
    expect(repaired.applied).toBe(1);
    expect(repaired.record.discharges).toHaveLength(2);
    expect(repaired.record.discharges.find(discharge => discharge.isNested)).toMatchObject({
      clinicalEpisodeId: '910080',
    });
  });
});
