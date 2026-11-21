import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAudit } from '@/hooks/useAudit';
import * as writeAuditUseCase from '@/application/audit/writeAuditEventUseCase';
import { flushPendingAuditEvents } from '@/services/admin/auditPendingEvents';

vi.mock('@/application/audit/writeAuditEventUseCase', () => ({
  executeWriteAuditEvent: vi.fn().mockResolvedValue({
    status: 'success',
    data: null,
    issues: [],
  }),
}));

const writes = () => vi.mocked(writeAuditUseCase.executeWriteAuditEvent).mock.calls;

type AuditHook = { current: ReturnType<typeof useAudit> };

/** The nursing note audit exactly as the handoff screen sends it (30 s bursts). */
const logNurseNote = (
  result: AuditHook,
  bedId: string,
  patientName: string,
  rut: string,
  shift: 'day' | 'night',
  note: string,
  oldNote: string,
  recordDate: string
) =>
  result.current.logDebouncedEvent(
    'NURSE_HANDOFF_MODIFIED',
    'patient',
    bedId,
    {
      patientName,
      shift,
      note,
      changes: {
        [shift === 'day' ? 'handoffNoteDayShift' : 'handoffNoteNightShift']: {
          old: oldNote,
          new: note,
        },
      },
    },
    rut,
    recordDate,
    undefined,
    30_000
  );

const settle = async (milliseconds = 60_000) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await vi.dynamicImportSettled();
};

describe('useAudit handoff loggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the text before the first save and after the last one of a novedades burst', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      result.current.logHandoffNovedadesModified('day', 'Texto 2', 'Texto 1', '2026-03-07', 'A1');
      result.current.logHandoffNovedadesModified('day', 'Texto 3', 'Texto 2', '2026-03-07', 'A1');
    });
    await settle();

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatchObject({
      action: 'HANDOFF_NOVEDADES_MODIFIED',
      entityType: 'dailyRecord',
      entityId: '2026-03-07',
      details: {
        shift: 'day',
        changes: { handoffNovedadesDayShift: { old: 'Texto 1', new: 'Texto 3' } },
      },
      recordDate: '2026-03-07',
      authors: 'A1',
    });
  });

  it('records one nursing note event per editing burst', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 2', 'Nota 1', 'd');
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 3', 'Nota 2', 'd');
    });
    await settle(15_000);
    expect(writes()).toHaveLength(0);
    await settle(15_000);

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatchObject({
      action: 'NURSE_HANDOFF_MODIFIED',
      entityId: 'R1',
      details: {
        patientName: 'Paciente',
        shift: 'day',
        changes: { handoffNoteDayShift: { old: 'Nota 1', new: 'Nota 3' } },
      },
      patientRut: '1-9',
    });
  });

  it('keeps day and night nurse notes apart within one event', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      logNurseNote(result, 'R2', 'Paciente', '2-7', 'day', 'D2', 'D1', 'd');
      logNurseNote(result, 'R2', 'Paciente', '2-7', 'night', 'N2', 'N1', 'd');
    });
    await settle();

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0].details).toMatchObject({
      changes: {
        handoffNoteDayShift: { old: 'D1', new: 'D2' },
        handoffNoteNightShift: { old: 'N1', new: 'N2' },
      },
    });
  });

  it('keeps different patients of one bed apart and records edits that end where they began', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      logNurseNote(result, 'R1', 'Primera', '1-9', 'day', 'B', 'A', 'd');
      logNurseNote(result, 'R1', 'Primera', '1-9', 'day', 'A', 'B', 'd');
      logNurseNote(result, 'R1', 'Segunda', '2-7', 'day', 'Nueva', '', 'd');
    });
    await settle();

    const byPatient = Object.fromEntries(writes().map(([input]) => [input.patientRut, input]));
    expect(Object.keys(byPatient).sort()).toEqual(['1-9', '2-7']);
    expect(byPatient['1-9'].details).toMatchObject({ reverted: ['handoffNoteDayShift'] });
    expect(byPatient['1-9'].details).not.toHaveProperty('changes');
    expect(byPatient['2-7'].details).not.toHaveProperty('reverted');
  });

  it('ignores a save that changed nothing instead of losing the burst', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 2', 'Nota 1', 'd');
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 2', 'Nota 2', 'd');
    });
    await settle();

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0].details).toMatchObject({
      changes: { handoffNoteDayShift: { old: 'Nota 1', new: 'Nota 2' } },
    });
    expect(writes()[0][0].details).not.toHaveProperty('reverted');
  });

  it('never merges two people’s edits: the earlier author’s leave in their own name', async () => {
    const { result, rerender } = renderHook(({ userId }) => useAudit(userId), {
      initialProps: { userId: 'ana@hospital.test' },
    });
    act(() => {
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 2', 'Nota 1', 'd');
    });
    // Ana's session ended without the usual logout; Luis signs in and edits the same note.
    rerender({ userId: 'luis@hospital.test' });
    act(() => {
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 3', 'Nota 2', 'd');
    });
    await settle();

    expect(writes().map(([input]) => [input.userId, input.details.changes])).toEqual([
      ['ana@hospital.test', { handoffNoteDayShift: { old: 'Nota 1', new: 'Nota 2' } }],
      ['luis@hospital.test', { handoffNoteDayShift: { old: 'Nota 2', new: 'Nota 3' } }],
    ]);
  });

  it('writes pending notes immediately when the session ends', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      logNurseNote(result, 'R1', 'Paciente', '1-9', 'day', 'Nota 2', 'Nota 1', 'd');
    });
    await act(async () => {
      await flushPendingAuditEvents();
    });
    await vi.dynamicImportSettled();

    expect(writes()).toHaveLength(1);
    await settle();
    expect(writes()).toHaveLength(1);
  });
});
