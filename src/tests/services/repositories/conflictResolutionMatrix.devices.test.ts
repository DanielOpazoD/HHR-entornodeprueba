import { describe, it, expect } from 'vitest';

import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (date: string, lastUpdated: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated,
  nurses: [],
  activeExtraBeds: [],
});

describe('conflictResolutionMatrix device merge policy', () => {
  it('does not resurrect a locally retired device during automatic merge', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente con dispositivo',
        devices: ['CVC', 'VVP#1'],
        deviceDetails: {
          CVC: { installationDate: '2026-02-16' },
          'VVP#1': { installationDate: '2026-02-17' },
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente con dispositivo',
        devices: ['VVP#1'],
        deviceDetails: {
          CVC: {
            installationDate: '2026-02-16',
            removalDate: '2026-02-18',
            note: 'Retirado en turno',
          },
          'VVP#1': { installationDate: '2026-02-17' },
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
    });

    expect(resolved.beds.R1.devices).toEqual(['VVP#1']);
    expect(resolved.beds.R1.deviceDetails?.CVC?.removalDate).toBe('2026-02-18');
  });

  it('preserves explicit same-episode device retirement with patient identity present', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente con CVC',
        rut: '22.222.222-2',
        admissionDate: '2026-02-10',
        clinicalEpisodeId: 'legacy_ep_remote',
        devices: ['CVC', 'VVP#1'],
        deviceDetails: {
          CVC: { installationDate: '2026-02-18' },
          'VVP#1': { installationDate: '2026-02-18' },
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente con CVC',
        rut: '22.222.222-2',
        admissionDate: '2026-02-10',
        devices: ['VVP#1'],
        deviceDetails: {
          CVC: {
            installationDate: '2026-02-18',
            removalDate: '2026-02-18',
            note: 'Retirado en turno',
          },
          'VVP#1': { installationDate: '2026-02-18' },
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
    });

    expect(resolved.beds.R1.devices).toEqual(['VVP#1']);
    expect(resolved.beds.R1.deviceDetails?.CVC?.removalDate).toBe('2026-02-18');
  });

  it('does not union stale local active VVPs over a newer remote active-device list', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente antiguo',
        devices: ['VVP#1'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-17' },
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente antiguo',
        devices: ['VVP#1', 'VVP#2'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-17' },
          'VVP#2': { installationDate: '2026-02-16' },
        },
        deviceInstanceHistory: [
          {
            id: 'vvp-1',
            type: 'VVP#1',
            status: 'Active',
            installationDate: '2026-02-17',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'stale-vvp-2',
            type: 'VVP#2',
            status: 'Active',
            installationDate: '2026-02-16',
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local);

    expect(resolved.beds.R1.devices).toEqual(['VVP#1']);
    expect(resolved.beds.R1.deviceDetails).toEqual({
      'VVP#1': { installationDate: '2026-02-17' },
    });
  });

  it('does not resurrect a device retired through device history when active details were cleaned', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente con dispositivo',
        devices: ['CVC', 'VVP#1'],
        deviceDetails: {
          CVC: { installationDate: '2026-02-16' },
          'VVP#1': { installationDate: '2026-02-17' },
        },
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente con dispositivo',
        devices: ['VVP#1'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-17' },
        },
        deviceInstanceHistory: [
          {
            id: 'cvc-1',
            type: 'CVC',
            status: 'Removed',
            installationDate: '2026-02-16',
            removalDate: '2026-02-18',
            createdAt: 1,
            updatedAt: 2,
          },
          {
            id: 'vvp-1',
            type: 'VVP#1',
            status: 'Active',
            installationDate: '2026-02-17',
            createdAt: 3,
            updatedAt: 3,
          },
        ],
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['*'],
    });

    expect(resolved.beds.R1.devices).toEqual(['VVP#1']);
    expect(resolved.beds.R1.deviceDetails).toEqual({
      'VVP#1': { installationDate: '2026-02-17' },
    });
    expect(resolved.beds.R1.deviceInstanceHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'CVC', status: 'Removed', removalDate: '2026-02-18' }),
      ])
    );
  });

  it('keeps remote DMI state when stale local device paths belong to another episode', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente actual',
        rut: '22.222.222-2',
        admissionDate: '2026-02-18',
        clinicalEpisodeId: 'episode-current',
        devices: ['VVP#1'],
        deviceDetails: {
          'VVP#1': { installationDate: '2026-02-18' },
        },
        deviceInstanceHistory: [
          {
            id: 'current-vvp',
            type: 'VVP#1',
            status: 'Active',
            installationDate: '2026-02-18',
            clinicalEpisodeId: 'episode-current',
            patientRut: '22.222.222-2',
            createdAt: 10,
            updatedAt: 10,
          },
        ],
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente anterior',
        rut: '11.111.111-1',
        admissionDate: '2026-02-10',
        clinicalEpisodeId: 'episode-old',
        devices: ['CVC', 'VVP#1'],
        deviceDetails: {
          CVC: { installationDate: '2026-02-10' },
          'VVP#1': { installationDate: '2026-02-11' },
        },
        deviceInstanceHistory: [
          {
            id: 'old-cvc',
            type: 'CVC',
            status: 'Active',
            installationDate: '2026-02-10',
            clinicalEpisodeId: 'episode-old',
            patientRut: '11.111.111-1',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails', 'beds.R1.deviceInstanceHistory'],
    });

    expect(resolved.beds.R1.devices).toEqual(['VVP#1']);
    expect(resolved.beds.R1.deviceDetails).toEqual({
      'VVP#1': { installationDate: '2026-02-18' },
    });
    expect(resolved.beds.R1.deviceInstanceHistory).toEqual([
      expect.objectContaining({
        id: 'current-vvp',
        clinicalEpisodeId: 'episode-current',
        patientRut: '22.222.222-2',
      }),
    ]);
    expect(resolved.beds.R1.deviceInstanceHistory?.map(item => item.id)).not.toContain('old-cvc');
  });
});
