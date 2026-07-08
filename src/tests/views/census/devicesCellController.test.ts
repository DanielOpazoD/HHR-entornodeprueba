import { describe, expect, it, vi } from 'vitest';
import {
  buildDeviceBundleChangeResult,
  buildDetailsChangeResult,
  buildModalSaveResult,
  buildSelectionChangeResult,
} from '@/features/census/controllers/devicesCellController';
import type { DeviceInstance } from '@/types/domain/devices';

describe('devicesCellController', () => {
  const previousPatientResidueHistory: DeviceInstance[] = [
    {
      id: 'old-active-cvc',
      type: 'CVC',
      installationDate: '2026-07-01',
      status: 'Active',
      clinicalEpisodeId: 'episode-paciente-x',
      patientRut: '11.111.111-1',
      patientName: 'Paciente X',
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'old-removed-cup',
      type: 'CUP',
      installationDate: '2026-07-01',
      removalDate: '2026-07-02',
      status: 'Removed',
      clinicalEpisodeId: 'episode-paciente-x',
      patientRut: '11.111.111-1',
      patientName: 'Paciente X',
      createdAt: 2,
      updatedAt: 2,
    },
  ];

  const currentPatientOwner = {
    clinicalEpisodeId: 'episode-paciente-y',
    patientRut: '22.222.222-2',
    patientName: 'Paciente Y',
  };

  it('builds selection result and produces history when a device is removed', () => {
    const previousHistory: DeviceInstance[] = [
      {
        id: 'a1',
        type: 'CVC',
        installationDate: '2026-02-14',
        installationTime: '01:00',
        status: 'Active',
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const result = buildSelectionChangeResult({
      previousDevices: ['CVC'],
      nextDevices: [],
      previousHistory,
      deviceDetails: {},
      dateProvider: () => new Date('2026-02-15T06:00:00'),
      createId: vi.fn(() => 'x1'),
    });

    expect(result.nextDevices).toEqual([]);
    expect(result.nextHistory).toBeDefined();
    expect(result.nextHistory?.[0].status).toBe('Removed');
  });

  it('builds details result and creates history for active device without active entry', () => {
    const result = buildDetailsChangeResult({
      activeDevices: ['CUP'],
      nextDetails: { CUP: { installationDate: '2026-02-14' } },
      previousHistory: [],
      dateProvider: () => new Date('2026-02-15T06:00:00'),
      createId: vi.fn(() => 'new-id'),
    });

    expect(result.nextDetails).toEqual({ CUP: { installationDate: '2026-02-14' } });
    expect(result.nextHistory).toBeDefined();
    expect(result.nextHistory?.[0].id).toBe('new-id');
    expect(result.nextHistory?.[0].type).toBe('CUP');
    expect(result.nextHistory?.[0].status).toBe('Active');
  });

  it('resolves active device list from modal saved history', () => {
    const history: DeviceInstance[] = [
      {
        id: 'a1',
        type: 'CVC',
        installationDate: '2026-02-14',
        status: 'Active',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'a2',
        type: 'CUP',
        installationDate: '2026-02-14',
        status: 'Removed',
        createdAt: 2,
        updatedAt: 2,
      },
    ];

    const result = buildModalSaveResult(history);
    expect(result.nextHistory).toEqual(history);
    expect(result.nextDevices).toEqual(['CVC']);
  });

  it('builds one canonical bundle when adding a second simultaneous VVP', () => {
    const result = buildDeviceBundleChangeResult({
      previousDevices: ['VVP#1'],
      nextDevices: ['VVP#1', 'VVP#2'],
      nextDetails: {
        'VVP#1': { installationDate: '2026-02-13' },
        'VVP#2': { installationDate: '2026-02-14' },
      },
      previousHistory: [
        {
          id: 'vvp-1',
          type: 'VVP#1',
          status: 'Active',
          installationDate: '2026-02-13',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      dateProvider: () => new Date('2026-02-14T08:00:00'),
      createId: vi.fn(() => 'vvp-2'),
    });

    expect(result.nextDevices).toEqual(['VVP#1', 'VVP#2']);
    expect(result.nextDetails).toEqual({
      'VVP#1': { installationDate: '2026-02-13' },
      'VVP#2': { installationDate: '2026-02-14' },
    });
    expect(result.nextHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vvp-2',
          type: 'VVP#2',
          status: 'Active',
          installationDate: '2026-02-14',
        }),
      ])
    );
  });

  it('compacts remaining VVP after retiring the first simultaneous VVP', () => {
    const result = buildDeviceBundleChangeResult({
      previousDevices: ['VVP#1', 'VVP#2', 'CVC'],
      nextDevices: ['VVP#2', 'CVC'],
      nextDetails: {
        'VVP#1': {
          installationDate: '2026-02-13',
          removalDate: '2026-02-16',
          note: '[Retiro] infiltrada',
        },
        'VVP#2': { installationDate: '2026-02-14' },
        CVC: { installationDate: '2026-02-12' },
      },
      previousHistory: [
        {
          id: 'vvp-1',
          type: 'VVP#1',
          status: 'Active',
          installationDate: '2026-02-13',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'vvp-2',
          type: 'VVP#2',
          status: 'Active',
          installationDate: '2026-02-14',
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: 'cvc-1',
          type: 'CVC',
          status: 'Active',
          installationDate: '2026-02-12',
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      dateProvider: () => new Date('2026-02-16T06:00:00'),
      createId: vi.fn(() => 'unused'),
    });

    expect(result.nextDevices).toEqual(['VVP#1', 'CVC']);
    expect(result.nextDetails).toEqual({
      'VVP#1': { installationDate: '2026-02-14' },
      CVC: { installationDate: '2026-02-12' },
    });
    expect(result.nextHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vvp-1',
          type: 'VVP#1',
          status: 'Removed',
          removalDate: '2026-02-16',
          note: '[Retiro] infiltrada',
        }),
        expect.objectContaining({
          id: 'vvp-2',
          type: 'VVP#1',
          status: 'Active',
          installationDate: '2026-02-14',
        }),
        expect.objectContaining({
          id: 'cvc-1',
          type: 'CVC',
          status: 'Active',
        }),
      ])
    );
  });

  it('preserves the same custom device history entry when a custom device is renamed', () => {
    const result = buildDeviceBundleChangeResult({
      previousDevices: ['drenaje pleural izquierdo'],
      nextDevices: ['drenaje pleural'],
      nextDetails: {
        'drenaje pleural': {
          installationDate: '2026-02-14',
          note: 'con oscilación',
        },
      },
      previousHistory: [
        {
          id: 'custom-history',
          type: 'drenaje pleural izquierdo',
          status: 'Active',
          installationDate: '2026-02-14',
          clinicalEpisodeId: 'episode-1',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      owner: { clinicalEpisodeId: 'episode-1', patientRut: '12.345.678-9' },
      renamedDevice: {
        from: 'drenaje pleural izquierdo',
        to: 'drenaje pleural',
      },
      dateProvider: () => new Date('2026-02-15T06:00:00'),
      createId: vi.fn(() => 'should-not-create'),
    });

    expect(result.nextDevices).toEqual(['drenaje pleural']);
    expect(result.nextHistory).toEqual([
      expect.objectContaining({
        id: 'custom-history',
        type: 'drenaje pleural',
        status: 'Active',
        clinicalEpisodeId: 'episode-1',
        patientRut: '12.345.678-9',
      }),
    ]);
    expect(result.nextHistory.some(item => item.id === 'should-not-create')).toBe(false);
  });

  it('renames custom device history only for the current clinical owner', () => {
    const result = buildDeviceBundleChangeResult({
      previousDevices: ['drenaje pleural izquierdo'],
      nextDevices: ['drenaje pleural'],
      nextDetails: {
        'drenaje pleural': {
          installationDate: '2026-02-14',
          note: 'con oscilación',
        },
      },
      previousHistory: [
        {
          id: 'current-history',
          type: 'drenaje pleural izquierdo',
          status: 'Active',
          installationDate: '2026-02-14',
          clinicalEpisodeId: 'episode-current',
          patientRut: '12.345.678-9',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'other-episode-history',
          type: 'drenaje pleural izquierdo',
          status: 'Active',
          installationDate: '2026-02-10',
          clinicalEpisodeId: 'episode-other',
          patientRut: '98.765.432-1',
          createdAt: 2,
          updatedAt: 2,
        },
        {
          id: 'legacy-unowned-history',
          type: 'drenaje pleural izquierdo',
          status: 'Active',
          installationDate: '2026-02-11',
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      owner: { clinicalEpisodeId: 'episode-current', patientRut: '12.345.678-9' },
      renamedDevice: {
        from: 'drenaje pleural izquierdo',
        to: 'drenaje pleural',
      },
      dateProvider: () => new Date('2026-02-15T06:00:00'),
      createId: vi.fn(() => 'should-not-create'),
    });

    expect(result.nextHistory).toEqual([
      expect.objectContaining({
        id: 'current-history',
        type: 'drenaje pleural',
        clinicalEpisodeId: 'episode-current',
        patientRut: '12.345.678-9',
      }),
    ]);
    expect(result.nextHistory.map(item => item.id)).not.toContain('other-episode-history');
    expect(result.nextHistory.map(item => item.id)).not.toContain('legacy-unowned-history');
    expect(result.nextHistory.some(item => item.id === 'should-not-create')).toBe(false);
  });

  it.each([['movimiento interno'], ['alta'], ['traslado']])(
    'starts a clean DMI history for a reused bed after %s of the previous patient',
    () => {
      const result = buildDeviceBundleChangeResult({
        previousDevices: [],
        nextDevices: ['CVC', 'VVP#1'],
        nextDetails: {
          CVC: { installationDate: '2026-07-03' },
          'VVP#1': { installationDate: '2026-07-03' },
        },
        previousHistory: previousPatientResidueHistory,
        owner: currentPatientOwner,
        dateProvider: () => new Date('2026-07-03T10:00:00'),
        createId: vi.fn().mockReturnValueOnce('new-cvc').mockReturnValueOnce('new-vvp'),
      });

      expect(result.nextDevices).toEqual(['CVC', 'VVP#1']);
      expect(result.nextDetails).toEqual({
        CVC: { installationDate: '2026-07-03' },
        'VVP#1': { installationDate: '2026-07-03' },
      });
      expect(result.nextHistory.map(item => item.id)).toEqual(['new-cvc', 'new-vvp']);
      expect(result.nextHistory).toEqual([
        expect.objectContaining({
          id: 'new-cvc',
          type: 'CVC',
          status: 'Active',
          clinicalEpisodeId: 'episode-paciente-y',
          patientRut: '22.222.222-2',
          patientName: 'Paciente Y',
        }),
        expect.objectContaining({
          id: 'new-vvp',
          type: 'VVP#1',
          status: 'Active',
          clinicalEpisodeId: 'episode-paciente-y',
          patientRut: '22.222.222-2',
          patientName: 'Paciente Y',
        }),
      ]);
      expect(result.nextHistory.map(item => item.clinicalEpisodeId)).not.toContain(
        'episode-paciente-x'
      );
      expect(result.nextHistory.map(item => item.patientRut)).not.toContain('11.111.111-1');
    }
  );

  it('preserves DMI history when the same clinical episode returns to a previous bed', () => {
    const result = buildDeviceBundleChangeResult({
      previousDevices: ['CVC'],
      nextDevices: ['CVC', 'VVP#1'],
      nextDetails: {
        CVC: { installationDate: '2026-07-01', note: 'instalado antes del traslado interno' },
        'VVP#1': { installationDate: '2026-07-03' },
      },
      previousHistory: [
        {
          id: 'returning-cvc',
          type: 'CVC',
          installationDate: '2026-07-01',
          note: 'instalado antes del traslado interno',
          status: 'Active',
          clinicalEpisodeId: 'episode-paciente-x',
          patientRut: '11.111.111-1',
          patientName: 'Paciente X',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'other-patient-cup',
          type: 'CUP',
          installationDate: '2026-07-02',
          status: 'Active',
          clinicalEpisodeId: 'episode-paciente-y',
          patientRut: '22.222.222-2',
          patientName: 'Paciente Y',
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      owner: {
        clinicalEpisodeId: 'episode-paciente-x',
        patientRut: '11.111.111-1',
        patientName: 'Paciente X',
      },
      dateProvider: () => new Date('2026-07-03T10:00:00'),
      createId: vi.fn(() => 'returning-vvp'),
    });

    expect(result.nextDevices).toEqual(['CVC', 'VVP#1']);
    expect(result.nextHistory).toEqual([
      expect.objectContaining({
        id: 'returning-cvc',
        type: 'CVC',
        status: 'Active',
        clinicalEpisodeId: 'episode-paciente-x',
        patientRut: '11.111.111-1',
        patientName: 'Paciente X',
      }),
      expect.objectContaining({
        id: 'returning-vvp',
        type: 'VVP#1',
        status: 'Active',
        clinicalEpisodeId: 'episode-paciente-x',
        patientRut: '11.111.111-1',
        patientName: 'Paciente X',
      }),
    ]);
    expect(result.nextHistory.map(item => item.id)).not.toContain('other-patient-cup');
  });
});
