import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { queueSyncTask, queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { DataFactory } from '@/tests/factories/DataFactory';

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  await hospitalDB.syncQueue.clear();
});
afterEach(async () => {
  await hospitalDB.syncQueue.clear();
});
describe('queued note survives a replacement census on the device', () => {
  it.each(['standalone', 'atomic'] as const)(
    '%s enqueue keeps the original pending payload on turnover',
    async mode => {
      const a = DataFactory.createMockDailyRecord('2026-10-24', {
        beds: {
          R4: DataFactory.createMockPatient('R4', {
            patientName: 'Paciente A Sintético',
            rut: '99.999.999-9',
            clinicalEpisodeId: 'ep-A',
            medicalHandoffNote: 'Nota pendiente para A',
          }),
        },
      });
      const meta = { syncContract: { changedPaths: ['beds.R4.medicalHandoffNote'] } };
      const enqueue = (record: typeof a) =>
        mode === 'atomic'
          ? queueDailyRecordSyncTaskWithLocalRecord(record, meta)
          : queueSyncTask('UPDATE_DAILY_RECORD', record, meta);
      await expect(enqueue(a)).resolves.toMatchObject({ accepted: true });
      const [original] = await hospitalDB.syncQueue.toArray();
      const b = {
        ...a,
        beds: {
          R4: {
            ...a.beds.R4,
            patientName: 'Paciente B Sintético',
            clinicalEpisodeId: 'ep-B',
            medicalHandoffNote: 'Nota de B',
          },
        },
      };
      await expect(enqueue(b)).resolves.toMatchObject({ accepted: false, mode: 'enqueue_failed' });
      const remaining = await hospitalDB.syncQueue.toArray();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(original.id);
      expect(remaining[0].payload).toMatchObject({
        beds: { R4: { clinicalEpisodeId: 'ep-A', medicalHandoffNote: 'Nota pendiente para A' } },
      });
    }
  );
});
