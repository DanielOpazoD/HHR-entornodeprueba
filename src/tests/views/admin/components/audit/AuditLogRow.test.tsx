import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AuditLogRow } from '@/features/admin/components/internal/audit/AuditLogRow';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const movementLog: AuditLogEntry = {
  id: 'audit-row-1',
  timestamp: '2026-05-28T12:34:56.000Z',
  userId: 'dra.riviere@hospital.cl',
  userDisplayName: 'Dra. Riviere',
  userUid: 'uid-123',
  ipAddress: '190.10.10.10',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'Cama 4',
  details: {
    movementKind: 'move',
    patientName: 'Juan Perez',
    sourceBed: '4',
    targetBed: '6',
    changes: {
      bedId: { old: '4', new: '6' },
    },
  },
};

const loginLog: AuditLogEntry = {
  id: 'audit-row-login',
  timestamp: '2026-05-28T13:00:00.000Z',
  userId: 'enfermera.turno@hospital.cl',
  userDisplayName: 'Enfermera Turno',
  userUid: 'uid-login',
  ipAddress: '190.10.10.22',
  action: 'USER_LOGIN',
  entityType: 'user',
  entityId: 'enfermera.turno@hospital.cl',
  details: {},
};

const renderRow = (isExpanded = false) =>
  render(
    <table>
      <tbody>
        <AuditLogRow log={movementLog} isExpanded={isExpanded} onToggle={vi.fn()} />
      </tbody>
    </table>
  );

describe('AuditLogRow', () => {
  it('shows clinical legal traceability in the normal row without raw action codes', () => {
    renderRow();

    expect(screen.getByText('Paciente trasladado de cama')).toBeInTheDocument();
    expect(
      screen.getByText(/Juan Perez fue trasladado desde cama 4 a cama 6/i)
    ).toBeInTheDocument();
    expect(screen.getByText('Dra. Riviere')).toBeInTheDocument();
    expect(screen.getByText('IP 190.10.10.10')).toBeInTheDocument();
    expect(screen.queryByText('PATIENT_MODIFIED')).not.toBeInTheDocument();
    expect(screen.queryByText('movementKind')).not.toBeInTheDocument();
  });

  it('separates clinical summary, origin and advanced technical detail when expanded', () => {
    renderRow(true);

    expect(screen.getByText('Resumen clínico')).toBeInTheDocument();
    expect(screen.getByText('Origen de acceso')).toBeInTheDocument();
    expect(screen.getByText('Cambios relevantes')).toBeInTheDocument();
    expect(screen.getByText('Detalle técnico avanzado')).toBeInTheDocument();
    expect(screen.getByText(/movementKind/)).toBeInTheDocument();
    expect(screen.getByText(/targetBed/)).toBeInTheDocument();
  });

  it('keeps the row toggle behavior', () => {
    const onToggle = vi.fn();
    render(
      <table>
        <tbody>
          <AuditLogRow log={movementLog} isExpanded={false} onToggle={onToggle} />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByText('Paciente trasladado de cama'));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the affected subject for non-patient events', () => {
    render(
      <table>
        <tbody>
          <AuditLogRow log={loginLog} isExpanded={false} onToggle={vi.fn()} />
        </tbody>
      </table>
    );

    expect(screen.getByText('Inicio de sesión')).toBeInTheDocument();
    expect(screen.getAllByText('Enfermera Turno').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('IP 190.10.10.22')).toBeInTheDocument();
  });
});
