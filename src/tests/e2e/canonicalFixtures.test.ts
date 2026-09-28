import { describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { buildCanonicalE2ERecord, setupE2EContext } from '../../../e2e/fixtures/auth';
import { DailyRecordSchema } from '@/schemas/zod/dailyRecord';

const date = '2026-09-27';

describe('E2E census fixtures use the runtime record contract', () => {
  it('validates every canonical bed without dropping it during hydration', () => {
    const record = buildCanonicalE2ERecord(date);
    const parsed = DailyRecordSchema.parse(record);
    expect(Object.keys(parsed.beds)).toHaveLength(23);
    expect(Object.values(parsed.beds).every(bed => bed.bedMode === 'Cama')).toBe(true);
    expect(parsed.beds.R1.bedMode).toBe('Cama');
  });

  it.each([false, true])('validates the injected context with populated=%s', async populate => {
    const page = {
      addInitScript: vi.fn(),
      goto: vi.fn(),
      reload: vi.fn(),
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      getByTestId: () => ({ isVisible: vi.fn().mockResolvedValue(false) }),
      evaluate: async (callback: (args: unknown) => void, args: unknown) => callback(args),
    } as unknown as Page;
    await setupE2EContext(page, 'editor', populate, date);
    const raw = JSON.parse(localStorage.getItem('hanga_roa_hospital_data') || '{}')[date];
    const parsed = DailyRecordSchema.parse(raw);
    expect(Object.keys(parsed.beds)).toHaveLength(23);
    expect(parsed.beds.R1.patientName).toBe(populate ? 'MOCK PATIENT' : '');
    expect(Object.values(parsed.beds).every(bed => bed.bedMode === 'Cama')).toBe(true);
  });
});
