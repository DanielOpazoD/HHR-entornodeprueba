import { describe, expect, it, vi } from 'vitest';
import { createPatientFlowRequestCache } from '@/features/rayen-import/domain/patientFlowRequestCache';

describe('createPatientFlowRequestCache', () => {
  it('coalesces concurrent reads and reuses one valid report during the run', async () => {
    const readReport = vi.fn(async (encounterId: string) => ({
      base64: `pdf-${encounterId}`,
    }));
    const cachedRead = createPatientFlowRequestCache(readReport);

    const [first, concurrent] = await Promise.all([cachedRead('142083'), cachedRead('142083')]);
    const later = await cachedRead('142083');

    expect(first).toEqual({ base64: 'pdf-142083' });
    expect(concurrent).toEqual(first);
    expect(later).toEqual(first);
    expect(readReport).toHaveBeenCalledTimes(1);
  });

  it('does not share evidence between different encounters', async () => {
    const readReport = vi.fn(async (encounterId: string) => ({
      base64: `pdf-${encounterId}`,
    }));
    const cachedRead = createPatientFlowRequestCache(readReport);

    await Promise.all([cachedRead('142083'), cachedRead('142084')]);

    expect(readReport).toHaveBeenCalledTimes(2);
  });

  it('evicts empty, failed and rejected reads so a later stage can retry', async () => {
    const readReport = vi
      .fn<(encounterId: string) => Promise<{ base64: string; error?: string }>>()
      .mockResolvedValueOnce({ base64: '', error: 'temporal' })
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValueOnce({ base64: 'pdf-recuperado' });
    const cachedRead = createPatientFlowRequestCache(readReport);

    await expect(cachedRead('142083')).resolves.toEqual({ base64: '', error: 'temporal' });
    await expect(cachedRead('142083')).rejects.toThrow('red');
    await expect(cachedRead('142083')).resolves.toEqual({ base64: 'pdf-recuperado' });

    expect(readReport).toHaveBeenCalledTimes(3);
  });
});
