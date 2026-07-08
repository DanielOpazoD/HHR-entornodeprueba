import { describe, expect, it } from 'vitest';

import { createClinicalSyncSimulator } from './clinicalSyncSimulator';
import {
  createClinicalSyncCensusRecord,
  createClinicalSyncEmptyBed,
  createClinicalSyncPatient,
} from './clinicalSyncSimulatorFixtures';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const emptyBed = createClinicalSyncEmptyBed;
const patient = createClinicalSyncPatient;
const makeRecord = createClinicalSyncCensusRecord;

describe('clinicalSyncSimulator census scenarios', () => {
  it('preserves a new patient created remotely while a stale client replays a compatible diagnosis edit', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['admission-pc', 'stale-pc'],
    });

    simulator.mutate(
      'admission-pc',
      { changedPaths: ['beds.NEO1'], module: 'censo', label: 'admitir NEO1' },
      record => {
        record.beds.NEO1 = patient('NEO1', {
          patientName: 'Paciente Nuevo',
          rut: '22.222.222-2',
          pathology: 'Bronquiolitis',
          clinicalEpisodeId: 'episode-neo-1',
        });
      }
    );
    expect(simulator.replayNext('admission-pc').status).toBe('accepted');

    simulator.mutate(
      'stale-pc',
      { changedPaths: ['beds.R1.pathology'], module: 'censo', label: 'editar diagnostico R1' },
      record => {
        record.beds.R1.pathology = 'Diagnostico stale compatible';
      }
    );
    const replay = simulator.replayNext('stale-pc');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote().beds.NEO1.patientName).toBe('Paciente Nuevo');
    expect(simulator.getRemote().beds.R1.pathology).toBe('Diagnostico stale compatible');
  });

  it('keeps diagnosis, RUT and episode when a bed move is replayed after another remote edit', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['remote-pc', 'move-pc'],
    });

    simulator.mutate(
      'remote-pc',
      { changedPaths: ['beds.R1.status'], module: 'censo', label: 'estado remoto' },
      record => {
        record.beds.R1.status = 'De cuidado' as DailyRecord['beds'][string]['status'];
      }
    );
    expect(simulator.replayNext('remote-pc').status).toBe('accepted');

    simulator.mutate(
      'move-pc',
      { changedPaths: ['beds.R1', 'beds.R2'], module: 'censo', label: 'mover R1 a R2' },
      record => {
        record.beds.R2 = {
          ...record.beds.R1,
          bedId: 'R2',
        };
        record.beds.R1 = emptyBed('R1');
      }
    );
    const replay = simulator.replayNext('move-pc');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote().beds.R2.patientName).toBe('Paciente Censo');
    expect(simulator.getRemote().beds.R2.rut).toBe('11.111.111-1');
    expect(simulator.getRemote().beds.R2.pathology).toBe('Diagnostico base');
    expect(simulator.getRemote().beds.R2.clinicalEpisodeId).toBe('episode-censo-1');
    expect(simulator.getRemote().beds.R1.patientName).toBe('');
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      action: 'auto_merged',
      affected: {
        bedId: 'R1',
        patientName: 'Paciente Censo',
        rut: '11.111.111-1',
      },
    });
  });

  it.each([
    {
      field: 'discharges' as const,
      changedPaths: ['discharges', 'beds.R1'],
      movement: {
        id: 'discharge-r1',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente Censo',
        rut: '11.111.111-1',
        diagnosis: 'Diagnostico base',
        specialty: 'Medicina',
        time: '12:00',
        status: 'Vivo',
        dischargeType: 'Domicilio (Habitual)',
        clinicalEpisodeId: 'episode-censo-1',
        originalData: patient('R1'),
      },
    },
    {
      field: 'transfers' as const,
      changedPaths: ['transfers', 'beds.R1'],
      movement: {
        id: 'transfer-r1',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente Censo',
        rut: '11.111.111-1',
        diagnosis: 'Diagnostico base',
        specialty: 'Medicina',
        time: '12:00',
        evacuationMethod: 'Aéreo',
        receivingCenter: 'Hospital receptor',
        clinicalEpisodeId: 'episode-censo-1',
        originalData: patient('R1'),
      },
    },
    {
      field: 'cma' as const,
      changedPaths: ['cma', 'beds.R1'],
      movement: {
        id: 'cma-r1',
        bedName: 'R1',
        originalBedId: 'R1',
        patientName: 'Paciente Censo',
        rut: '11.111.111-1',
        age: '40a',
        diagnosis: 'Diagnostico base',
        specialty: 'Medicina',
        interventionType: 'Cirugía Mayor Ambulatoria',
        clinicalEpisodeId: 'episode-censo-1',
        originalData: patient('R1'),
      },
    },
  ])('keeps $field visible and the source bed available after stale replay', scenario => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['egress-pc', 'stale-pc'],
    });

    simulator.mutate(
      'egress-pc',
      { changedPaths: scenario.changedPaths, module: 'censo', label: `egresar ${scenario.field}` },
      record => {
        (record[scenario.field] as unknown[]).push(scenario.movement);
        record.beds.R1 = emptyBed('R1');
      }
    );
    expect(simulator.replayNext('egress-pc').status).toBe('accepted');

    simulator.mutate(
      'stale-pc',
      { changedPaths: ['beds.R1.devices'], module: 'censo', label: 'replay stale DMI' },
      record => {
        record.beds.R1.devices = ['VVP#1'];
      }
    );
    const replay = simulator.replayNext('stale-pc');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote()[scenario.field]).toEqual([
      expect.objectContaining({ id: scenario.movement.id }),
    ]);
    expect(simulator.getRemote().beds.R1.patientName).toBe('');
    expect(simulator.getRemote().beds.R1.devices).toEqual([]);
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      action: 'auto_merged',
      affected: {
        bedId: 'R1',
        patientName: 'Paciente Censo',
        rut: '11.111.111-1',
      },
    });
  });

  it('merges compatible invasive-device edits without overwriting a remote specialty update', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['specialty-pc', 'dmi-pc'],
    });

    simulator.mutate(
      'specialty-pc',
      { changedPaths: ['beds.R1.specialty'], module: 'censo', label: 'especialidad remota' },
      record => {
        record.beds.R1.specialty = 'Cirugia';
      }
    );
    expect(simulator.replayNext('specialty-pc').status).toBe('accepted');

    simulator.mutate(
      'dmi-pc',
      {
        changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
        module: 'censo',
        label: 'agregar DMI stale',
      },
      record => {
        record.beds.R1.devices = ['VVP#1'];
        record.beds.R1.deviceDetails = {
          'VVP#1': { installationDate: '2026-07-03' },
        };
      }
    );
    const replay = simulator.replayNext('dmi-pc');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote().beds.R1.specialty).toBe('Cirugia');
    expect(simulator.getRemote().beds.R1.devices).toEqual(['VVP#1']);
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      action: 'auto_merged',
      recordDate: '2026-07-03',
      clientId: 'dmi-pc',
      tabId: expect.stringMatching(/^dmi-pc-tab-/),
      mutationId: expect.stringMatching(/^dmi-pc-mutation-/),
      module: 'censo',
      changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
      affected: {
        bedId: 'R1',
        patientName: 'Paciente Censo',
        rut: '11.111.111-1',
      },
    });
  });

  it('replays a stale clinical field bundle without losing a remotely admitted empty-bed patient', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['admission-pc', 'clinical-pc'],
    });

    simulator.mutate(
      'admission-pc',
      { changedPaths: ['beds.NEO1'], module: 'censo', label: 'admitir NEO1 remoto' },
      record => {
        record.beds.NEO1 = patient('NEO1', {
          patientName: 'Paciente Neo',
          rut: '22.222.222-2',
          pathology: 'Sindrome febril',
          specialty: 'Pediatria',
          clinicalEpisodeId: 'episode-neo-2',
        });
      }
    );
    expect(simulator.replayNext('admission-pc').status).toBe('accepted');

    simulator.mutate(
      'clinical-pc',
      {
        changedPaths: ['beds.R1.pathology', 'beds.R1.specialty', 'beds.R1.status'],
        module: 'censo',
        label: 'actualizacion clinica stale',
      },
      record => {
        record.beds.R1.pathology = 'Neumonia basal derecha';
        record.beds.R1.specialty = 'Medicina Interna';
        record.beds.R1.status = 'De cuidado' as DailyRecord['beds'][string]['status'];
      }
    );

    const replay = simulator.replayNext('clinical-pc');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote().beds.NEO1).toMatchObject({
      patientName: 'Paciente Neo',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'episode-neo-2',
    });
    expect(simulator.getRemote().beds.R1).toMatchObject({
      pathology: 'Neumonia basal derecha',
      specialty: 'Medicina Interna',
      status: 'De cuidado',
    });
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      action: 'auto_merged',
      reason: expect.stringContaining('intencion clinica compatible'),
    });
  });

  it('removes an invasive device from a stale client without reverting a remote clinical edit', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: {
        ...makeRecord(),
        beds: {
          ...makeRecord().beds,
          R1: patient('R1', {
            devices: ['VVP#1', 'CVC'],
            deviceDetails: {
              'VVP#1': { installationDate: '2026-07-01' },
              CVC: { installationDate: '2026-07-02' },
            },
          }),
        },
      },
      clients: ['remote-pc', 'dmi-pc'],
    });

    simulator.mutate(
      'remote-pc',
      { changedPaths: ['beds.R1.pathology'], module: 'censo', label: 'diagnostico remoto' },
      record => {
        record.beds.R1.pathology = 'Diagnostico remoto protegido';
      }
    );
    expect(simulator.replayNext('remote-pc').status).toBe('accepted');

    simulator.mutate(
      'dmi-pc',
      {
        changedPaths: ['beds.R1.devices', 'beds.R1.deviceDetails'],
        module: 'censo',
        label: 'quitar VVP stale',
      },
      record => {
        record.beds.R1.devices = ['CVC'];
        record.beds.R1.deviceDetails = {
          CVC: { installationDate: '2026-07-02' },
        };
      }
    );

    const replay = simulator.replayNext('dmi-pc');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote().beds.R1.pathology).toBe('Diagnostico remoto protegido');
    expect(simulator.getRemote().beds.R1.devices).toEqual(['CVC']);
    expect(simulator.getRemote().beds.R1.deviceDetails).toEqual({
      CVC: { installationDate: '2026-07-02' },
    });
  });
});
