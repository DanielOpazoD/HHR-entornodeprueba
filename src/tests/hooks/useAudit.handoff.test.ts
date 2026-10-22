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

  it('records one medical handoff event per editing burst', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      result.current.logMedicalHandoffModified('R1', 'Paciente', '1-9', 'Nota 2', 'Nota 1', 'd');
      result.current.logMedicalHandoffModified('R1', 'Paciente', '1-9', 'Nota 3', 'Nota 2', 'd');
    });
    await settle(30_000);
    expect(writes()).toHaveLength(0);
    await settle(30_000);

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatchObject({
      action: 'MEDICAL_HANDOFF_MODIFIED',
      entityId: 'R1',
      details: {
        patientName: 'Paciente',
        bedId: 'R1',
        rut: '1-9',
        changes: { medicalHandoffNote: { old: 'Nota 1', new: 'Nota 3' } },
      },
      patientRut: '1-9',
    });
  });

  it('keeps day and night nurse notes apart within one event', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      result.current.logNurseHandoffModified('R2', 'Paciente', '2-7', 'day', 'D2', 'D1', 'd');
      result.current.logNurseHandoffModified('R2', 'Paciente', '2-7', 'night', 'N2', 'N1', 'd');
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

  it('keeps different patients of one bed apart and drops edits that cancel out', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      result.current.logMedicalHandoffModified('R1', 'Primera', '1-9', 'B', 'A', 'd');
      result.current.logMedicalHandoffModified('R1', 'Primera', '1-9', 'A', 'B', 'd');
      result.current.logMedicalHandoffModified('R1', 'Segunda', '2-7', 'Nueva', '', 'd');
    });
    await settle();

    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toMatchObject({ patientRut: '2-7' });
  });

  it('writes pending notes immediately when the session ends', async () => {
    const { result } = renderHook(() => useAudit('test-user-123'));

    act(() => {
      result.current.logMedicalHandoffModified('R1', 'Paciente', '1-9', 'Nota 2', 'Nota 1', 'd');
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
