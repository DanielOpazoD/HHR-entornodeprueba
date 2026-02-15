import { describe, expect, it } from 'vitest';
import {
  buildDeviceConfigMutation,
  buildRetireDeviceMutation,
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
