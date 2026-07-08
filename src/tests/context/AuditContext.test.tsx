import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

vi.unmock('@/context/AuditContext');

const { useAuditMock, useAuthMock } = vi.hoisted(() => ({
  useAuditMock: vi.fn(() => ({
    logEvent: vi.fn(),
    logDebouncedEvent: vi.fn(),
    fetchLogs: vi.fn(),
    getActionLabel: vi.fn(),
  })),
  useAuthMock: vi.fn(),
}));

vi.mock('@/hooks/useAudit', () => ({
  useAudit: useAuditMock,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

import {
  ANONYMOUS_AUDIT_ACTOR,
  AuditProvider,
  resolveAuditActor,
  useAuditContext,
} from '@/context/AuditContext';
import type { AuthUser } from '@/types/authRoleTypes';

describe('resolveAuditActor', () => {
  it('returns the anonymous marker when there is no current user', () => {
    expect(resolveAuditActor(null)).toBe(ANONYMOUS_AUDIT_ACTOR);
  });

  it('prefers the authenticated email when available', () => {
    const user: AuthUser = {
      uid: 'uid-123',
      email: 'nurse@hospital.cl',
      displayName: 'Nurse',
      role: 'nurse_hospital',
    };
    expect(resolveAuditActor(user)).toBe('nurse@hospital.cl');
  });

  it('falls back to the uid when email is missing', () => {
    const user: AuthUser = {
      uid: 'uid-123',
      email: null,
      displayName: 'Nurse',
    };
    expect(resolveAuditActor(user)).toBe('uid-123');
  });

  it('falls back to the anonymous marker when both email and uid are missing', () => {
    const user = { uid: '', email: null, displayName: null } as AuthUser;
    expect(resolveAuditActor(user)).toBe(ANONYMOUS_AUDIT_ACTOR);
  });
});

describe('AuditProvider actor wiring', () => {
  beforeEach(() => {
    useAuditMock.mockClear();
    useAuthMock.mockReset();
  });

  const Probe = () => {
    const { userId } = useAuditContext();
    return <span data-testid="audit-actor">{userId}</span>;
  };

  it('passes the resolved authenticated email to useAudit and exposes it on the context', () => {
    useAuthMock.mockReturnValue({
      currentUser: {
        uid: 'uid-1',
        email: 'doctor@hospital.cl',
        displayName: 'Doctor',
        role: 'doctor_urgency',
      },
    });

    const { getByTestId } = render(
      <AuditProvider>
        <Probe />
      </AuditProvider>
    );

    expect(useAuditMock).toHaveBeenCalledWith('doctor@hospital.cl');
    expect(getByTestId('audit-actor').textContent).toBe('doctor@hospital.cl');
  });

  it('falls back to the anonymous marker when no user is authenticated', () => {
    useAuthMock.mockReturnValue({ currentUser: null });

    const { getByTestId } = render(
      <AuditProvider>
        <Probe />
      </AuditProvider>
    );

    expect(useAuditMock).toHaveBeenCalledWith(ANONYMOUS_AUDIT_ACTOR);
    expect(getByTestId('audit-actor').textContent).toBe(ANONYMOUS_AUDIT_ACTOR);
  });
});
