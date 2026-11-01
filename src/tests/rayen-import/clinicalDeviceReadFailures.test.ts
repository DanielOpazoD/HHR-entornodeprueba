import { describe, expect, it, vi } from 'vitest';
import { runClinicalFill, type ClinicalFillDeps } from './support/batchClinicalFill';
import { mergeClinicalDeviceRead } from '@/features/rayen-import/domain/mergeClinicalDeviceRead';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { applyPatches } from '@/utils/patchUtils';
import type { DeviceInstance } from '@/types/domain/devices';

const DAY = '2026-10-18';
const now = () => new Date('2026-10-18T18:00:00Z');
const row = { name: 'CVC', installationDatetime: '2026-10-16T12:30:33.14-03:00' };
const patient = () =>
  mergeClinicalDeviceRead(
    {
      ...createEmptyPatient('R1'),
      patientName: 'PACIENTE SINTETICO FALLOS',
      rut: '99999993-3',
      clinicalEpisodeId: 'synthetic-failure-episode',
      admissionDate: '2026-10-15',
    },
    { source: 'json', entries: [row], textItems: [] },
    DAY,
    { now, createId: () => 'synthetic-cvc' }
  );
const census = () => ({ ...buildInitializedDayRecord(DAY, null), beds: { R1: patient() } });
const dependencies = (): ClinicalFillDeps => ({
  fetchDeviceReport: vi.fn().mockResolvedValue({ source: 'json', entries: [], base64: '' }),
  extractDeviceItems: vi.fn().mockResolvedValue([]),
  fetchHistoryScales: vi.fn().mockResolvedValue({ events: [], nursingActivity: [] }),
  fetchScalesForms: vi.fn().mockResolvedValue({ forms: [] }),
  fetchCudyrCategories: vi
    .fn()
    .mockResolvedValue({ items: [], source: 'gestion_camas', historyAvailable: true }),
  applyPatch: vi.fn().mockResolvedValue(undefined),
  now,
  createId: () => 'synthetic-cvc',
});

describe('device source failures through the clinical runner', () => {
  it.each([
    { label: 'failed read', report: { error: 'synthetic network failure', base64: '' } },
    {
      label: 'session error with a misleading empty list',
      report: {
        error: 'Sesión requerida',
        errorCode: 'session_required',
        source: 'json',
        entries: [],
        base64: '',
      },
    },
    { label: 'JSON without an array', report: { source: 'json', base64: '' } },
    { label: 'JSON with a malformed row', report: { source: 'json', entries: [null], base64: '' } },
  ])('keeps devices on $label', async ({ report }) => {
    const record = census();
    const deps = dependencies();
    deps.fetchDeviceReport = vi.fn().mockResolvedValue(report);
    const result = await runClinicalFill(record, DAY, deps);
    expect(result.errors.some(error => error.source === 'devices')).toBe(true);
    const apply = vi.mocked(deps.applyPatch);
    expect(
      apply.mock.calls.every(([patch]) => !Object.keys(patch).some(key => /device/i.test(key)))
    ).toBe(true);
    expect(record.beds.R1.devices).toEqual(['CVC']);
  });

  it('persists a successful retirement and emits no second clinical patch on resynchronization', async () => {
    const record = census();
    const deps = dependencies();
    const first = await runClinicalFill(record, DAY, deps);
    expect(first.errors).toEqual([]);
    expect(vi.mocked(deps.applyPatch).mock.calls).toHaveLength(1);
    const patch = vi.mocked(deps.applyPatch).mock.calls[0][0];
    const persisted = applyPatches(record, patch);
    expect(persisted.beds.R1.devices).toEqual([]);
    expect(persisted.beds.R1.deviceInstanceHistory?.[0]).toMatchObject({
      status: 'Removed',
      removalDate: DAY,
      removalSource: 'eloisa-absence',
    } satisfies Partial<DeviceInstance>);
    vi.mocked(deps.applyPatch).mockClear();
    const second = await runClinicalFill(persisted, DAY, deps);
    expect(second.errors).toEqual([]);
    expect(deps.applyPatch).not.toHaveBeenCalled();
  });
});
