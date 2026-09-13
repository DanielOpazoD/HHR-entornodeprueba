import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS,
  RAYEN_PATIENT_FLOW_CAPABILITY,
  RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_CAPABILITY,
  requestRayenExtensionHealth,
  type RayenExtensionHealthReport,
} from '@/features/rayen-import/bridge/extensionHealthBridge';
import { requestPatientFlowReport } from '@/features/rayen-import/bridge/patientFlowBridge';
import { requestStatisticalDischargeEvidence } from '@/features/rayen-import/bridge/statisticalDischargeEvidenceBridge';
import { requestEgresoLookup } from '@/features/rayen-import/bridge/rayenImportBridge';
import { createRayenSnapshotEvidenceClient } from '@/features/rayen-import/hooks/rayenSnapshotEvidenceClient';

vi.mock('@/features/rayen-import/bridge/extensionHealthBridge', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/features/rayen-import/bridge/extensionHealthBridge')
  >()),
  requestRayenExtensionHealth: vi.fn(),
}));
vi.mock('@/features/rayen-import/bridge/patientFlowBridge', () => ({
  requestPatientFlowReport: vi.fn(),
}));
vi.mock('@/features/rayen-import/bridge/statisticalDischargeEvidenceBridge', () => ({
  requestStatisticalDischargeEvidence: vi.fn(),
}));
vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  requestEgresoLookup: vi.fn(),
}));

const healthyReport: RayenExtensionHealthReport = {
  version: '5.0.0',
  protocolVersion: 5,
  checkedAt: '2026-09-09T12:00:00.000Z',
  capabilities: [RAYEN_PATIENT_FLOW_CAPABILITY, RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_CAPABILITY],
  fichaMedico: { status: 'ready', message: 'Conectado' },
  gestionCamas: { status: 'ready', message: 'Conectado' },
};

const setup = (historical = false) => {
  const counters = { requests: 0, cacheHits: 0, timeouts: 0 };
  return { counters, client: createRayenSnapshotEvidenceClient(historical, counters) };
};

const expectNoPatientReads = () => {
  expect(requestPatientFlowReport).not.toHaveBeenCalled();
  expect(requestStatisticalDischargeEvidence).not.toHaveBeenCalled();
};

describe('createRayenSnapshotEvidenceClient', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requestRayenExtensionHealth).mockResolvedValue({ report: healthyReport });
    vi.mocked(requestPatientFlowReport).mockResolvedValue({ base64: 'patient-flow-pdf' });
    vi.mocked(requestStatisticalDischargeEvidence).mockResolvedValue({ base64: 'discharge-pdf' });
  });

  afterEach(() => vi.useRealTimers());

  it.each([false, true])(
    'recovers after the first blocking timeout and shares both health attempts (historical=%s)',
    async historical => {
      vi.useFakeTimers();
      vi.mocked(requestRayenExtensionHealth).mockImplementationOnce(
        timeoutMs =>
          new Promise(resolve => {
            setTimeout(
              () => resolve({ report: null, error: 'Tiempo de espera agotado.' }),
              timeoutMs
            );
          })
      );
      const { client, counters } = setup(historical);
      const first = client.fetchPatientFlowReport('101');
      const duplicate = client.fetchPatientFlowReport('101');
      const discharge = client.fetchStatisticalDischarge('101');
      expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(1);
      expectNoPatientReads();

      await vi.advanceTimersByTimeAsync(RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS - 1);
      expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(1);
      expectNoPatientReads();
      await vi.advanceTimersByTimeAsync(1);

      expect(await first).toEqual({ base64: 'patient-flow-pdf' });
      expect(await duplicate).toEqual(await first);
      expect(await discharge).toEqual({ base64: 'discharge-pdf' });
      expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(2);
      expect(vi.mocked(requestRayenExtensionHealth).mock.calls).toEqual([
        [RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS],
        [RAYEN_EXTENSION_SYNC_HEALTH_TIMEOUT_MS],
      ]);
      expect(requestPatientFlowReport).toHaveBeenCalledExactlyOnceWith(
        '101',
        historical ? 15_000 : 30_000
      );
      expect(requestStatisticalDischargeEvidence).toHaveBeenCalledExactlyOnceWith('101');
      await client.fetchPatientFlowReport('101');
      await client.fetchPatientFlowReport('102');
      expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(2);
      expect(counters).toEqual({ requests: 5, cacheHits: 2, timeouts: 1 });
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each([
    { capabilities: [] },
    { capabilities: [RAYEN_PATIENT_FLOW_CAPABILITY] },
    { capabilities: [RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_CAPABILITY] },
  ])(
    'only calls capabilities confirmed in an actual report: $capabilities',
    async ({ capabilities }) => {
      vi.mocked(requestRayenExtensionHealth).mockResolvedValue({
        report: { ...healthyReport, capabilities },
      });
      const { client } = setup();
      const [flow, discharge] = await Promise.all([
        client.fetchPatientFlowReport('101'),
        client.fetchStatisticalDischarge('101'),
      ]);
      if (capabilities.includes(RAYEN_PATIENT_FLOW_CAPABILITY)) {
        expect(flow).toEqual({ base64: 'patient-flow-pdf' });
        expect(requestPatientFlowReport).toHaveBeenCalledTimes(1);
      } else {
        expect(flow.error).toBe('La extensión instalada no admite trazabilidad de camas.');
        expect(requestPatientFlowReport).not.toHaveBeenCalled();
      }
      if (capabilities.includes(RAYEN_STATISTICAL_DISCHARGE_EVIDENCE_CAPABILITY)) {
        expect(discharge).toEqual({ base64: 'discharge-pdf' });
        expect(requestStatisticalDischargeEvidence).toHaveBeenCalledTimes(1);
      } else {
        expect(discharge.error).toBe(
          'La extensión instalada no admite lectura del egreso individual.'
        );
        expect(requestStatisticalDischargeEvidence).not.toHaveBeenCalled();
      }
      await client.fetchPatientFlowReport('102');
      await client.fetchStatisticalDischarge('102');
      expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['null', 'error', 'rejection', 'report-with-error'])(
    'bounds failed %s verification to two shared probes, then permits same-encounter recovery',
    async failure => {
      const health = vi.mocked(requestRayenExtensionHealth);
      if (failure === 'rejection') {
        health.mockRejectedValue(new Error('Bridge unavailable'));
      } else {
        health.mockResolvedValue({
          report: failure === 'report-with-error' ? healthyReport : null,
          ...(failure === 'null' ? {} : { error: 'Diagnóstico temporalmente no disponible' }),
        });
      }
      const { client, counters } = setup();
      const results = await Promise.all([
        client.fetchPatientFlowReport('101'),
        client.fetchPatientFlowReport('102'),
        client.fetchStatisticalDischarge('101'),
      ]);
      expect(health).toHaveBeenCalledTimes(2);
      expectNoPatientReads();
      for (const result of results) {
        expect(result.base64).toBe('');
        expect(result.error).toContain('No se pudo verificar temporalmente');
        expect(result.error).toContain('dos intentos');
        expect(result.error).not.toContain('no admite');
      }
      expect(counters.requests).toBe(2);

      health.mockResolvedValue({ report: healthyReport });
      expect(await client.fetchPatientFlowReport('101')).toEqual({ base64: 'patient-flow-pdf' });
      expect(await client.fetchStatisticalDischarge('101')).toEqual({ base64: 'discharge-pdf' });
      expect(health).toHaveBeenCalledTimes(3);
      expect(counters).toEqual({ requests: 5, cacheHits: 0, timeouts: 0 });
    }
  );

  it('recovers within the retry budget after a rejected health probe', async () => {
    vi.mocked(requestRayenExtensionHealth).mockRejectedValueOnce(new Error('timeout'));
    const { client, counters } = setup();
    expect(await client.fetchPatientFlowReport('101')).toEqual({ base64: 'patient-flow-pdf' });
    expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(2);
    expect(counters).toEqual({ requests: 3, cacheHits: 0, timeouts: 1 });
  });

  it('never reads patient evidence while the retry is still unverified', async () => {
    let resolveRetry!: (value: { report: RayenExtensionHealthReport }) => void;
    vi.mocked(requestRayenExtensionHealth)
      .mockResolvedValueOnce({ report: null })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveRetry = resolve;
          })
      );
    const { client } = setup();
    const flow = client.fetchPatientFlowReport('101');
    const discharge = client.fetchStatisticalDischarge('101');
    await Promise.resolve();
    expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(2);
    expectNoPatientReads();
    resolveRetry({ report: healthyReport });
    expect(await flow).toEqual({ base64: 'patient-flow-pdf' });
    expect(await discharge).toEqual({ base64: 'discharge-pdf' });
  });

  it('does not retain failed patient reports after health has been verified', async () => {
    vi.mocked(requestPatientFlowReport)
      .mockResolvedValueOnce({ base64: '', error: 'Tiempo de espera agotado.' })
      .mockRejectedValueOnce(new Error('Temporary read failure'));
    const { client, counters } = setup();
    expect((await client.fetchPatientFlowReport('101')).error).toContain('Tiempo de espera');
    await expect(client.fetchPatientFlowReport('101')).rejects.toThrow('Temporary read failure');
    expect(await client.fetchPatientFlowReport('101')).toEqual({ base64: 'patient-flow-pdf' });
    await client.fetchPatientFlowReport('101');
    expect(requestPatientFlowReport).toHaveBeenCalledTimes(3);
    expect(requestRayenExtensionHealth).toHaveBeenCalledTimes(1);
    expect(counters).toEqual({ requests: 4, cacheHits: 1, timeouts: 1 });
  });

  it('keeps empty discharge lookups free of health and evidence requests', async () => {
    const { client, counters } = setup();
    expect(await client.lookupEgresos([])).toEqual([]);
    expect(requestRayenExtensionHealth).not.toHaveBeenCalled();
    expect(requestEgresoLookup).not.toHaveBeenCalled();
    expectNoPatientReads();
    expect(counters).toEqual({ requests: 0, cacheHits: 0, timeouts: 0 });
  });
});
