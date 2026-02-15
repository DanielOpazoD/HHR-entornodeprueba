import { describe, expect, it } from 'vitest';
import {
  buildRetireNote,
  normalizeSelectedDevices,
  resolveCustomDeviceOptions,
  resolveDeviceToggleOutcome,
  resolveNextVvpKey,
  resolveVvpDevices,
} from '@/components/device-selector/deviceSelectorController';

describe('deviceSelectorController', () => {
  it('normalizes legacy and explicit VVP keys into bounded VVP slots', () => {
    expect(normalizeSelectedDevices(['CVC', 'VVP', '2 VVP'])).toEqual([
      'CVC',
      'VVP#1',
      'VVP#2',
      'VVP#3',
    ]);
    expect(normalizeSelectedDevices(['SNG', 'VVP#2'])).toEqual(['SNG', 'VVP#1']);
  });

  it('resolves active VVP keys in canonical order', () => {
    const normalized = ['CVC', 'VVP#1', 'VVP#3', 'VVP#2'];
    expect(resolveVvpDevices(normalized)).toEqual(['VVP#1', 'VVP#2', 'VVP#3']);
  });

  it('resolves next available VVP slot or null when full', () => {
    expect(resolveNextVvpKey(['VVP#1'])).toBe('VVP#2');
    expect(resolveNextVvpKey(['VVP#1', 'VVP#2', 'VVP#3'])).toBeNull();
  });

  it('maps VVP toggle intent to pending addition when slot exists', () => {
    expect(
      resolveDeviceToggleOutcome({
        requestedDevice: 'VVP',
        normalizedDevices: ['CVC', 'VVP#1'],
      })
    ).toEqual({
      kind: 'pendingAddition',
      device: 'VVP#2',
    });
  });

  it('maps toggle intent to retire for selected device and pending for new one', () => {
    expect(
      resolveDeviceToggleOutcome({
        requestedDevice: 'CVC',
        normalizedDevices: ['CVC', 'VVP#1'],
      })
    ).toEqual({
      kind: 'retire',
      device: 'CVC',
    });

    expect(
      resolveDeviceToggleOutcome({
        requestedDevice: 'SNG',
        normalizedDevices: ['CVC', 'VVP#1'],
      })
    ).toEqual({
      kind: 'pendingAddition',
      device: 'SNG',
    });
  });

  it('filters custom device options excluding standard and VVP aliases', () => {
    expect(resolveCustomDeviceOptions(['CVC', 'Bomba', 'VVP#1', 'VVP', '2 VVP'])).toEqual([
      'Bomba',
    ]);
  });

  it('builds retire note preserving prior note when present', () => {
    expect(buildRetireNote(undefined, 'fin de uso')).toBe('[Retiro] fin de uso');
    expect(buildRetireNote('seguimiento', 'fin de uso')).toBe('seguimiento\n[Retiro] fin de uso');
  });
});
