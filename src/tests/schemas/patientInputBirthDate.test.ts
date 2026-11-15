// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PatientInputSchema } from '@/schemas/inputSchemas';

const ZONES = [
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
];

const accepts = (birthDate: string) =>
  PatientInputSchema.pick({ birthDate: true }).safeParse({ birthDate }).success;

describe.each(ZONES)('birth date on a %s computer', zone => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    vi.useRealTimers();
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  // Rapa Nui is UTC-5 in November and UTC-6 in July.
  it.each([
    ['2026-11-15T05:30:00Z', '00:30 on 15 Nov'],
    ['2026-11-15T17:00:00Z', '12:00 on 15 Nov'],
    ['2026-11-15T23:30:00Z', '18:30 on 15 Nov'],
    ['2026-11-16T00:30:00Z', '19:30 on 15 Nov'],
    ['2026-11-16T04:30:00Z', '23:30 on 15 Nov'],
  ])('accepts today and rejects tomorrow at %s (%s in Rapa Nui)', instant => {
    process.env.TZ = zone;
    vi.useFakeTimers({ now: new Date(instant) });
    expect(accepts('2026-11-14')).toBe(true);
    expect(accepts('2026-11-15')).toBe(true);
    expect(accepts('2026-11-16')).toBe(false);
  });

  it('uses the winter offset too', () => {
    process.env.TZ = zone;
    // 23:30 on 15 Jul in Rapa Nui.
    vi.useFakeTimers({ now: new Date('2026-07-16T05:30:00Z') });
    expect(accepts('2026-07-15')).toBe(true);
    expect(accepts('2026-07-16')).toBe(false);
  });

  it('keeps accepting an empty value and rejecting another format', () => {
    process.env.TZ = zone;
    expect(accepts('')).toBe(true);
    expect(accepts('15-11-2026')).toBe(false);
  });
});
