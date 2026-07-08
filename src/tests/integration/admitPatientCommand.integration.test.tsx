/**
 * End-to-end integration test for the admit-patient command pipeline.
 *
 *   useAdmitPatient (hook)
 *      ↓ derives actor from useAuth()
 *   executeAdmitPatientCommand (application)
 *      ↓ validation + isAnonymousActor guard
 *      ↓ port.persistAdmission
 *   defaultDailyRecordAdmitPatientPort (services/daily-record)
 *      ↓ buildAdmitPatientPatch
 *   updatePartialDetailed (services/repositories) — mocked at the boundary
 *
 * The test mocks the repository write only (the lowest sensible boundary)
 * so every other layer runs the real code path: input validation, anon
 * actor guard, patch shape, audit emission. Without this test the command
 * pilot, port and hook all had unit coverage but nothing exercised the
 * full chain. That is the gap PDF P1-3 named when it asked for "first real
 * consumer of the command layer".
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { updatePartialMock, useAuthMock, executeWriteAuditEventMock } = vi.hoisted(() => ({
  updatePartialMock: vi.fn(),
  useAuthMock: vi.fn(),
  executeWriteAuditEventMock: vi.fn().mockResolvedValue({
    status: 'success',
    data: null,
    issues: [],
  }),
}));

vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  updatePartial: updatePartialMock,
  updatePartialDetailed: updatePartialMock,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/application/audit/writeAuditEventUseCase', async () => {
  const actual = await vi.importActual<typeof import('@/application/audit/writeAuditEventUseCase')>(
    '@/application/audit/writeAuditEventUseCase'
  );
  return {
    ...actual,
    executeWriteAuditEvent: executeWriteAuditEventMock,
  };
});

// Re-expose the real ANONYMOUS_AUDIT_ACTOR / resolveAuditActor to defeat the
// global setup mock that shadows these named exports.
vi.mock('@/context/AuditContext', async () => {
  const actual =
    await vi.importActual<typeof import('@/context/AuditContext')>('@/context/AuditContext');
  return {
    ANONYMOUS_AUDIT_ACTOR: actual.ANONYMOUS_AUDIT_ACTOR,
    resolveAuditActor: actual.resolveAuditActor,
    AuditProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuditContext: () => ({}),
  };
});

import { useAdmitPatient } from '@/hooks/useAdmitPatient';

const baseHookInput = () => ({
  bedId: 'H5C1',
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  pathology: 'Diagnóstico demo',
  admissionDate: '2026-05-03',
  recordDate: '2026-05-03',
});

describe('admitPatientCommand integration (hook → port → repository)', () => {
  beforeEach(() => {
    updatePartialMock.mockReset();
    useAuthMock.mockReset();
    executeWriteAuditEventMock.mockClear();
    executeWriteAuditEventMock.mockResolvedValue({ status: 'success', data: null, issues: [] });
  });

  it('persists the bed-scoped patch with the right paths and emits audit with the auth email', async () => {
    useAuthMock.mockReturnValue({
      currentUser: {
        uid: 'uid-1',
        email: 'nurse@hospital.cl',
        displayName: 'Nurse',
        role: 'nurse_hospital',
      },
    });
    updatePartialMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAdmitPatient());
    let outcome!: Awaited<ReturnType<typeof result.current>>;
    await act(async () => {
      outcome = await result.current(baseHookInput());
    });

    // Repository receives the bed-scoped patch with all admission fields
    expect(updatePartialMock).toHaveBeenCalledTimes(1);
    expect(updatePartialMock).toHaveBeenCalledWith('2026-05-03', {
      'beds.H5C1.patientName': 'Paciente Demo',
      'beds.H5C1.rut': '11.111.111-1',
      'beds.H5C1.admissionDate': '2026-05-03',
      'beds.H5C1.pathology': 'Diagnóstico demo',
      'beds.H5C1.clinicalEpisodeId': expect.stringMatching(/^ep_/),
    });

    // Audit emitted with the authenticated email as actor
    expect(executeWriteAuditEventMock).toHaveBeenCalledTimes(1);
    expect(executeWriteAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'nurse@hospital.cl',
        action: 'PATIENT_ADMITTED',
        entityType: 'patient',
        entityId: 'H5C1',
        patientRut: '11.111.111-1',
        recordDate: '2026-05-03',
      })
    );

    // Outcome is ready
    expect(outcome.status.status).toBe('ready');
    expect(outcome.applicationOutcome.status).toBe('success');
    expect(outcome.patient).toMatchObject({
      bedId: 'H5C1',
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
    });
  });

  it('blocks the admission when no user is authenticated, never touching repository or audit', async () => {
    useAuthMock.mockReturnValue({ currentUser: null });

    const { result } = renderHook(() => useAdmitPatient());
    let outcome!: Awaited<ReturnType<typeof result.current>>;
    await act(async () => {
      outcome = await result.current(baseHookInput());
    });

    expect(updatePartialMock).not.toHaveBeenCalled();
    expect(executeWriteAuditEventMock).not.toHaveBeenCalled();
    expect(outcome.status.status).toBe('blocked');
    expect(outcome.applicationOutcome.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.kind).toBe('permission');
  });

  it('reports failed when repository.updatePartial throws and never emits audit', async () => {
    useAuthMock.mockReturnValue({
      currentUser: { uid: 'uid-1', email: 'doctor@hospital.cl', displayName: 'Doctor' },
    });
    updatePartialMock.mockRejectedValueOnce(new Error('Firestore offline'));

    const { result } = renderHook(() => useAdmitPatient());
    let outcome!: Awaited<ReturnType<typeof result.current>>;
    await act(async () => {
      outcome = await result.current(baseHookInput());
    });

    expect(updatePartialMock).toHaveBeenCalledTimes(1);
    expect(executeWriteAuditEventMock).not.toHaveBeenCalled();
    expect(outcome.status.status).toBe('failed');
    expect(outcome.applicationOutcome.issues[0]?.message).toBe('Firestore offline');
  });

  it('reports degraded when persistence succeeds but audit is rejected by the policy', async () => {
    useAuthMock.mockReturnValue({
      currentUser: { uid: 'uid-1', email: 'doctor@hospital.cl', displayName: 'Doctor' },
    });
    updatePartialMock.mockResolvedValueOnce(undefined);
    executeWriteAuditEventMock.mockResolvedValueOnce({
      status: 'failed',
      data: null,
      issues: [{ kind: 'permission', message: 'Audit rejected by policy' }],
    });

    const { result } = renderHook(() => useAdmitPatient());
    let outcome!: Awaited<ReturnType<typeof result.current>>;
    await act(async () => {
      outcome = await result.current(baseHookInput());
    });

    expect(updatePartialMock).toHaveBeenCalledTimes(1);
    expect(executeWriteAuditEventMock).toHaveBeenCalledTimes(1);
    expect(outcome.status.status).toBe('degraded');
    expect(outcome.applicationOutcome.status).toBe('degraded');
    expect(outcome.applicationOutcome.userSafeMessage).toMatch(/auditoría/i);
    // The patient is still considered persisted — the database is the
    // source of truth, the audit miss is recoverable.
    expect(outcome.patient).not.toBeNull();
  });

  it('omits pathology from the patch when it is undefined (does not write empty)', async () => {
    useAuthMock.mockReturnValue({
      currentUser: { uid: 'uid-1', email: 'nurse@hospital.cl', displayName: 'Nurse' },
    });
    updatePartialMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useAdmitPatient());
    await act(async () => {
      await result.current({ ...baseHookInput(), pathology: undefined });
    });

    expect(updatePartialMock).toHaveBeenCalledTimes(1);
    const [, patch] = updatePartialMock.mock.calls[0];
    expect(patch).toEqual({
      'beds.H5C1.patientName': 'Paciente Demo',
      'beds.H5C1.rut': '11.111.111-1',
      'beds.H5C1.admissionDate': '2026-05-03',
      'beds.H5C1.clinicalEpisodeId': expect.stringMatching(/^ep_/),
    });
    expect(Object.keys(patch)).not.toContain('beds.H5C1.pathology');
  });
});
