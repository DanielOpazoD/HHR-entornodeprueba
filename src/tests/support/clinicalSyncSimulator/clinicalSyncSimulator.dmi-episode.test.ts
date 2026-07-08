import { describe, expect, it } from 'vitest';

import { createClinicalSyncSimulator } from './clinicalSyncSimulator';
import {
  createClinicalSyncCensusRecord,
  createClinicalSyncEmptyBed,
  createClinicalSyncPatient,
} from './clinicalSyncSimulatorFixtures';

const emptyBed = createClinicalSyncEmptyBed;
const patient = createClinicalSyncPatient;
const makeRecord = createClinicalSyncCensusRecord;

describe('clinicalSyncSimulator DMI episode scoping scenarios', () => {
  it('keeps invasive-device history scoped to the episode when a moved patient leaves a reused bed', () => {
    const initialRecord = {
      ...makeRecord(),
      beds: {
        ...makeRecord().beds,
        R1: patient('R1', {
          patientName: 'Paciente X',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'episode-x',
          devices: ['VVP#1'],
          deviceDetails: {
            'VVP#1': { installationDate: '2026-07-01', note: 'Paciente X' },
          },
        }),
      },
    };
    const simulator = createClinicalSyncSimulator({
      initialRecord,
      clients: ['move-pc', 'admission-pc', 'stale-old-pc'],
    });

    simulator.mutate(
      'move-pc',
      { changedPaths: ['beds.R1', 'beds.R2'], module: 'censo', label: 'mover paciente X' },
      record => {
        record.beds.R2 = {
          ...record.beds.R1,
          bedId: 'R2',
        };
        record.beds.R1 = emptyBed('R1');
      }
    );
    expect(simulator.replayNext('move-pc').status).toBe('accepted');

    simulator.refreshClient('admission-pc');
    simulator.mutate(
      'admission-pc',
      { changedPaths: ['beds.R1'], module: 'censo', label: 'admitir paciente Y' },
      record => {
        record.beds.R1 = patient('R1', {
          patientName: 'Paciente Y',
          rut: '33.333.333-3',
          clinicalEpisodeId: 'episode-y',
          devices: ['SNG'],
          deviceDetails: {
            SNG: { installationDate: '2026-07-03', note: 'Paciente Y' },
          },
        });
      }
    );
    expect(simulator.replayNext('admission-pc').status).toBe('accepted');

    simulator.mutate(
      'stale-old-pc',
      {
        changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
        module: 'censo',
        label: 'DMI stale paciente X en cama reutilizada',
      },
      record => {
        record.beds.R1.devices = ['VVP#1', 'CVC'];
        record.beds.R1.deviceDetails = {
          'VVP#1': { installationDate: '2026-07-01', note: 'Paciente X' },
          CVC: { installationDate: '2026-07-02', note: 'Paciente X stale' },
        };
      }
    );

    const replay = simulator.replayNext('stale-old-pc');

    expect(['auto_merged', 'blocked']).toContain(replay.status);
    expect(simulator.getRemote().beds.R1).toMatchObject({
      patientName: 'Paciente Y',
      rut: '33.333.333-3',
      clinicalEpisodeId: 'episode-y',
      devices: ['SNG'],
      deviceDetails: {
        SNG: { installationDate: '2026-07-03', note: 'Paciente Y' },
      },
    });
    expect(simulator.getRemote().beds.R2).toMatchObject({
      patientName: 'Paciente X',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'episode-x',
      devices: ['VVP#1'],
    });
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      affected: {
        bedId: 'R1',
        patientName: 'Paciente Y',
        rut: '33.333.333-3',
      },
      reason: expect.stringContaining('episodio'),
    });
  });

  it.each([
    {
      field: 'discharges' as const,
      changedPaths: ['discharges', 'beds.R1'],
      movement: {
        id: 'discharge-episode-x',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente X',
        rut: '11.111.111-1',
        diagnosis: 'Diagnostico base',
        specialty: 'Medicina',
        time: '12:00',
        status: 'Vivo',
        dischargeType: 'Domicilio (Habitual)',
        clinicalEpisodeId: 'episode-x',
        originalData: patient('R1', {
          patientName: 'Paciente X',
          clinicalEpisodeId: 'episode-x',
          devices: ['VVP#1'],
        }),
      },
    },
    {
      field: 'transfers' as const,
      changedPaths: ['transfers', 'beds.R1'],
      movement: {
        id: 'transfer-episode-x',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente X',
        rut: '11.111.111-1',
        diagnosis: 'Diagnostico base',
        specialty: 'Medicina',
        time: '12:00',
        evacuationMethod: 'Terrestre',
        receivingCenter: 'Hospital receptor',
        clinicalEpisodeId: 'episode-x',
        originalData: patient('R1', {
          patientName: 'Paciente X',
          clinicalEpisodeId: 'episode-x',
          devices: ['VVP#1'],
        }),
      },
    },
    {
      field: 'cma' as const,
      changedPaths: ['cma', 'beds.R1'],
      movement: {
        id: 'cma-episode-x',
        bedName: 'R1',
        originalBedId: 'R1',
        patientName: 'Paciente X',
        rut: '11.111.111-1',
        age: '40a',
        diagnosis: 'Diagnostico base',
        specialty: 'Medicina',
        interventionType: 'Cirugia Mayor Ambulatoria',
        clinicalEpisodeId: 'episode-x',
        originalData: patient('R1', {
          patientName: 'Paciente X',
          clinicalEpisodeId: 'episode-x',
          devices: ['VVP#1'],
        }),
      },
    },
  ])(
    'keeps DMI scoped to the closed episode after $field and a new patient reuses the bed',
    scenario => {
      const initialRecord = {
        ...makeRecord(),
        beds: {
          ...makeRecord().beds,
          R1: patient('R1', {
            patientName: 'Paciente X',
            rut: '11.111.111-1',
            clinicalEpisodeId: 'episode-x',
            devices: ['VVP#1'],
            deviceDetails: {
              'VVP#1': { installationDate: '2026-07-01', note: 'Paciente X' },
            },
          }),
        },
      };
      const simulator = createClinicalSyncSimulator({
        initialRecord,
        clients: ['egress-pc', 'admission-pc', 'stale-old-pc'],
      });

      simulator.mutate(
        'egress-pc',
        {
          changedPaths: scenario.changedPaths,
          module: 'censo',
          label: `cerrar episodio por ${scenario.field}`,
        },
        record => {
          (record[scenario.field] as unknown[]).push(scenario.movement);
          record.beds.R1 = emptyBed('R1');
        }
      );
      expect(simulator.replayNext('egress-pc').status).toBe('accepted');

      simulator.refreshClient('admission-pc');
      simulator.mutate(
        'admission-pc',
        { changedPaths: ['beds.R1'], module: 'censo', label: 'admitir paciente Y post-egreso' },
        record => {
          record.beds.R1 = patient('R1', {
            patientName: 'Paciente Y',
            rut: '33.333.333-3',
            clinicalEpisodeId: 'episode-y',
            devices: [],
            deviceDetails: {},
          });
        }
      );
      expect(simulator.replayNext('admission-pc').status).toBe('accepted');

      simulator.mutate(
        'stale-old-pc',
        {
          changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
          module: 'censo',
          label: `DMI stale tras ${scenario.field}`,
        },
        record => {
          record.beds.R1.devices = ['VVP#1', 'CVC'];
          record.beds.R1.deviceDetails = {
            'VVP#1': { installationDate: '2026-07-01', note: 'Paciente X' },
            CVC: { installationDate: '2026-07-02', note: 'Paciente X stale' },
          };
        }
      );

      const replay = simulator.replayNext('stale-old-pc');

      expect(['auto_merged', 'blocked']).toContain(replay.status);
      expect(simulator.getRemote()[scenario.field]).toEqual([
        expect.objectContaining({ id: scenario.movement.id, clinicalEpisodeId: 'episode-x' }),
      ]);
      expect(simulator.getRemote().beds.R1).toMatchObject({
        patientName: 'Paciente Y',
        rut: '33.333.333-3',
        clinicalEpisodeId: 'episode-y',
        devices: [],
        deviceDetails: {},
      });
      expect(simulator.getAuditEvents().at(-1)).toMatchObject({
        affected: {
          bedId: 'R1',
          patientName: 'Paciente Y',
          rut: '33.333.333-3',
        },
        reason: expect.stringContaining('episodio'),
      });
    }
  );
});
