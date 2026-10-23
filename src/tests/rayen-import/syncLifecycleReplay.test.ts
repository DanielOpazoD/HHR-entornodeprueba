import { describe, expect, it } from 'vitest';
import type { EgresoReportRow, RayenEncounter } from '@/features/rayen-import';
import {
  captureFor,
  emptyRecordFor,
  syncBundleFor,
  syntheticEncounter,
  vitalSignsForm,
} from './deterministicClinicalReplay.fixtures';
import { getStatisticalDischarges } from '@/application/census/movementTombstonePolicy';
import { replay } from './deterministicClinicalReplay.harness';

const day = '2026-08-15';
const noChanges = { admissions: 0, updates: 0, moves: 0, discharges: 0 };
const clocks = [
  ['hoy', '2026-08-15T20:00:00-06:00'],
  ['ayer', '2026-08-16T12:00:00-06:00'],
] as const;
const discharge = (patient: RayenEncounter, bedLabel: string): EgresoReportRow => ({
  run: patient.run,
  encounterId: patient.encounterId,
  patientName: `${patient.firstGivenName} ${patient.firstFamilyName}`,
  bedLabel,
  servicio: patient.service ?? '',
  edad: '',
  motivo: 'Alta hospitalaria',
  destino: 'Domicilio',
  fechaEgreso: '15-08-2026 18:30',
  correctedDay: day,
  correctedTime: '18:30',
  admissionDay: day,
  admissionTime: '10:00',
  exactEpisodeVerification: 'verified',
});

// The replay crosses bridge correlation, planning, JSON/schema persistence and clinical audit.
// External evidence is synthetic; the planner, applier and clinical decisions remain real.
describe.each(clocks)('sequential synchronization of %s', (_label, clock) => {
  it('admits, moves, discharges and repeats without losing handoff or duplicating movements', async () => {
    const now = new Date(clock);
    const patient = syntheticEncounter('admission');
    const evidence = { formsByEpisode: { [patient.encounterId]: [vitalSignsForm(day, 301)] } };
    const first = await replay(emptyRecordFor(day), captureFor(day, [patient]), evidence, now);
    expect(first.record.beds.H1C1.clinicalEpisodeId).toBe(patient.encounterId);
    first.record.beds.H1C1.handoffNoteNightShift = 'Observación corregida localmente';
    const beforeMove = structuredClone(first.record);
    const movedPatient = { ...patient, room: 'H2', bed: 'C2' };
    const moved = await replay(first.record, captureFor(day, [movedPatient]), evidence, now);
    expect(first.record).toEqual(beforeMove);
    expect(moved.structural.applied.moves).toBe(1);
    expect(moved.record.beds.H1C1.patientName).toBe('');
    expect(moved.record.beds.H2C2).toMatchObject({
      clinicalEpisodeId: patient.encounterId,
      handoffNoteNightShift: 'Observación corregida localmente',
    });
    expect(moved.record.beds.H2C2.vitalSignsHistory).toHaveLength(1);
    const unchanged = await replay(moved.record, captureFor(day, [movedPatient]), evidence, now);
    expect(unchanged.structural.applied).toEqual(noChanges);
    const finalCapture = captureFor(day, [], [discharge(movedPatient, 'H2C2')]);
    const closed = await replay(unchanged.record, finalCapture, evidence, now);
    expect(closed.record.discharges).toHaveLength(1);
    expect(closed.record.discharges[0]).toMatchObject({
      clinicalEpisodeId: patient.encounterId,
      bedId: 'H2C2',
      time: '18:30',
    });
    const repeated = await replay(closed.record, finalCapture, evidence, now);
    expect(repeated.record.discharges).toEqual(closed.record.discharges);
    expect(repeated.structural.applied).toEqual(noChanges);
    expect(repeated.clinicalWrites).toBe(0);
    for (const result of [first, moved, unchanged, closed, repeated]) {
      expect(result.terminalEvent.status).toBe('complete');
      expect(result.presentation.unresolved).toBe(false);
      expect(result.record.date).toBe(day);
    }
  });

  it('keeps a newborn after maternal discharge until its own outcome arrives, then never resurrects it', async () => {
    const now = new Date(clock);
    const mother = syntheticEncounter('mother', { room: 'H5', bed: 'C1' });
    const newborn = syntheticEncounter('newborn', {
      run: '',
      firstGivenName: 'RN de Caso',
      firstFamilyName: 'mother',
      birthDate: day,
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const admitted = await replay(emptyRecordFor(day), captureFor(day, [mother, newborn]), {}, now);
    expect(admitted.record.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe(newborn.encounterId);
    const maternalRow = discharge(mother, 'H5C1');
    const maternal = await replay(
      admitted.record,
      captureFor(day, [newborn], [maternalRow]),
      {},
      now
    );
    expect(maternal.record.discharges.map(row => row.clinicalEpisodeId)).toEqual([
      mother.encounterId,
    ]);
    expect(maternal.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: newborn.encounterId,
      bedMode: 'Cuna',
    });
    const neonatalRow = discharge(newborn, 'H5C1');
    const finalCapture = captureFor(day, [], [maternalRow, neonatalRow]);
    const closed = await replay(maternal.record, finalCapture, {}, now);
    expect(closed.record.discharges).toHaveLength(2);
    expect(
      closed.record.discharges.find(row => row.clinicalEpisodeId === newborn.encounterId)
    ).toMatchObject({ originalData: { bedMode: 'Cuna' } });
    expect(
      getStatisticalDischarges(closed.record.discharges).map(row => row.clinicalEpisodeId)
    ).toEqual([mother.encounterId]);
    const repeated = await replay(closed.record, finalCapture, {}, now);
    expect(repeated.record.discharges).toEqual(closed.record.discharges);
    expect(repeated.structural.applied).toEqual(noChanges);
    // Even a lagging source must not recreate an episode whose own discharge is recorded.
    const stale = await replay(
      repeated.record,
      captureFor(day, [mother, newborn], [maternalRow, neonatalRow]),
      {},
      now
    );
    expect(stale.record.discharges).toEqual(closed.record.discharges);
    expect(
      Object.values(stale.record.beds).some(
        patient => patient.patientName || patient.clinicalCrib?.patientName
      )
    ).toBe(false);
    expect(stale.terminalEvent.status).toBe('complete');
  });
});

it('retains an admission after midnight on the selected previous census across repeated synchronization', async () => {
  const now = new Date('2026-08-16T03:00:00-06:00');
  const patient = syntheticEncounter('admission', {
    admissionDatetime: '2026-08-16T00:20:00-06:00',
  });
  const capture = captureFor(day, [patient]);
  capture.snapshot.capturedAt = now.toISOString();
  // Keep the dual-source timestamps correlated with the actual overnight capture.
  capture.bundle = syncBundleFor(day, capture.snapshot);
  const first = await replay(emptyRecordFor(day), capture, {}, now);
  expect(first.record.beds.H1C1).toMatchObject({
    clinicalEpisodeId: patient.encounterId,
    admissionDate: '2026-08-16',
    admissionTime: '00:20',
  });
  expect(first.record.date).toBe(day);
  const repeated = await replay(first.record, capture, {}, now);
  expect(repeated.structural.applied).toEqual(noChanges);
  expect(repeated.terminalEvent.status).toBe('complete');
});

it('moves a known mother and healthy crib together despite stale crib location, then converges', async () => {
  const mother = syntheticEncounter('mother', { room: 'H5', bed: 'C1' });
  const newborn = syntheticEncounter('newborn', {
    run: '',
    firstGivenName: 'RN de Caso',
    firstFamilyName: 'mother',
    birthDate: day,
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
  });
  const first = await replay(emptyRecordFor(day), captureFor(day, [mother, newborn]));
  first.record.beds.H5C1.clinicalCrib!.handoffNoteNightShift = 'Nota propia del RN';
  const movedMother = { ...mother, room: 'H4', bed: 'C2' };
  const changed = captureFor(day, [movedMother, newborn]);
  const moved = await replay(first.record, changed);
  expect(moved.record.beds.H4C2).toMatchObject({
    clinicalEpisodeId: mother.encounterId,
    clinicalCrib: {
      clinicalEpisodeId: newborn.encounterId,
      bedMode: 'Cuna',
      handoffNoteNightShift: 'Nota propia del RN',
    },
  });
  expect(moved.record.beds.H5C1.clinicalCrib).toBeUndefined();
  const repeated = await replay(moved.record, changed);
  expect(repeated.structural.applied).toEqual(noChanges);
  expect(repeated.record.beds.H4C2.clinicalCrib).toEqual(moved.record.beds.H4C2.clinicalCrib);
  expect(repeated.record.discharges).toEqual([]);
  expect(repeated.terminalEvent.status).toBe('complete');
});

it('records mother and newborn own midnight outcomes on yesterday and preserves actual calendar dates', async () => {
  const now = new Date('2026-08-16T12:00:00-06:00');
  const mother = syntheticEncounter('mother', { room: 'H5', bed: 'C1' });
  const newborn = syntheticEncounter('newborn', {
    run: '',
    firstGivenName: 'RN de Caso',
    firstFamilyName: 'mother',
    birthDate: day,
    room: 'Cunas',
    bed: 'CH5C1',
    clinicalCribParentBedId: 'H5C1',
  });
  const first = await replay(emptyRecordFor(day), captureFor(day, [mother, newborn]), {}, now);
  const rows = [mother, newborn].map((patient, index) => ({
    ...discharge(patient, 'H5C1'),
    fechaEgreso: `16-08-2026 00:${17 + index * 2}`,
    correctedTime: `00:${17 + index * 2}`,
  }));
  const capture = captureFor(day, [], rows);
  capture.snapshot.capturedAt = now.toISOString();
  capture.bundle = syncBundleFor(day, capture.snapshot, rows);
  const closed = await replay(first.record, capture, {}, now);
  expect(closed.structural.skipped).toEqual([]);
  expect(closed.terminalEvent).toMatchObject({ status: 'complete' });
  expect(closed.record.date).toBe(day);
  expect(closed.record.discharges).toHaveLength(2);
  expect(closed.record.discharges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        clinicalEpisodeId: mother.encounterId,
        movementDate: '2026-08-16',
        time: '00:17',
      }),
      expect.objectContaining({
        clinicalEpisodeId: newborn.encounterId,
        movementDate: '2026-08-16',
        time: '00:19',
      }),
    ])
  );
  expect(getStatisticalDischarges(closed.record.discharges)).toHaveLength(1);
  const repeated = await replay(closed.record, capture, {}, now);
  expect(repeated.record.discharges).toEqual(closed.record.discharges);
  expect(repeated.structural.applied).toEqual(noChanges);
  expect(repeated.terminalEvent.status).toBe('complete');
});
