/**
 * Synthetic-only: a specialist note queued offline is its own sync unit. Real write service,
 * queue engine, transport and server handler; only Firestore, Functions and the role are faked.
 */
import 'fake-indexeddb/auto';
import {
  A,
  B,
  C,
  E,
  T0,
  clone,
  createServerHandler,
  day,
  draftsFor,
  harnessState,
  patient,
  reconnect,
  writeNote,
} from './specialistHandoffOutboxHarness';
import React from 'react';

const h = harnessState();
const OWNER = 'user:synthetic-specialist';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hospitalDB } from '@/services/storage/indexedDBService';
import {
  listRecentSyncQueueOperations,
  queueDailyRecordSyncTaskWithLocalRecord,
} from '@/services/storage/sync';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { HandoffMedicalObservationsCell } from '@/features/handoff/components/HandoffMedicalObservationsCell';
import { MedicalHandoffDraftsPanel } from '@/features/handoff/components/MedicalHandoffDraftsPanel';
import { RayenSyncQueueDetails } from '@/features/rayen-import/components/RayenSyncQueueDetails';
import type { SyncQueueStats } from '@/hooks/useSyncQueueMonitor';
import type { DailyRecord } from '@/types/domain/dailyRecord';

beforeEach(async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', OWNER);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  resetMedicalHandoffDraftMemoryForTests();
  h.handler = createServerHandler();
  h.role = 'admin';
  h.offline = false;
});
afterEach(() => cleanup());

describe('a specialist note is its own sync unit', () => {
  it('lets the day, and a valid note on another bed, sync when one note conflicts', async () => {
    const DATE = '2026-10-24';
    const base = day(DATE, { R4: A(), H1C1: C(), R6: E() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    const first = await writeNote(base, 'R4', 'entry-A', 'Nota de A');
    expect(first.result).toMatchObject({ queuedForRetry: true, updatedRemotely: false });
    const second = await writeNote(first.record, 'H1C1', 'entry-C', 'Nota de C');
    expect(second.result).toMatchObject({ queuedForRetry: true });
    const fixed = {
      ...second.record,
      beds: { ...second.record.beds, R6: E({ pathology: 'Dx E corregido' }) },
    };
    await queueDailyRecordSyncTaskWithLocalRecord(fixed, {
      contexts: ['clinical'],
      origin: 'direct_queue',
      syncContract: { changedPaths: ['beds.R6.pathology'], expectedVersion: T0, mutationId: 'm-E' },
    });

    // Another device discharged A and admitted B, then a third one edited R7.
    h.remote = day(
      DATE,
      {
        R4: B(),
        H1C1: C(),
        R6: E(),
        R7: patient('R7', 'Paciente F Sintético', {
          rut: '55.555.555-5',
          clinicalEpisodeId: 'ep-F',
        }),
      },
      '2026-10-24T11:30:00.000Z'
    );
    await reconnect();

    const remote = h.remote as unknown as DailyRecord;
    expect(remote.beds.R6.pathology).toBe('Dx E corregido');
    expect(remote.beds.H1C1.medicalHandoffEntries?.[0]?.note).toBe('Nota de C');
    expect(remote.beds.R4.patientName).toBe('Paciente B Sintético');
    expect(JSON.stringify(remote.beds.R4)).not.toContain('Nota de A');
    expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R6.pathology).toBe('Dx E corregido');
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'CONFLICT' });
    expect(JSON.stringify(tasks[0].payload)).toContain('Nota de A');
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });

  it('keeps a note refused after the clinical day closed as a dated draft that cannot overwrite another day', async () => {
    const DATE = '2026-10-20';
    h.role = 'doctor_specialist';
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'entry-A', 'Nota antes de las 08:00');
    await reconnect();

    expect(JSON.stringify(h.remote)).not.toContain('Nota antes de las 08:00');
    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'entry-A', 'Nota antes de las 08:00'],
    ]);
    render(<MedicalHandoffDraftsPanel />);
    fireEvent.click(screen.getByText(/Revisar borradores de entrega/));
    expect(screen.getByText('Nota de entrega de Paciente A Sintético · 20-10-2026')).toBeVisible();
    expect(screen.queryByText('Restaurar y guardar borrador')).not.toBeInTheDocument();
  });

  it('restores a refused legacy note into the same patient editor after a bed move, without duplicates', async () => {
    const DATE = '2026-10-24';
    const legacy = A('R4', { medicalHandoffNote: 'Nota previa', medicalHandoffEntries: undefined });
    const base = day(DATE, { R4: legacy });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'legacy-primary', 'Nota nueva de A');
    h.remote = day(DATE, { H2C1: { ...legacy, bedId: 'H2C1' } }, '2026-10-24T11:00:00.000Z');
    await reconnect();

    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'legacy-primary', 'Nota nueva de A'],
    ]);
    const save = vi.fn();
    render(
      <table>
        <tbody>
          <tr>
            <HandoffMedicalObservationsCell
              patient={{ ...legacy, bedId: 'H2C1' }}
              reportDate={DATE}
              isFieldReadOnly={false}
              primaryNoteValue="Nota previa"
              onPrimaryNoteChange={vi.fn()}
              onEntryNoteChange={save}
            />
          </tr>
        </tbody>
      </table>
    );
    fireEvent.click(screen.getByText('Revisar borrador'));
    fireEvent.click(screen.getByText('Restaurar y guardar borrador'));
    expect(save).toHaveBeenCalledWith('legacy-primary', 'Nota nueva de A');
    expect(draftsFor('Paciente A Sintético')).toEqual([
      [DATE, 'legacy-primary', 'Nota nueva de A'],
    ]);
  });

  it('names a refused note in the sync panel and offers a confirmed discard instead of a retry that always fails', async () => {
    const DATE = '2026-10-24';
    const base = day(DATE, { R4: A() });
    await hospitalDB.dailyRecords.put(base);
    h.remote = clone(base);
    await writeNote(base, 'R4', 'entry-A', 'Nota de A');
    h.remote = day(DATE, { R4: B() }, '2026-10-24T11:00:00.000Z');
    await reconnect();

    const operations = await listRecentSyncQueueOperations(20);
    const stats = {
      pending: 0,
      failed: 0,
      conflict: 1,
      retrying: 0,
      readState: 'ok',
    } as SyncQueueStats;
    render(
      <RayenSyncQueueDetails
        stats={stats}
        operations={operations}
        refresh={vi.fn(async () => {})}
        working={false}
      />
    );
    expect(
      screen.getByText('Nota de entrega de Paciente A Sintético · 24-10-2026')
    ).toBeInTheDocument();
    expect(screen.queryByText('Reintentar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Descartar'));
    expect(await hospitalDB.syncQueue.count()).toBe(1);
    fireEvent.click(screen.getByText('Sí, descartar envío'));
    await vi.waitFor(async () => expect(await hospitalDB.syncQueue.count()).toBe(0));
    expect(draftsFor('Paciente A Sintético')).toEqual([[DATE, 'entry-A', 'Nota de A']]);
  });
});
