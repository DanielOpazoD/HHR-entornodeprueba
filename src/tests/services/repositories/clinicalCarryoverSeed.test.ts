import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { seedClinicalCarryover } from '@/services/repositories/clinicalCarryoverSeed';
import { parsePatientDataWithDefaults } from '@/schemas/zodSchemas';
import type { PatientData } from '@/types/domain/patient';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
const { seedPatient, applyTrustedClinicalCarryover } = createRequire(import.meta.url)(
  '../../../../functions/lib/clinicalCarryoverSeed.js'
);
const vital: PatientVitalSigns = {
  sourceEventId: 'synthetic-event',
  recordedDate: '2026-10-18',
  recordedAt: '2026-10-18 08:30',
  systolic: 120,
  diastolic: 80,
  heartRate: 70,
  spo2: 98,
  temperature: 36.5,
  respiratoryRate: null,
  painEva: null,
  hgt: null,
  insulinUnits: null,
  insulinQuadrant: null,
  observations: null,
  author: '',
  authorRole: '',
};
const patient = (): PatientData => ({
  ...createEmptyPatient('R1'),
  rut: '12345678-5',
  patientName: 'PRUEBA SINTETICA',
  clinicalEpisodeId: 'synthetic-1',
  admissionDate: '2026-10-17',
  admissionTime: '08:00',
  vitalSigns: { ...vital },
  vitalSignsHistory: [{ ...vital }],
  devices: ['CVC'],
  deviceDetails: { CVC: { installationDate: '2026-10-17' } },
  deviceInstanceHistory: [
    {
      id: 'synthetic-device',
      type: 'CVC',
      clinicalEpisodeId: 'synthetic-1',
      patientRut: '12345678-5',
      installationDate: '2026-10-17',
      installationTime: '09:30',
      status: 'Active',
      createdAt: 1,
      updatedAt: 1,
    },
  ],
});
const destination = (source: PatientData): PatientData => {
  const next = { ...source, bedId: 'R2', devices: [] };
  delete next.vitalSigns;
  delete next.vitalSignsHistory;
  delete next.deviceDetails;
  delete next.deviceInstanceHistory;
  return next;
};
const seed = (source: PatientData) =>
  seedClinicalCarryover(source, destination(source), '2026-10-18', '2026-10-19');

describe('clinical carryover seed', () => {
  it('preserves original evidence and dates, marks pending, and does not alias the source', () => {
    const source = patient();
    const before = structuredClone(source);
    const result = seed(source);
    expect(result.vitalSigns).toEqual(vital);
    expect(result.deviceInstanceHistory).toEqual(source.deviceInstanceHistory);
    expect(result.clinicalCarryover).toEqual({
      sourceDate: '2026-10-18',
      clinicalEpisodeId: 'synthetic-1',
      vitalsPending: true,
      devicesPending: true,
    });
    result.vitalSigns!.heartRate = 90;
    result.deviceInstanceHistory![0].installationDate = '2026-10-19';
    expect(source).toEqual(before);
  });
  it('does not inherit future or previous-admission vitals or stale coverage checkpoints', () => {
    const source = patient();
    source.vitalSignsHistory!.push(
      { ...vital, sourceEventId: 'future', recordedDate: '2026-10-20' },
      { ...vital, sourceEventId: 'old', recordedDate: '2026-10-16' }
    );
    source.clinicalSyncCheckpoint = {
      version: 3,
      fingerprintVersion: 1,
      sources: { scales: { lastFullValidationAt: '2026-10-18T12:00:00Z' } },
    };
    const result = seed(source);
    expect(result.vitalSignsHistory).toEqual([vital]);
    expect(result.clinicalSyncCheckpoint).toBeUndefined();
  });
  it('keeps retirement evidence without reactivating a removed device', () => {
    const source = patient();
    source.deviceInstanceHistory![0].status = 'Removed';
    source.deviceInstanceHistory![0].removalDate = '2026-10-18';
    expect(seed(source).devices).toEqual([]);
    expect(seed(source).deviceInstanceHistory![0].removalDate).toBe('2026-10-18');
  });
  it('preserves a reinserted active instance despite a retired type summary on client and authority', () => {
    const source = patient();
    const old = source.deviceInstanceHistory![0];
    old.status = 'Removed';
    old.removalDate = '2026-10-18';
    source.deviceDetails!.CVC.removalDate = '2026-10-18';
    source.deviceInstanceHistory!.push({
      ...old,
      id: 'reinserted',
      status: 'Active',
      installationDate: '2026-10-18',
      installationTime: '15:00',
      removalDate: undefined,
    });
    const before = structuredClone(source);
    const result = seed(source);
    expect(result.devices).toEqual(['CVC']);
    expect(result.deviceDetails!.CVC).toEqual({ installationDate: '2026-10-18' });
    expect(result.deviceInstanceHistory).toEqual(source.deviceInstanceHistory);
    expect(result.clinicalCarryover!.devicesPending).toBe(true);
    expect(seedPatient(source, destination(source), '2026-10-18', '2026-10-19')).toEqual(result);
    expect(source).toEqual(before);
  });
  it('rebuilds a missing active summary from owned active instances, without foreign devices', () => {
    const source = patient();
    source.devices = [];
    source.deviceInstanceHistory!.push({
      ...source.deviceInstanceHistory![0],
      id: 'foreign',
      type: 'CUP',
      clinicalEpisodeId: 'another-episode',
    });
    const result = seed(source);
    expect(result.devices).toEqual(['CVC']);
    expect(result.clinicalCarryover!.devicesPending).toBe(true);
    expect(result.deviceInstanceHistory).toHaveLength(1);
    expect(seedPatient(source, destination(source), '2026-10-18', '2026-10-19')).toEqual(result);
    expect(source.devices).toEqual([]);
  });
  it('excludes foreign episode devices even if the bed retained the same type', () => {
    const source = patient();
    source.deviceInstanceHistory![0].clinicalEpisodeId = 'old-episode';
    expect(seed(source).devices).toEqual([]);
    expect(seed(source).deviceInstanceHistory).toEqual([]);
  });
  it('preserves pending provenance through the persisted patient schema', () => {
    expect(parsePatientDataWithDefaults(seed(patient()), 'R2').clinicalCarryover).toEqual(
      seed(patient()).clinicalCarryover
    );
  });
  it('produces equivalent seeds on client and server', () => {
    const source = patient();
    expect(seedPatient(source, destination(source), '2026-10-18', '2026-10-19')).toEqual(
      seed(source)
    );
  });
  it('server uses trusted prior values, ignoring fabricated clinical values in the request', () => {
    const source = patient();
    const request = seed(source);
    request.vitalSigns!.heartRate = 999;
    const result = applyTrustedClinicalCarryover({
      candidate: { date: '2026-10-19', beds: { R2: destination(source) } },
      requested: { beds: { R2: request } },
      priorRecord: { date: '2026-10-18', beds: { R1: source } },
    });
    expect(result.beds.R2.vitalSigns.heartRate).toBe(70);
  });
  it('server cannot seed from an ambiguous or changed episode', () => {
    const source = patient();
    const candidate = { date: '2026-10-19', beds: { R2: destination(source) } };
    const requested = { beds: { R2: seed(source) } };
    const result = applyTrustedClinicalCarryover({
      candidate,
      requested,
      priorRecord: { date: '2026-10-18', beds: { R1: source, R3: { ...source } } },
    });
    expect(result.beds.R2.vitalSigns).toBeUndefined();
  });
});

import {
  verifyCarriedVitals,
  verifyCarriedDevices,
  reconcileCarriedDeviceRetirements as reconcileRetirements,
} from '@/features/rayen-import/domain/clinicalCarryoverVerification';
import { mergeReportVitals } from '@/features/rayen-import/domain/mergeReportVitals';
import { mergeReportDevices } from '@/features/rayen-import/domain/mergeReportDevices';
import { buildClinicalPatientPatch } from '@/features/rayen-import/domain/clinicalPatientPatch';

const reconcileCarriedDeviceRetirements = (
  patient: PatientData,
  entries: Parameters<typeof reconcileRetirements>[1],
  date: string
) => reconcileRetirements(patient, entries, date, new Date('2026-10-19T16:00:00Z'));

describe('first synchronization after carryover', () => {
  it('never turns an empty or failed source response into verification', () => {
    const copied = seed(patient());
    expect(verifyCarriedVitals(copied, [])).toBe(copied);
    expect(verifyCarriedDevices(copied, [])).toBe(copied);
  });
  it('persists only provenance when the same vital arrives, instead of rewriting its values', () => {
    const copied = seed(patient());
    const verified = mergeReportVitals(verifyCarriedVitals(copied, [vital]), [vital], '2026-10-19');
    expect(Object.keys(buildClinicalPatientPatch(copied, verified, 'R2', false).patch)).toEqual([
      'beds.R2.clinicalCarryover',
    ]);
    expect(verified.clinicalCarryover?.vitalsPending).toBe(false);
    expect(verified.clinicalCarryover?.devicesPending).toBe(true);
  });
  it('accepts a correction under the original measurement identity without changing its date', () => {
    const copied = seed(patient());
    const corrected = { ...vital, heartRate: 75 };
    const result = mergeReportVitals(
      verifyCarriedVitals(copied, [corrected]),
      [corrected],
      '2026-10-19'
    );
    expect(result.vitalSigns?.heartRate).toBe(75);
    expect(result.vitalSigns?.recordedDate).toBe('2026-10-18');
    expect(result.vitalSignsHistory).toHaveLength(1);
  });
  it('uses only explicit instance-level retirement and does not resurrect it from an old active row', () => {
    const copied = seed(patient());
    const result = reconcileCarriedDeviceRetirements(
      copied,
      [
        {
          name: 'CVC',
          installationDatetime: '2026-10-17T09:30:00',
          removedDatetime: '2026-10-19T10:00:00',
        },
      ],
      '2026-10-19'
    );
    expect(result.devices).toEqual([]);
    expect(result.deviceInstanceHistory![0].removalTime).toBe('10:00');
    const resynced = mergeReportDevices(
      result,
      [
        {
          type: 'CVC',
          installationDate: '2026-10-17',
          installationTime: '09:30',
          location: '',
          note: '',
        },
      ],
      { now: new Date('2026-10-19T16:00:00Z'), createId: () => 'unused' }
    );
    expect(resynced.devices).toEqual([]);
  });
  it('does not infer retirement from absence, ambiguity or a future removal', () => {
    const copied = seed(patient());
    expect(reconcileCarriedDeviceRetirements(copied, [], '2026-10-19')).toBe(copied);
    const entry = {
      name: 'CVC',
      installationDatetime: '2026-10-17T09:30:00',
      removedDatetime: '2026-10-20T10:00:00',
    };
    expect(reconcileCarriedDeviceRetirements(copied, [entry], '2026-10-19')).toBe(copied);
    const ambiguous = {
      ...copied,
      deviceInstanceHistory: [
        ...copied.deviceInstanceHistory!,
        { ...copied.deviceInstanceHistory![0], id: 'second' },
      ],
    };
    expect(
      reconcileCarriedDeviceRetirements(
        ambiguous,
        [{ ...entry, removedDatetime: '2026-10-19T10:00:00' }],
        '2026-10-19'
      )
    ).toBe(ambiguous);
  });
  it('verifies a device only with its original installation timestamp and episode', () => {
    const copied = seed(patient());
    const device = {
      type: 'CVC',
      installationDate: '2026-10-17',
      installationTime: '09:30',
      location: '',
      note: '',
    };
    expect(verifyCarriedDevices(copied, [{ ...device, installationTime: '10:30' }])).toBe(copied);
    expect(verifyCarriedDevices(copied, [device]).clinicalCarryover?.devicesPending).toBe(false);
  });
});

it('matches a carried VVP by installation evidence when the source renumbers its row', () => {
  const source = patient();
  source.devices = ['VVP#2'];
  source.deviceDetails = {};
  source.deviceInstanceHistory![0].type = 'VVP#2';
  const copied = seed(source);
  const refreshed = mergeReportDevices(
    copied,
    [
      {
        type: 'VVP#1',
        installationDate: '2026-10-17',
        installationTime: '09:30',
        location: '',
        note: '',
      },
    ],
    { now: new Date('2026-10-19T16:00:00Z'), createId: () => 'must-not-create' }
  );
  expect(refreshed.devices).toEqual(['VVP#2']);
  expect(refreshed.deviceInstanceHistory).toHaveLength(1);
});

it('does not overwrite the installation of a carried device when a new instance appears', () => {
  const copied = seed(patient());
  const refreshed = mergeReportDevices(
    copied,
    [
      {
        type: 'CVC',
        installationDate: '2026-10-19',
        installationTime: '11:00',
        location: '',
        note: '',
      },
    ],
    { now: new Date('2026-10-19T16:00:00Z'), createId: () => 'synthetic-new-device' }
  );
  expect(refreshed.deviceInstanceHistory).toHaveLength(2);
  expect(refreshed.deviceInstanceHistory![0].installationDate).toBe('2026-10-17');
  expect(refreshed.clinicalCarryover?.devicesPending).toBe(true);
});

it('does not apply a removal scheduled later today in Pacific/Easter', () => {
  const copied = seed(patient());
  const result = reconcileCarriedDeviceRetirements(
    copied,
    [
      {
        name: 'CVC',
        installationDatetime: '2026-10-17T09:30:00',
        removedDatetime: '2026-10-19T18:00:00',
      },
    ],
    '2026-10-19'
  );
  expect(result).toBe(copied);
});

it('retains provenance for a retirement-only seed and prevents later stale reactivation', () => {
  const source = patient();
  delete source.vitalSigns;
  delete source.vitalSignsHistory;
  source.devices = [];
  source.deviceInstanceHistory![0].status = 'Removed';
  source.deviceInstanceHistory![0].removalDate = '2026-10-18';
  const copied = seed(source);
  expect(copied.clinicalCarryover).toEqual({
    sourceDate: '2026-10-18',
    clinicalEpisodeId: 'synthetic-1',
    vitalsPending: false,
    devicesPending: false,
  });
  expect(seedPatient(source, destination(source), '2026-10-18', '2026-10-19')).toEqual(copied);
  const refreshed = mergeReportDevices(
    copied,
    [
      {
        type: 'CVC',
        installationDate: '2026-10-17',
        installationTime: '09:30',
        location: '',
        note: '',
      },
    ],
    { now: new Date('2026-10-19T16:00:00Z'), createId: () => 'must-not-create' }
  );
  expect(refreshed.devices).toEqual([]);
  expect(refreshed.deviceInstanceHistory).toHaveLength(1);
});
