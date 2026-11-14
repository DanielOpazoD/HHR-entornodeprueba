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

describe('PatientDetailModal', () => {
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
