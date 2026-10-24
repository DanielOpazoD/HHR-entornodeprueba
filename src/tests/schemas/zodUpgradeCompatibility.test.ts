// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DailyRecordSchema } from '@/schemas/zod/dailyRecord';

describe('Zod security upgrade', () => {
  it('rejects an oversized constrained array before validating its elements', () => {
    const inspectElement = vi.fn((value: unknown) => value);
    const schema = z.array(z.preprocess(inspectElement, z.string())).max(2);
    const result = schema.safeParse(Array.from({ length: 5_000 }, () => 0));

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Oversized input was accepted');
    expect(result.error.issues).toEqual([expect.objectContaining({ code: 'too_big', maximum: 2 })]);
    expect(inspectElement).not.toHaveBeenCalled();
  });

  it('rejects an oversized constrained set before validating its elements', () => {
    const inspectElement = vi.fn((value: unknown) => value);
    const schema = z.set(z.preprocess(inspectElement, z.string())).max(2);
    const result = schema.safeParse(new Set(Array.from({ length: 5_000 }, (_, index) => index)));

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Oversized input was accepted');
    expect(result.error.issues).toEqual([expect.objectContaining({ code: 'too_big', maximum: 2 })]);
    expect(inspectElement).not.toHaveBeenCalled();
  });

  it('keeps legacy defaults and absent episode fields while parsing a minimal stored day', () => {
    const record = DailyRecordSchema.parse({
      date: '2026-10-24',
      lastUpdated: '2026-10-24T10:00:00Z',
      beds: { R1: { bedId: 'R1', patientName: 'Synthetic patient' } },
    });

    expect(record.beds.R1).toMatchObject({ bedMode: 'Cama', hasWristband: true, isBlocked: false });
    expect(record.discharges).toEqual([]);
    expect(record.nursesDayShift).toEqual(['', '']);
    expect(record.handoffDayChecklist).toEqual({});
    expect(record).not.toHaveProperty('clinicalDerivedLayout');
    expect(record.beds.R1).not.toHaveProperty('clinicalSyncCheckpoint');
    expect(record.beds.R1).not.toHaveProperty('vitalSignsHistory');
  });
});
