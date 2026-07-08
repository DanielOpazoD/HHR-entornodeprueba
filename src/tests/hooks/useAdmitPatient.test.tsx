import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { useAuthMock, executeAdmitPatientMock, defaultPortMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  executeAdmitPatientMock: vi.fn(),
  defaultPortMock: { persistAdmission: vi.fn() },
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

// Resolve the real ANONYMOUS_AUDIT_ACTOR + resolveAuditActor (the global test
// setup mocks this module, which would shadow these named exports otherwise).
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

vi.mock('@/application/daily-record/commands/admitPatientCommand', () => ({
  executeAdmitPatientCommand: executeAdmitPatientMock,
}));

vi.mock('@/services/daily-record/dailyRecordAdmitPatientPort', () => ({
  defaultDailyRecordAdmitPatientPort: defaultPortMock,
}));

import { useAdmitPatient } from '@/hooks/useAdmitPatient';

const baseHookInput = () => ({
  bedId: 'H5C1',
  patientName: 'Paciente Demo',
  rut: '11.111.111-1',
  pathology: 'Dx',
  admissionDate: '2026-05-03',
  recordDate: '2026-05-03',
});

describe('useAdmitPatient', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    executeAdmitPatientMock.mockReset();
  });

  it("forwards the authenticated user's email as the actor to the command", async () => {
    useAuthMock.mockReturnValue({
      currentUser: {
        uid: 'uid-1',
        email: 'doctor@hospital.cl',
        displayName: 'Doctor',
        role: 'doctor_urgency',
      },
    });
    executeAdmitPatientMock.mockResolvedValueOnce({ status: { status: 'ready' } });

    const { result } = renderHook(() => useAdmitPatient());
    await act(async () => {
      await result.current(baseHookInput());
    });

    expect(executeAdmitPatientMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'doctor@hospital.cl', bedId: 'H5C1' }),
      expect.objectContaining({ port: defaultPortMock })
    );
  });

  it('falls back to the anonymous sentinel when no user is authenticated (command will block it)', async () => {
    useAuthMock.mockReturnValue({ currentUser: null });
    executeAdmitPatientMock.mockResolvedValueOnce({ status: { status: 'blocked' } });

    const { result } = renderHook(() => useAdmitPatient());
    await act(async () => {
      await result.current(baseHookInput());
    });

    expect(executeAdmitPatientMock).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'anon' }),
      expect.objectContaining({ port: defaultPortMock })
    );
  });

  it('uses an injected port when provided (test-friendly override)', async () => {
    useAuthMock.mockReturnValue({
      currentUser: { uid: 'uid-1', email: 'nurse@hospital.cl', displayName: 'Nurse' },
    });
    executeAdmitPatientMock.mockResolvedValueOnce({ status: { status: 'ready' } });
    const customPort = { persistAdmission: vi.fn() };

    const { result } = renderHook(() => useAdmitPatient({ port: customPort }));
    await act(async () => {
      await result.current(baseHookInput());
    });

    expect(executeAdmitPatientMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ port: customPort })
    );
  });

  it('returns the command outcome to the caller unchanged', async () => {
    useAuthMock.mockReturnValue({
      currentUser: { uid: 'uid-1', email: 'nurse@hospital.cl', displayName: 'Nurse' },
    });
    const expectedOutcome = {
      status: { status: 'ready' },
      patient: { bedId: 'H5C1' },
      applicationOutcome: { status: 'success' },
    };
    executeAdmitPatientMock.mockResolvedValueOnce(expectedOutcome);

    const { result } = renderHook(() => useAdmitPatient());
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current(baseHookInput());
    });

    expect(outcome).toBe(expectedOutcome);
  });
});
