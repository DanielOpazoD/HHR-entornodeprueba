import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PatientAuditPackageRow } from '@/features/admin/components/internal/audit/PatientAuditPackageRow';
import { buildClinicalAuditPatientPackages } from '@/services/admin/clinicalAuditPatientPackages';
import type { AuditLogEntry } from '@/types/auditLogTypes';

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-1',
  timestamp: '2026-07-01T19:36:29.000Z',
  userId: 'daniel.opazo@hospitalhangaroa.cl',
  userDisplayName: 'Daniel Opazo Damiani',
  userUid: 'uid-123',
  ipAddress: '148.227.67.162',
  action: 'PATIENT_MODIFIED',
  entityType: 'patient',
  entityId: 'H4C1',
  recordDate: '2026-07-01',
  patientIdentifier: '25DF52626',
  details: {
    patientName: 'Anastasio Hey Riroroko',
    rut: '25DF52626',
    bedId: 'H4C1',
  },
  ...overrides,
});

const packageFixture = buildClinicalAuditPatientPackages([
  baseLog({
    id: 'status-1',
    details: {
      patientName: 'Anastasio Hey Riroroko',
      rut: '25DF52626',
      bedId: 'H4C1',
      changes: { status: { old: '', new: 'Estable' } },
    },
  }),
  baseLog({
    id: 'diagnosis-1',
    timestamp: '2026-07-01T19:36:54.000Z',
    action: 'PATIENT_DIAGNOSIS_CHANGED',
    details: {
      patientName: 'Anastasio Hey Riroroko',
      rut: '25DF52626',
      bedId: 'H4C1',
      changes: { diagnosis: { old: '', new: 'ICC' } },
    },
  }),
])[0];

const longNovedadesBaseline =
  'Mantener orden de ficha clínica al momento de que paciente se vaya de alta, SIEMPRE debe ser supervisado por Enfermero. Puerta de vía de evacuación en mal estado.';

const longNovedadesFinal =
  'Mantener orden de ficha clínica al momento de que paciente se vaya de alta, SIEMPRE debe ser supervisado por Enfermero. Puerta de vía de evacuación en mal estado. Viernes 03 de julio a las 15:00 horas, se realizarán pruebas técnicas en los botones de pánico del Hospital.';

const novedadesPackageFixture = buildClinicalAuditPatientPackages([
  baseLog({
    id: 'novedades-1',
    action: 'HANDOFF_NOVEDADES_MODIFIED',
    details: {
      patientName: 'Paciente Novedades',
      rut: '25DF52626',
      bedId: 'H4C1',
      changes: {
        novedades: {
          old: '-',
          new: longNovedadesBaseline,
        },
      },
    },
  }),
  baseLog({
    id: 'novedades-2',
    action: 'HANDOFF_NOVEDADES_MODIFIED',
    timestamp: '2026-07-01T19:38:29.000Z',
    details: {
      patientName: 'Paciente Novedades',
      rut: '25DF52626',
      bedId: 'H4C1',
      changes: {
        novedades: {
          old: longNovedadesBaseline,
          new: longNovedadesFinal,
        },
      },
    },
  }),
])[0];

const renderRow = (isExpanded = false, onToggle = vi.fn(), auditPackage = packageFixture) =>
  render(
    <table>
      <tbody>
        <PatientAuditPackageRow
          auditPackage={auditPackage}
          isExpanded={isExpanded}
          onToggle={onToggle}
          compactView={false}
        />
      </tbody>
    </table>
  );

describe('PatientAuditPackageRow', () => {
  it('shows the patient-centered clinical changes without opening raw details', () => {
    renderRow();

    expect(screen.getByText('Anastasio Hey Riroroko')).toBeInTheDocument();
    expect(screen.getByText('25DF52626')).toBeInTheDocument();
    expect(screen.getByText('H4C1')).toBeInTheDocument();
    expect(screen.getByText('2 eventos')).toBeInTheDocument();
    expect(screen.getAllByText('Estado').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Estable')).toBeInTheDocument();
    expect(screen.getAllByText('Diagnóstico').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ICC')).toBeInTheDocument();
    expect(screen.getByText('Daniel Opazo Damiani')).toBeInTheDocument();
    expect(screen.getByText('IP 148.227.67.162')).toBeInTheDocument();
    expect(
      screen.getByText(/Daniel Opazo Damiani cambió Diagnóstico de - a ICC en cama H4C1/i)
    ).toBeInTheDocument();
    expect(screen.queryByText('PATIENT_DIAGNOSIS_CHANGED')).not.toBeInTheDocument();
  });

  it('condenses repeated long text changes without duplicating the visible evidence', () => {
    renderRow(false, vi.fn(), novedadesPackageFixture);

    expect(
      screen.getByText(/Daniel Opazo Damiani actualizó Novedades en cama H4C1/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/2 eventos integrados/i)).toBeInTheDocument();
    expect(screen.getByText(/2 cambios integrados/i)).toBeInTheDocument();
    expect(screen.queryByText(longNovedadesFinal)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Mantener orden de ficha clínica al momento/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Agregado:/i)).toBeInTheDocument();
    expect(screen.getByText(/Viernes 03 de julio/i)).toBeInTheDocument();
  });

  it('keeps raw audit events available only after expansion', () => {
    renderRow(true);

    expect(screen.getByText('Cambios relevantes integrados')).toBeInTheDocument();
    expect(screen.queryByText('Diagnóstico actualizado')).not.toBeInTheDocument();
    expect(screen.queryByText(/PATIENT_DIAGNOSIS_CHANGED/)).not.toBeInTheDocument();

    const includedEventsButton = screen.getByRole('button', { name: /ver eventos incluidos/i });
    expect(
      document.getElementById(includedEventsButton.getAttribute('aria-controls') || '')
    ).toBeInTheDocument();

    fireEvent.click(includedEventsButton);

    expect(screen.getByText('Eventos clínicos y administrativos')).toBeInTheDocument();
    expect(screen.getByText('Diagnóstico actualizado')).toBeInTheDocument();
    expect(screen.queryByText(/PATIENT_DIAGNOSIS_CHANGED/)).not.toBeInTheDocument();

    const technicalPayloadButton = screen.getByRole('button', { name: /ver payload técnico/i });
    expect(
      document.getElementById(technicalPayloadButton.getAttribute('aria-controls') || '')
    ).toBeInTheDocument();

    fireEvent.click(technicalPayloadButton);

    expect(screen.getByText('Detalle técnico avanzado')).toBeInTheDocument();
    expect(screen.getByText(/PATIENT_DIAGNOSIS_CHANGED/)).toBeInTheDocument();
  });

  it('keeps expansion on a single explicit button target', () => {
    const onToggle = vi.fn();
    renderRow(false, onToggle);
    const expandButton = screen.getByRole('button', {
      name: /abrir detalle de auditoría de anastasio hey riroroko/i,
    });
    const controlledRow = document.getElementById(expandButton.getAttribute('aria-controls') || '');
    const parentRow = expandButton.closest('tr');

    expect(parentRow).not.toHaveAttribute('aria-expanded');
    expect(parentRow).not.toHaveAttribute('tabindex');
    expect(controlledRow).toBeInTheDocument();

    fireEvent.click(expandButton);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('exposes an accessible expand control with keyboard support', () => {
    const onToggle = vi.fn();
    renderRow(false, onToggle);

    const expandButton = screen.getByRole('button', {
      name: /abrir detalle de auditoría de anastasio hey riroroko/i,
    });

    expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(expandButton, { key: 'Enter' });
    fireEvent.keyDown(expandButton, { key: ' ' });

    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('can copy a concise patient-centered summary from the expanded row', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderRow(true);

    fireEvent.click(screen.getByRole('button', { name: /copiar resumen/i }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Anastasio Hey Riroroko'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Estado'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Diagnóstico'));
  });
});
