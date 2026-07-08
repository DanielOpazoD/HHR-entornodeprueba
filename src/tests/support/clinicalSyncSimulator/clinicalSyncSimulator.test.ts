import { describe, expect, it } from 'vitest';

import { createClinicalSyncSimulator } from './clinicalSyncSimulator';
import { createClinicalSyncCensusRecord } from './clinicalSyncSimulatorFixtures';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (date = '2026-07-03'): DailyRecord =>
  createClinicalSyncCensusRecord({
    date,
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Inicial',
        rut: '11.111.111-1',
        age: '40a',
        pathology: 'Diagnostico inicial',
        specialty: 'Medicina',
        status: 'Estable',
        admissionDate: '2026-07-01',
        clinicalEpisodeId: 'episode-r1',
        devices: [],
      } as unknown as DailyRecord['beds'][string],
    },
  });

describe('clinicalSyncSimulator', () => {
  it('creates isolated logical clients over the same remote record', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['client-a', 'client-b'],
    });

    simulator.mutate(
      'client-a',
      {
        changedPaths: ['beds.R1.pathology'],
        module: 'censo',
      },
      record => {
        record.beds.R1.pathology = 'Diagnostico local A';
      }
    );

    expect(simulator.getRemote().beds.R1.pathology).toBe('Diagnostico inicial');
    expect(simulator.getClient('client-a').local.beds.R1.pathology).toBe('Diagnostico local A');
    expect(simulator.getClient('client-b').local.beds.R1.pathology).toBe('Diagnostico inicial');
    expect(simulator.getClient('client-a').outbox).toHaveLength(1);
    expect(simulator.getClient('client-b').outbox).toHaveLength(0);
  });

  it('keeps stale outbox pending across logical restart and replays it through conflict merge', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['remote-writer', 'stale-client'],
    });

    simulator.mutate(
      'remote-writer',
      {
        changedPaths: ['beds.R1.specialty'],
        module: 'censo',
      },
      record => {
        record.beds.R1.specialty = 'Cirugia';
      }
    );
    expect(simulator.replayNext('remote-writer').status).toBe('accepted');

    simulator.mutate(
      'stale-client',
      {
        changedPaths: ['beds.R1.pathology'],
        module: 'censo',
      },
      record => {
        record.beds.R1.pathology = 'Diagnostico desde cliente stale';
      }
    );

    const restarted = simulator.restartClient('stale-client');
    expect(restarted.outbox).toHaveLength(1);
    expect(restarted.tabId).not.toBe('stale-client-tab-1');

    const replay = simulator.replayNext('stale-client');

    expect(replay.status).toBe('auto_merged');
    expect(simulator.getRemote().beds.R1.specialty).toBe('Cirugia');
    expect(simulator.getRemote().beds.R1.pathology).toBe('Diagnostico desde cliente stale');
    expect(simulator.getClient('stale-client').outbox).toHaveLength(0);
    expect(simulator.getAuditEvents().map(event => event.action)).toEqual([
      'queued',
      'accepted',
      'queued',
      'auto_merged',
    ]);
  });

  it('blocks replay when post-merge invariants reject the selected clinical truth', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['client-a'],
    });

    simulator.mutate(
      'client-a',
      {
        changedPaths: ['beds'],
        module: 'censo',
      },
      record => {
        record.beds.R2 = {
          ...record.beds.R1,
          bedId: 'R2',
        };
      }
    );

    const replay = simulator.replayNext('client-a');

    expect(replay.status).toBe('blocked');
    expect(replay.invariantViolations.map(violation => violation.type)).toContain(
      'duplicate_active_patient_after_merge'
    );
    expect(simulator.getRemote().beds.R2).toBeUndefined();
    expect(simulator.getClient('client-a').outbox).toHaveLength(1);
  });

  it('does not auto-merge incompatible stale edits to the same clinical field', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['doctor-a', 'doctor-b'],
    });

    simulator.mutate(
      'doctor-a',
      {
        changedPaths: ['beds.R1.pathology'],
        module: 'censo',
        label: 'diagnostico A',
      },
      record => {
        record.beds.R1.pathology = 'Neumonia adquirida';
      }
    );
    expect(simulator.replayNext('doctor-a').status).toBe('accepted');

    simulator.mutate(
      'doctor-b',
      {
        changedPaths: ['beds.R1.pathology'],
        module: 'censo',
        label: 'diagnostico B stale',
      },
      record => {
        record.beds.R1.pathology = 'Insuficiencia cardiaca';
      }
    );

    const replay = simulator.replayNext('doctor-b');

    expect(['blocked', 'needs_review']).toContain(replay.status);
    expect(simulator.getRemote().beds.R1.pathology).toBe('Neumonia adquirida');
    expect(simulator.getClient('doctor-b').outbox).toHaveLength(1);
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      recordDate: '2026-07-03',
      clientId: 'doctor-b',
      module: 'censo',
      changedPaths: ['beds.R1.pathology'],
      reason: expect.stringContaining('conflicto'),
    });
  });

  it('keeps episode context in the reason when a stale edit is blocked', () => {
    const baseRecord = makeRecord();
    const remoteRecord = makeRecord();
    remoteRecord.beds.R1 = {
      ...remoteRecord.beds.R1,
      patientName: 'Paciente Nuevo',
      rut: '22.222.222-2',
      pathology: 'Diagnostico remoto',
      clinicalEpisodeId: 'episode-r1-new',
    };
    const localRecord = makeRecord();
    localRecord.beds.R1.pathology = 'Diagnostico stale episodio previo';

    const simulator = createClinicalSyncSimulator({
      initialRecord: remoteRecord,
      clients: ['stale-pc'],
    });

    const mutation: Parameters<typeof simulator.enqueueRetry>[1] = {
      mutationId: 'stale-pc-mutation-cross-episode-blocked',
      label: 'diagnostico stale episodio previo',
      module: 'censo',
      baseRecord,
      localRecord,
      syncContract: {
        mutationId: 'stale-pc-mutation-cross-episode-blocked',
        clientId: 'stale-pc',
        tabId: 'stale-pc-tab-previous',
        expectedVersion: 'rev-0',
        changedPaths: ['beds.R1.pathology'],
      },
    };

    simulator.enqueueRetry('stale-pc', mutation);

    const replay = simulator.replayNext('stale-pc');

    expect(replay.status).toBe('blocked');
    expect(replay.invariantViolations).toEqual([]);
    expect(simulator.getRemote().beds.R1).toMatchObject({
      patientName: 'Paciente Nuevo',
      rut: '22.222.222-2',
      pathology: 'Diagnostico remoto',
      clinicalEpisodeId: 'episode-r1-new',
    });
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      action: 'blocked',
      affected: {
        bedId: 'R1',
        patientName: 'Paciente Nuevo',
        rut: '22.222.222-2',
      },
      reason: expect.stringContaining('episodio'),
    });
  });

  it('treats a duplicated replay of the same mutation id as already applied', () => {
    const simulator = createClinicalSyncSimulator({
      initialRecord: makeRecord(),
      clients: ['client-a'],
    });

    const mutation = simulator.mutate(
      'client-a',
      {
        changedPaths: ['beds.R1.pathology'],
        module: 'censo',
        label: 'diagnostico idempotente',
      },
      record => {
        record.beds.R1.pathology = 'Diagnostico aplicado una vez';
      }
    );

    expect(simulator.replayNext('client-a').status).toBe('accepted');

    simulator.enqueueRetry('client-a', mutation);
    const retry = simulator.replayNext('client-a');

    expect(retry.status).toBe('already_applied');
    expect(simulator.getRemote().beds.R1.pathology).toBe('Diagnostico aplicado una vez');
    expect(
      simulator.getAuditEvents().filter(event => event.mutationId === mutation.mutationId)
    ).toHaveLength(3);
    expect(simulator.getAuditEvents().at(-1)).toMatchObject({
      action: 'already_applied',
      mutationId: mutation.mutationId,
      clientId: 'client-a',
      tabId: expect.stringMatching(/^client-a-tab-/),
      reason: expect.stringContaining('idempotente'),
    });
  });
});
