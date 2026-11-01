import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mergeClinicalDeviceRead } from '@/features/rayen-import/domain/mergeClinicalDeviceRead';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { seedClinicalCarryover } from '@/services/repositories/clinicalCarryoverSeed';
import { parsePatientDataWithDefaults } from '@/schemas/zodSchemas';
import { calculateDeviceDays } from '@/components/device-selector/DeviceDateConfigModal';
import {
  buildModalSaveResult,
  buildDeviceBundleChangeResult,
} from '@/features/census/controllers/devicesCellController';
import { updateDeviceHistoryRecord } from '@/features/census/controllers/deviceHistoryModalController';
import type { RayenInvasiveDeviceEntry } from '@/features/rayen-import/mapping/mapDeviceToInstance';
import type { PatientData } from '@/types/domain/patient';
import type { DeviceRead } from '@/features/rayen-import/domain/clinicalPatientReaders';

const { seedPatient } = createRequire(import.meta.url)(
  '../../../functions/lib/clinicalCarryoverSeed.js'
);
const DAY = '2026-10-18';
const NOW = new Date('2026-10-19T04:30:00Z'); // Still the 18th in Rapa Nui.
const row = (name: string, time: string): RayenInvasiveDeviceEntry => ({
  name,
  installationDatetime: `2026-10-16T${time}:33.14-03:00`,
  removedDatetime: null,
  archived: false,
  deleted: false,
  location: 'Ubicación sintética',
});
const cvc = row('Catéter venoso central', '13:15');
const vvp1 = row('Vía venosa periférica', '14:25');
const vvp2 = row('Vía venosa periférica', '15:35');
const base = (): PatientData => ({
  ...createEmptyPatient('R1'),
  patientName: 'PACIENTE SINTETICO INVENTADO',
  rut: '99999991-1',
  clinicalEpisodeId: 'synthetic-device-episode',
  admissionDate: '2026-10-15',
});
const read = (entries: RayenInvasiveDeviceEntry[]): DeviceRead => ({
  source: 'json',
  entries,
  textItems: [],
});
let sequence = 0;
const deps = { now: () => NOW, createId: () => `synthetic-${++sequence}` };
const sync = (patient: PatientData, entries: RayenInvasiveDeviceEntry[], date = DAY) =>
  mergeClinicalDeviceRead(patient, read(entries), date, deps);
const installed = () => sync(base(), [cvc, vvp1, vvp2]);
const history = (patient: PatientData) => patient.deviceInstanceHistory!;

describe('current complete Eloísa JSON device reconciliation', () => {
  it('retires missing VVPs without carryover, keeps CVC, and uses the hospital day without inventing a time', () => {
    const before = installed();
    const result = sync(before, [cvc]);
    expect(result.devices).toEqual(['CVC']);
    expect(history(result).slice(1)).toEqual(
      history(before)
        .slice(1)
        .map(item => ({
          ...item,
          status: 'Removed',
          removalDate: DAY,
          removalSource: 'eloisa-absence',
        }))
    );
    expect(history(result)[1]).not.toHaveProperty('removalTime');
    expect(result.deviceDetails?.['VVP#1']?.removalDate).toBe(DAY);
    expect(history(before).every(item => item.status === 'Active')).toBe(true);
  });

  it('keeps the second VVP identity and slot when the first disappears and Eloísa renumbers it', () => {
    const before = installed();
    const result = sync(before, [cvc, vvp2]);
    expect(result.devices).toEqual(['CVC', 'VVP#2']);
    expect(history(result)).toHaveLength(3);
    expect(history(result)[1].status).toBe('Removed');
    expect(history(result)[2]).toEqual(history(before)[2]);
    expect(result.deviceDetails?.['VVP#2']).not.toHaveProperty('removalDate');
  });

  it('uses the new retirement in the summary when older removed instances follow the active one', () => {
    const before = sync(base(), [cvc]);
    history(before).push({
      ...history(before)[0],
      id: 'synthetic-older',
      source: 'manual',
      status: 'Removed',
      installationTime: '08:00',
      removalDate: '2026-10-17',
    });
    const result = sync(before, []);
    expect(result.devices).toEqual([]);
    expect(result.deviceDetails?.CVC?.removalDate).toBe(DAY);
  });

  it('tracks two CVC installations separately, retires the absent one, and keeps its active type summary', () => {
    const other = row('CVC', '16:45');
    const before = sync(base(), [other, cvc]);
    expect(history(before)).toHaveLength(2);
    const result = sync(before, [cvc]);
    expect(result.devices).toEqual(['CVC']);
    expect(history(result).map(item => item.status)).toEqual(['Removed', 'Active']);
    expect(result.deviceDetails?.CVC?.installationDate).toBe(history(result)[1].installationDate);
    expect(result.deviceDetails?.CVC).not.toHaveProperty('removalDate');
  });

  it('accepts an empty valid list, keeps manual/unknown devices, and leaves untracked devices alone', () => {
    const before = installed();
    history(before)[1].source = 'manual';
    delete history(before)[2].source;
    before.devices.push('SNG');
    before.deviceDetails!.SNG = { installationDate: '2026-10-15', note: 'Nota manual' };
    const result = sync(before, []);
    expect(result.devices).toEqual(['VVP#1', 'VVP#2', 'SNG']);
    expect(history(result).map(item => item.status)).toEqual(['Removed', 'Active', 'Active']);
    expect(result.deviceDetails?.SNG).toEqual(before.deviceDetails?.SNG);
  });

  it('keeps an unmarked or manual installation even when an explicit source retirement shares its timestamp', () => {
    for (const source of ['manual', undefined] as const) {
      const before = sync(base(), [cvc]);
      history(before)[0].source = source;
      expect(sync(before, [{ ...cvc, removedDatetime: '2026-10-18T12:00:00-03:00' }])).toBe(before);
    }
  });

  it('does not infer legacy provenance from complete installation time, location or a generated-looking note', () => {
    const before = installed();
    for (const item of history(before)) {
      delete item.source;
      item.note = 'Ubicación sintética · Vence: 2026-10-30 08:00';
    }
    expect(sync(before, [])).toBe(before);
  });

  it('retires unmarked instances whose note only the JSON import writes, keeps the listed one, and can reactivate', () => {
    const legacy = (type: string, date: string, time: string, id: string) => ({
      id,
      type,
      clinicalEpisodeId: 'synthetic-device-episode',
      status: 'Active' as const,
      installationDate: date,
      installationTime: time,
      location: 'Ubicación sintética',
      note: 'Ubicación sintética · Vence: 2026-11-28T02:00:00-03:00',
      createdAt: 1,
      updatedAt: 1,
    });
    const before: PatientData = {
      ...base(),
      devices: ['CVC', 'VVP#1', 'VVP#2', 'VVP#3'],
      deviceInstanceHistory: [
        legacy('CVC', '2026-10-15', '18:00', 'old-cvc'),
        legacy('VVP#1', '2026-10-15', '23:11', 'old-vvp-1'),
        legacy('VVP#2', '2026-10-16', '23:06', 'old-vvp-2'),
        legacy('CVC', '2026-10-16', '13:15', 'listed-cvc'),
        { ...legacy('VVP#3', '2026-10-16', '01:00', 'manual-vvp'), source: 'manual' as const },
      ],
    };

    const result = sync(before, [cvc]);

    expect(result.devices).toEqual(['CVC', 'VVP#3']);
    const byId = (patient: PatientData, id: string) =>
      history(patient).find(item => item.id === id)!;
    for (const id of ['old-cvc', 'old-vvp-1', 'old-vvp-2']) {
      expect(byId(result, id)).toMatchObject({
        status: 'Removed',
        removalDate: DAY,
        removalSource: 'eloisa-absence',
      });
    }
    expect(byId(result, 'listed-cvc').status).toBe('Active');
    expect(byId(result, 'manual-vvp').status).toBe('Active');
    expect(history(result)).toHaveLength(5);
    expect(sync(result, [cvc]).devices).toEqual(result.devices);

    const relisted = sync(result, [
      cvc,
      {
        ...row('Vía venosa periférica', '14:25'),
        installationDatetime: '2026-10-15T23:11:33.14-03:00',
      },
    ]);
    expect(byId(relisted, 'old-vvp-1').status).toBe('Active');
    expect(history(relisted)).toHaveLength(5);
  });

  it('does not read a retirement origin from an expiration typed inside a longer note', () => {
    const before = installed();
    for (const item of history(before)) {
      delete item.source;
      item.note = 'Revisar Vence: 2026-11-28T02:00:00-03:00 con turno';
    }
    expect(sync(before, [])).toBe(before);
  });

  it('converts offset installation and removal events to Rapa Nui, including the previous calendar day', () => {
    const before = sync(base(), [row('CVC', '00:25')]);
    expect(history(before)[0]).toMatchObject({
      installationDate: '2026-10-15',
      installationTime: '22:25',
    });
    const result = sync(before, [
      { ...row('CVC', '00:25'), removedDatetime: '2026-10-18T00:58:33.14-03:00' },
    ]);
    expect(history(result)[0]).toMatchObject({
      status: 'Removed',
      removalDate: '2026-10-17',
      removalTime: '22:58',
      removalSource: 'eloisa',
    });
    expect(result.devices).toEqual([]);
  });

  it.each([
    'invalid',
    '2026-02-30T10:00:00-03:00',
    '2026-10-20T09:00:00-03:00',
    '2026-10-14T09:00:00-03:00',
  ])(
    'does not turn a contradictory explicit retirement (%s) into inferred absence',
    removedDatetime => {
      const before = sync(base(), [cvc]);
      expect(sync(before, [{ ...cvc, removedDatetime }])).toBe(before);
    }
  );

  it('does not duplicate an unmarked legacy instance whose old parser retained the source offset clock', () => {
    const before = sync(base(), [cvc]);
    delete history(before)[0].source;
    history(before)[0].installationTime = '13:15';
    const result = sync(before, [cvc]);
    expect(history(result)).toHaveLength(1);
    expect(history(result)[0]).toMatchObject({
      id: history(before)[0].id,
      installationTime: '13:15',
    });
    expect(history(result)[0].source).toBeUndefined();
  });

  it('reactivates only an absence retirement with the same installation, clears removal fields, and is idempotent', () => {
    const before = installed();
    const removed = sync(before, [cvc]);
    const returned = sync(removed, [cvc, vvp2]);
    expect(returned.devices).toEqual(['CVC', 'VVP#2']);
    expect(history(returned)).toHaveLength(3);
    expect(history(returned)[2]).toMatchObject({ id: history(before)[2].id, status: 'Active' });
    expect(history(returned)[2]).not.toHaveProperty('removalDate');
    expect(history(returned)[2]).not.toHaveProperty('removalTime');
    expect(history(returned)[2]).not.toHaveProperty('removalSource');
    expect(returned.deviceDetails?.['VVP#2']).not.toHaveProperty('removalDate');
    expect(sync(returned, [cvc, vvp2])).toBe(returned);
    expect(sync(removed, [cvc])).toBe(removed);
  });

  it('respects nursing retirement and manual edits using the actual device controllers', () => {
    const before = sync(base(), [cvc]);
    const retired = buildDeviceBundleChangeResult({
      previousDevices: before.devices,
      nextDevices: [],
      nextDetails: { CVC: { removalDate: DAY } },
      previousHistory: history(before),
      owner: { clinicalEpisodeId: before.clinicalEpisodeId, patientRut: before.rut },
      dateProvider: () => NOW,
    });
    const manual = {
      ...before,
      devices: retired.nextDevices!,
      deviceDetails: retired.nextDetails!,
      deviceInstanceHistory: retired.nextHistory!,
    };
    expect(history(manual)[0].removalSource).toBe('manual');
    expect(sync(manual, [cvc]).devices).toEqual([]);
    expect(history(sync(manual, [cvc]))).toHaveLength(1);
    const edited = {
      ...before,
      deviceInstanceHistory: updateDeviceHistoryRecord({
        history: history(before),
        id: history(before)[0].id,
        updates: { installationDate: '2026-10-15' },
      }),
    };
    expect(sync(edited, []).devices).toEqual(['CVC']);
  });

  it('preserves manual installations with dates and times produced by the nursing controller', () => {
    const empty = base();
    const manual = buildDeviceBundleChangeResult({
      previousDevices: [],
      nextDevices: ['CVC'],
      nextDetails: { CVC: { installationDate: DAY } },
      previousHistory: [],
      owner: { clinicalEpisodeId: empty.clinicalEpisodeId, patientRut: empty.rut },
      dateProvider: () => NOW,
      createId: deps.createId,
    });
    const before = {
      ...empty,
      devices: manual.nextDevices!,
      deviceDetails: manual.nextDetails!,
      deviceInstanceHistory: manual.nextHistory!,
    };
    expect(history(before)[0]).toMatchObject({ source: 'manual', installationTime: '23:30' });
    expect(sync(before, [])).toBe(before);
  });

  it('keeps explicit/manual/unknown retirements closed even without clinicalCarryover', () => {
    for (const removalSource of ['manual', 'eloisa', undefined] as const) {
      const before = sync(sync(base(), [cvc]), []);
      history(before)[0].removalSource = removalSource;
      const result = sync(before, [cvc]);
      expect(result.devices).toEqual([]);
      expect(history(result)).toHaveLength(1);
      expect(history(result)[0].status).toBe('Removed');
    }
  });

  it.each([DAY, '2026-10-17'])('never removes on PDF or missing source, date %s', date => {
    const before = installed();
    expect(
      mergeClinicalDeviceRead(before, { entries: [], source: 'pdf', textItems: [] }, date, deps)
    ).toBe(before);
    expect(mergeClinicalDeviceRead(before, { entries: [], textItems: [] }, date, deps)).toBe(
      before
    );
  });

  it('keeps unowned manual retirements closed and does not duplicate an undated legacy VVP', () => {
    const before = sync(base(), [cvc]);
    const retired = history(before)[0];
    retired.status = 'Removed';
    delete retired.clinicalEpisodeId;
    delete retired.source;
    before.devices = [];
    expect(sync(before, [cvc]).devices).toEqual([]);
    expect(history(sync(before, [cvc]))).toHaveLength(1);
    const undated = sync(base(), [{ name: 'VVP' }]);
    expect(sync(undated, [{ name: 'VVP' }])).toBe(undated);
  });

  it('does not retire a historical day or instances from another patient/episode', () => {
    const before = installed();
    expect(sync(before, [], '2026-10-17')).toBe(before);
    history(before)[0].clinicalEpisodeId = 'foreign-episode';
    history(before)[1].patientRut = '99999992-2';
    expect(sync(before, []).devices).toEqual(['CVC', 'VVP#1']);
  });

  it('does not retire on a partial array with an undated row, or a malformed JSON payload', () => {
    const before = installed();
    const result = sync(before, [{ name: 'CVC' }]);
    expect(history(result).filter(item => item.status === 'Removed')).toEqual([]);
    for (const entries of [undefined, null, {}, [null], [{ name: '' }]]) {
      expect(() =>
        mergeClinicalDeviceRead(before, { ...read([]), entries } as DeviceRead, DAY, deps)
      ).toThrow();
    }
    expect(before.devices).toEqual(['CVC', 'VVP#1', 'VVP#2']);
  });

  it('preserves absent-retirement provenance in hydration and both next-day seeds, without restoring devices', () => {
    const removed = sync(installed(), []);
    expect(parsePatientDataWithDefaults(removed, 'R1').deviceInstanceHistory).toEqual(
      history(removed)
    );
    for (const seed of [seedClinicalCarryover, seedPatient]) {
      const next = seed(removed, base(), DAY, '2026-10-19');
      expect(next.devices).toEqual([]);
      expect(next.deviceInstanceHistory).toEqual(history(removed));
      expect(buildModalSaveResult(next.deviceInstanceHistory).nextDevices).toEqual([]);
    }
    expect(
      calculateDeviceDays(history(removed)[0].installationDate, history(removed)[0].removalDate)
    ).toBe(3);
  });
});
