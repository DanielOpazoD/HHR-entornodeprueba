/**
 * Restoring a split day from a JSON backup (D10 of DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md):
 * a marked day the section does not list, and an episode id more than one holder of the day
 * carries, are reported partial and never give one patient another's data. Synthetic data only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

const mocks = vi.hoisted(() => ({
  getLocal: vi.fn(),
  saveMany: vi.fn(),
  saveRemote: vi.fn(),
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  saveRecordsStrict: mocks.saveMany,
}));
vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mocks.saveRemote,
}));
// No day here is confirmed against the server: a read would never run.
vi.mock('@/services/repositories/dailyRecordClinicalDerivedReadService', () => ({
  readClinicalDerivedDayDocs: vi.fn(),
}));
vi.mock('@/services/admin/auditService', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@example.invalid',
}));

import { importRecordsFromBackup } from '@/services/admin/dataMaintenanceService';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import { restoreClinicalDerivedBackupDay } from '@/services/exporters/clinicalDerivedBackupRestore';
import {
  DATE,
  NEW_LAYOUT,
  monthBackup,
  patient,
  reading,
  section,
  splitDay,
} from '@/tests/services/exporters/clinicalDerivedBackupRestore.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLocal.mockResolvedValue(null);
  mocks.saveMany.mockResolvedValue({ ok: true });
});

/** The repository save: the server confirms `confirm(sent)`. */
const serverConfirms = (confirm: (sent: DailyRecord) => DailyRecord) =>
  mocks.saveRemote.mockImplementation(async (sent: DailyRecord) => ({
    outcome: 'clean',
    savedLocally: true,
    savedRemotely: true,
    confirmedRecord: confirm(sent),
  }));

describe('restoring a split day whose backup has no section entry for it', () => {
  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', {}],
  ])('the monthly restore is partial when the section is %s', async (_label, missing) => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup({
      ...monthBackup([splitDay()]),
      clinicalDerived: missing as never,
    });

    expect(result).toEqual({
      success: 1,
      failed: 0,
      repaired: 0,
      outcome: 'partial',
      clinicalDerivedIncompleteDates: [DATE],
    });
    // The day itself is still restored, as backed up.
    const [saved] = mocks.saveRemote.mock.calls[0] as [DailyRecord];
    expect(saved.beds.R2).toMatchObject({ rut: 'AB123456', clinicalEpisodeId: 'ep_pasaporte_2' });
    expect(saved.beds.R2).not.toHaveProperty('vitalSignsHistory');
  });

  it('the local JSON import is partial without the section', async () => {
    const file = new File([JSON.stringify({ [DATE]: splitDay() })], 'respaldo-sintetico.json', {
      type: 'application/json',
    });

    const result = await importDataJSONDetailed(file);

    expect(result).toMatchObject({
      success: true,
      outcome: 'partial',
      importedCount: 1,
      skippedEntries: [],
      clinicalDerivedIncompleteDates: [DATE],
    });
  });

  it('an unmarked day without the section stays clean', async () => {
    serverConfirms(sent => sent);
    const unmarked: DailyRecord = { ...splitDay(), clinicalDerivedLayout: undefined };

    const result = await importRecordsFromBackup({
      ...monthBackup([unmarked]),
      clinicalDerived: undefined,
    });

    expect(result).toEqual({ success: 1, failed: 0, repaired: 0, outcome: 'clean' });
  });
});

describe('an episode id more than one holder of the day carries', () => {
  /** A discharge snapshot of another patient that carries `ep_alta_3` too. */
  const otherSnapshot = (day: DailyRecord) => {
    const other = structuredClone(day.discharges[0]);
    other.id = 'alta-sintetica-2';
    other.patientName = 'Otra Alta Sintética';
    other.originalData = patient('R3', { rut: '33.333.333-3', clinicalEpisodeId: 'ep_alta_3' });
    return other;
  };

  it.each<[string, (day: DailyRecord) => DailyRecord]>([
    [
      'two discharge snapshots',
      day => ({ ...day, discharges: [...day.discharges, otherSnapshot(day)] }),
    ],
    [
      'a discharge and a transfer snapshot',
      day => ({
        ...day,
        transfers: [
          DataFactory.createMockTransfer({
            bedId: 'R5',
            patientName: 'Traslado Sintético',
            clinicalEpisodeId: 'ep_alta_3',
            originalData: patient('R5', { rut: '33.333.333-3', clinicalEpisodeId: 'ep_alta_3' }),
          }),
        ],
      }),
    ],
    [
      'a bed patient and a discharge snapshot',
      day => ({
        ...day,
        beds: {
          ...day.beds,
          R4: patient('R4', { rut: '33.333.333-3', clinicalEpisodeId: 'ep_alta_3' }),
        },
      }),
    ],
  ])('gives the document to none of %s and reports the day partial', async (_label, edit) => {
    serverConfirms(sent => ({ ...sent, clinicalDerivedLayout: NEW_LAYOUT }));

    const result = await importRecordsFromBackup(monthBackup([edit(splitDay())]));

    expect(result).toMatchObject({ outcome: 'partial', clinicalDerivedIncompleteDates: [DATE] });
    const [saved] = mocks.saveRemote.mock.calls[0] as [DailyRecord];
    const holders = [
      ...Object.values(saved.beds),
      ...[...saved.discharges, ...saved.transfers].map(movement => movement.originalData),
    ].filter(holder => holder?.clinicalEpisodeId === 'ep_alta_3');
    expect(holders.map(holder => holder?.rut).sort()).toEqual(['22.222.222-2', '33.333.333-3']);
    holders.forEach(holder => {
      expect(holder).not.toHaveProperty('vitalSignsHistory');
      expect(holder).not.toHaveProperty('clinicalSyncCheckpoint');
    });
    // The other episodes still get their own.
    expect(saved.beds.R2.vitalSignsHistory).toEqual([reading(70)]);
  });

  it('gives the document to neither of two bed patients with the same episode', () => {
    const day = splitDay();
    day.beds.R4 = { ...day.beds.R2, bedId: 'R4', rut: '33.333.333-3' };

    const restored = restoreClinicalDerivedBackupDay(day, section());

    expect(restored.kind).toBe('incomplete');
    if (restored.kind === 'absent') return;
    expect(restored.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
    expect(restored.record.beds.R4).not.toHaveProperty('vitalSignsHistory');
  });

  it('never falls back to the bed when the episode is gone from it', () => {
    const day = splitDay();
    delete day.beds.R2.clinicalEpisodeId;

    const restored = restoreClinicalDerivedBackupDay(day, section());

    expect(restored.kind).toBe('incomplete');
    if (restored.kind === 'absent') return;
    expect(restored.record.beds.R2).not.toHaveProperty('vitalSignsHistory');
  });
});
