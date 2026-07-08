import { describe, expect, it } from 'vitest';
import {
  buildDeviceConfigMutation,
  buildRetireDeviceMutation,
  renameCustomDeviceBundle,
  resolveRetiringDeviceLabel,
} from '@/components/device-selector/deviceSelectorMutationController';

describe('deviceSelectorMutationController', () => {
  it('builds retire mutation with updated details and filtered active devices', () => {
    const mutation = buildRetireDeviceMutation({
      retiringDevice: 'CVC',
      normalizedDevices: ['CVC', 'VVP#1'],
      deviceDetails: {
        CVC: { installationDate: '2026-01-01', note: 'seguimiento' },
        'VVP#1': { installationDate: '2026-01-02' },
      },
      removalDate: '2026-02-15',
      note: 'retiro por alta',
    });

    expect(mutation.nextDevices).toEqual(['VVP#1']);
    expect(mutation.nextDetails.CVC).toMatchObject({
      installationDate: '2026-01-01',
      removalDate: '2026-02-15',
      note: 'seguimiento\n[Retiro] retiro por alta',
    });
  });

  it('builds config mutation for pending addition and strips removalDate', () => {
    const mutation = buildDeviceConfigMutation({
      pendingAddition: 'SNG',
      editingDevice: null,
      normalizedDevices: ['CVC'],
      deviceDetails: {
        CVC: { installationDate: '2026-01-01' },
      },
      info: {
        installationDate: '2026-02-14',
        removalDate: '2026-02-15',
        note: 'activo',
      },
    });

    expect(mutation.operatedDevice).toBe('SNG');
    expect(mutation.nextDevices).toEqual(['CVC', 'SNG']);
    expect(mutation.nextDetails?.SNG).toEqual({
      installationDate: '2026-02-14',
      note: 'activo',
    });
  });

  it('builds config mutation for editing existing device without altering active list', () => {
    const mutation = buildDeviceConfigMutation({
      pendingAddition: null,
      editingDevice: 'CVC',
      normalizedDevices: ['CVC', 'VVP#1'],
      deviceDetails: {
        CVC: { installationDate: '2026-01-01' },
      },
      info: {
        installationDate: '2026-02-10',
        note: 'reconfigurado',
      },
    });

    expect(mutation.operatedDevice).toBe('CVC');
    expect(mutation.nextDevices).toBeNull();
    expect(mutation.nextDetails?.CVC).toEqual({
      installationDate: '2026-02-10',
      note: 'reconfigurado',
    });
  });

  it('renames a custom device across active list, details and history', () => {
    const renamed = renameCustomDeviceBundle({
      previousDevice: 'drenaje pleural izquierdo',
      nextDevice: 'drenaje pleural',
      normalizedDevices: ['VVP#1', 'drenaje pleural izquierdo'],
      deviceDetails: {
        'VVP#1': { installationDate: '2026-02-14' },
        'drenaje pleural izquierdo': {
          installationDate: '2026-02-15',
          note: 'lado izquierdo',
        },
      },
      history: [
        {
          id: 'custom-1',
          type: 'drenaje pleural izquierdo',
          status: 'Active',
          installationDate: '2026-02-15',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    expect(renamed.nextDevices).toEqual(['VVP#1', 'drenaje pleural']);
    expect(renamed.nextDetails).toEqual({
      'VVP#1': { installationDate: '2026-02-14' },
      'drenaje pleural': {
        installationDate: '2026-02-15',
        note: 'lado izquierdo',
      },
    });
    expect(renamed.nextHistory).toEqual([
      expect.objectContaining({
        id: 'custom-1',
        type: 'drenaje pleural',
      }),
    ]);
  });

  it('does not rename a configured device over another active device', () => {
    const mutation = buildDeviceConfigMutation({
      pendingAddition: null,
      editingDevice: 'drenaje pleural izquierdo',
      nextDeviceName: 'CVC',
      normalizedDevices: ['CVC', 'drenaje pleural izquierdo'],
      deviceDetails: {
        CVC: { installationDate: '2026-02-14', note: 'central' },
        'drenaje pleural izquierdo': { installationDate: '2026-02-15' },
      },
      info: {
        installationDate: '2026-02-16',
        note: 'revisado',
      },
    });

    expect(mutation.renamedDevice).toBeNull();
    expect(mutation.nextDevices).toBeNull();
    expect(mutation.nextDetails).toEqual({
      CVC: { installationDate: '2026-02-14', note: 'central' },
      'drenaje pleural izquierdo': {
        installationDate: '2026-02-16',
        note: 'revisado',
      },
    });
  });

  it('does not add a pending custom device over another active device', () => {
    const mutation = buildDeviceConfigMutation({
      pendingAddition: 'drenaje pleural izquierdo',
      editingDevice: null,
      nextDeviceName: 'CVC',
      normalizedDevices: ['CVC'],
      deviceDetails: {
        CVC: { installationDate: '2026-02-14', note: 'central' },
      },
      info: {
        installationDate: '2026-02-16',
        note: 'nuevo',
      },
    });

    expect(mutation).toEqual({
      operatedDevice: 'drenaje pleural izquierdo',
      renamedDevice: null,
      nextDevices: null,
      nextDetails: null,
    });
  });

  it('keeps bundle unchanged when a custom device rename collides with an active device', () => {
    const history = [
      {
        id: 'custom-1',
        type: 'drenaje pleural izquierdo',
        status: 'Active' as const,
        installationDate: '2026-02-15',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const deviceDetails = {
      CVC: { installationDate: '2026-02-14', note: 'central' },
      'drenaje pleural izquierdo': { installationDate: '2026-02-15' },
    };

    const renamed = renameCustomDeviceBundle({
      previousDevice: 'drenaje pleural izquierdo',
      nextDevice: 'CVC',
      normalizedDevices: ['CVC', 'drenaje pleural izquierdo'],
      deviceDetails,
      history,
    });

    expect(renamed).toEqual({
      nextDevices: ['CVC', 'drenaje pleural izquierdo'],
      nextDetails: deviceDetails,
      nextHistory: history,
    });
  });

  it('returns noop mutation when neither pending nor editing device exists', () => {
    const mutation = buildDeviceConfigMutation({
      pendingAddition: null,
      editingDevice: null,
      normalizedDevices: ['CVC'],
      deviceDetails: {},
      info: { installationDate: '2026-02-15' },
    });

    expect(mutation).toEqual({
      operatedDevice: null,
      nextDevices: null,
      nextDetails: null,
    });
  });

  it('resolves retiring label for VVP and non-VVP devices', () => {
    expect(resolveRetiringDeviceLabel('VVP#2')).toBe('VVP #2');
    expect(resolveRetiringDeviceLabel('CVC')).toBe('CVC');
  });
});
