import { describe, expect, it, vi } from 'vitest';
import { readHistoricalPatientFlow } from '@/features/rayen-import/domain/historicalFlowAuthorizationRecovery';
const encounter = {
  encounterId: '1001',
  run: '8.260.364-6',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintético',
};
const denied = {
  base64: '',
  error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.',
};
const verified = { run: encounter.run, encounterId: '1001', egreso: { id: 1001 } };
describe('exact historical flow authorization recovery', () => {
  it('renews an older extension grant through exact source identity and reads at most twice', async () => {
    const fetchReport = vi
      .fn()
      .mockResolvedValueOnce(denied)
      .mockResolvedValueOnce({ base64: 'cGRm' });
    const lookupEgresos = vi.fn().mockResolvedValue([verified]);
    expect(await readHistoricalPatientFlow(encounter, { fetchReport, lookupEgresos })).toEqual({
      base64: 'cGRm',
    });
    expect(fetchReport).toHaveBeenCalledTimes(2);
    expect(lookupEgresos).toHaveBeenCalledWith([{ run: encounter.run, encounterId: '1001' }]);
  });
  it.each(
    [
      [],
      [verified, verified],
      [{ ...verified, run: '11.111.111-1' }],
      [{ ...verified, encounterId: '1002' }],
      [{ ...verified, egreso: { id: 1002 } }],
      [{ ...verified, egreso: { id: 1001, encounterId: 1002 } }],
      [{ ...verified, egreso: {} }],
    ].map(results => ({ results }))
  )('retains denial on missing or contradictory source identity: %j', async ({ results }) => {
    const fetchReport = vi.fn().mockResolvedValue(denied);
    expect(
      await readHistoricalPatientFlow(encounter, {
        fetchReport,
        lookupEgresos: vi.fn().mockResolvedValue(results),
      })
    ).toEqual(denied);
    expect(fetchReport).toHaveBeenCalledOnce();
  });
  it.each(['permission_denied', 'unexpected', 'source_timeout'] as const)(
    'does not reinterpret explicit %s as an expired episode grant',
    async errorCode => {
      const first = { ...denied, errorCode };
      const fetchReport = vi.fn().mockResolvedValue(first),
        lookupEgresos = vi.fn();
      expect(await readHistoricalPatientFlow(encounter, { fetchReport, lookupEgresos })).toEqual(
        first
      );
      expect(lookupEgresos).not.toHaveBeenCalled();
    }
  );
});
