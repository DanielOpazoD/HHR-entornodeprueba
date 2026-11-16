/**
 * Synthetic-only: a day written while the old medical handoff existed keeps its fields after the
 * handoff's queue and save path were retired. Reading it, merging a census edit over another
 * session's write, and exporting then importing a backup all leave the signature, the specialty
 * notes and the bed's entries exactly as stored. Nothing reads them, and nothing deletes them.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { A, E, clone, reconnect } from './dayRecordOutboxHarness';
import {
  B_AT,
  DATE,
  local,
  queue,
  readStored,
  remote,
  remoteWrite,
  resetDay,
  writeDay,
} from './dayRecordDaySupport';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { syncWithFirestoreDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { exportDataJSONWithResult } from '@/services/exporters/exportService';
import { importDataJSONDetailed } from '@/services/exporters/exportImportJson';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const download = vi.hoisted(() => ({ blob: null as Blob | null }));
vi.mock('@/services/exporters/exportDownload', () => ({
  downloadBlob: (blob: Blob) => {
    download.blob = blob;
  },
}));

const OWNER = 'user:synthetic-retired-fields';
const signedA = (extra: Partial<PatientData> = {}) =>
  A('R4', {
    medicalHandoffNote: 'Nota médica antigua',
    medicalHandoffEntries: [
      { id: 'entry-A', specialty: 'Medicina Interna', note: 'Nota médica antigua' },
    ],
    ...extra,
  });
const OLD_DAY_FIELDS = {
  medicalSignature: { doctorName: 'Dra. Sintética', signedAt: '2026-10-24T09:00:00.000Z' },
  medicalHandoffBySpecialty: {
    'Medicina Interna': {
      note: 'Entrega antigua de especialidad',
      createdAt: '2026-10-24T08:00:00.000Z',
      updatedAt: '2026-10-24T08:30:00.000Z',
      author: {
        uid: 'synthetic-doctor',
        displayName: 'Dra. Sintética',
        email: 'dra@example.invalid',
      },
      version: 2,
    },
  },
  medicalHandoffNovedades: 'Novedades médicas antiguas',
};
/** What the old medical handoff left on the day. */
const medicalFields = (record: DailyRecord | null | undefined) => {
  const day = record as (DailyRecord & Record<string, unknown>) | null | undefined;
  return {
    medicalSignature: day?.medicalSignature,
    medicalHandoffBySpecialty: day?.medicalHandoffBySpecialty,
    medicalHandoffNovedades: day?.medicalHandoffNovedades,
    note: day?.beds.R4.medicalHandoffNote,
    entries: day?.beds.R4.medicalHandoffEntries,
  };
};
const EXPECTED = {
  ...OLD_DAY_FIELDS,
  note: 'Nota médica antigua',
  entries: [{ id: 'entry-A', specialty: 'Medicina Interna', note: 'Nota médica antigua' }],
};
const withOldFields = (record: DailyRecord): DailyRecord =>
  ({ ...record, ...clone(OLD_DAY_FIELDS) }) as DailyRecord;

beforeEach(async () => {
  await resetDay(OWNER);
  download.blob = null;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('keeps the fields when the day is read from the server', async () => {
  await readStored({ R4: signedA(), R6: E() });
  // The server's day also carries the old day-level fields.
  const server = withOldFields(remote());
  remoteWrite(server.beds, '2026-10-24T11:00:00.000Z');
  Object.assign(remote(), clone(OLD_DAY_FIELDS));
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

  const result = await syncWithFirestoreDetailed(DATE);

  expect(medicalFields(result?.record)).toEqual(EXPECTED);
  expect(medicalFields(await local())).toEqual(EXPECTED);
});

it('keeps the fields when a census edit merges over another session write', async () => {
  const read = await readStored({ R4: signedA(), R6: E() });
  await hospitalDB.dailyRecords.put(withOldFields(read));
  Object.assign(remote(), clone(OLD_DAY_FIELDS));
  await writeDay({ 'beds.R6.pathology': 'Dx E corregido' });
  // Another session edits another field; the server keeps the old fields as they were.
  remoteWrite({ R4: signedA({ pathology: 'Dx A otro equipo' }), R6: E() }, B_AT);
  Object.assign(remote(), clone(OLD_DAY_FIELDS));

  await reconnect();

  expect(remote().beds.R6.pathology).toBe('Dx E corregido');
  expect(remote().beds.R4.pathology).toBe('Dx A otro equipo');
  expect(medicalFields(remote())).toEqual(EXPECTED);
  expect(medicalFields(await local())).toEqual(EXPECTED);
  expect(await queue()).toEqual([]);
});

it('keeps the fields through a backup export and import', async () => {
  const read = await readStored({ R4: signedA(), R6: E() });
  await hospitalDB.dailyRecords.put(withOldFields(read));

  expect((await exportDataJSONWithResult()).status).toBe('success');
  const text = await new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(download.blob!);
  });
  const exported = JSON.parse(text) as Record<string, DailyRecord>;
  expect(medicalFields(exported[DATE])).toEqual(EXPECTED);

  await hospitalDB.dailyRecords.clear();
  const file = new File([JSON.stringify(exported)], 'respaldo-sintetico.json', {
    type: 'application/json',
  });
  expect(await importDataJSONDetailed(file)).toMatchObject({ success: true, importedCount: 1 });

  expect(medicalFields(await local())).toEqual(EXPECTED);
  const [restore] = await queue();
  expect(restore).toMatchObject({ origin: 'backup_restore' });
  expect(medicalFields(restore.payload as DailyRecord)).toEqual(EXPECTED);
});
