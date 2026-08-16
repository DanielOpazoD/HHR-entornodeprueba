import { describe, expect, it } from 'vitest';
import {
  resolveEventBridgeModule,
  resolveEventBridgeShift,
} from '@/components/layout/app-content/appContentEventBridgeController';

describe('appContentEventBridgeController', () => {
  it('accepts known application modules only', () => {
    expect(resolveEventBridgeModule('CUDYR')).toBe('CUDYR');
    expect(resolveEventBridgeModule('TRANSFER_MANAGEMENT')).toBeNull();
    expect(resolveEventBridgeModule('NOT_A_MODULE')).toBeNull();
    expect(resolveEventBridgeModule(undefined)).toBeNull();
  });

  it('accepts only valid day and night shift values', () => {
    expect(resolveEventBridgeShift('day')).toBe('day');
    expect(resolveEventBridgeShift('night')).toBe('night');
    expect(resolveEventBridgeShift('invalid')).toBeNull();
    expect(resolveEventBridgeShift(null)).toBeNull();
  });
});
