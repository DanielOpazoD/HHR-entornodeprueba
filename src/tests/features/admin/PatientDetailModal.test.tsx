import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PatientDetailModal } from '@/features/admin/components/internal/PatientDetailModal';
import type { MasterPatient } from '@/types/domain/patientMaster';

const patient: MasterPatient = {
  rut: '11.111.111-1',
  fullName: 'Paciente Sintética con Nombre Muy Largo de Prueba',
  forecast: 'FONASA B',
  gender: 'Femenino',
  vitalStatus: 'Vivo',
  createdAt: 0,
  updatedAt: 0,
  hospitalizations: [
    { id: 'e1', type: 'Ingreso', date: '2026-11-01', diagnosis: 'Diagnóstico sintético' },
    { id: 'e2', type: 'Egreso', date: '2026-11-05', diagnosis: 'Alta sintética', bedName: 'R1' },
  ],
};

const OpenerHarness = () => {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ver ficha
      </button>
      {open && <PatientDetailModal patient={patient} onClose={() => setOpen(false)} />}
    </>
  );
};

const openFromTrigger = () => {
  render(<OpenerHarness />);
  const trigger = screen.getByRole('button', { name: 'Ver ficha' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

describe('PatientDetailModal', () => {
  it('is announced as a modal dialog named by the patient and takes focus', () => {
    openFromTrigger();

    const dialog = screen.getByRole('dialog', { name: patient.fullName });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('closes with Escape and gives focus back to the trigger', () => {
    const trigger = openFromTrigger();

    screen.getByRole('button', { name: 'Cerrar' }).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(screen.queryByText(patient.fullName)).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('gives focus back to the trigger when closed from a button', () => {
    const trigger = openFromTrigger();

    const footer = screen.getByRole('button', { name: 'Cerrar Explorer' });
    footer.focus();
    fireEvent.click(footer);

    expect(screen.queryByText(patient.fullName)).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('names the patient in the header heading with identity and event count', () => {
    render(<PatientDetailModal patient={patient} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 2, name: patient.fullName })).toBeInTheDocument();
    expect(screen.getByText('11.111.111-1')).toBeInTheDocument();
    expect(screen.getByText(/2 Eventos/)).toBeInTheDocument();
    expect(screen.getByText('Ingreso')).toBeInTheDocument();
    expect(screen.getByText('Egreso')).toBeInTheDocument();
  });

  it('closes from the header icon button, whose icon is hidden from assistive technology', () => {
    const onClose = vi.fn();
    render(<PatientDetailModal patient={patient} onClose={onClose} />);

    const close = screen.getByRole('button', { name: 'Cerrar' });
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the footer button', () => {
    const onClose = vi.fn();
    render(<PatientDetailModal patient={patient} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar Explorer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
