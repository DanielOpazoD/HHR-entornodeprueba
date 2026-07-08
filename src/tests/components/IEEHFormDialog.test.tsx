import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IEEHFormDialog } from '../../features/census/components/IEEHFormDialog';
import { printIEEHForm } from '@/services/pdf/ieehPdfService';
import type { PatientData } from '../../types/domain/patient';
import { PatientStatus, Specialty } from '../../types/domain/patientClassification';
import type { DischargeFormData } from '@/services/pdf/ieehPdfService';

const { mockBrowserOpen } = vi.hoisted(() => ({
  mockBrowserOpen: vi.fn(() => null),
}));

// Mock services
vi.mock('@/services/pdf/ieehPdfService', () => ({
  printIEEHForm: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntimeCore', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime({
      open: mockBrowserOpen,
    }),
  };
});

vi.mock('../../services/terminology/terminologyService', () => ({
  searchDiagnoses: vi.fn().mockResolvedValue([]),
  forceAISearch: vi.fn().mockResolvedValue([]),
}));

describe('IEEHFormDialog Component', () => {
  const mockPatient: PatientData = {
    bedId: '1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: 'JUAN PEREZ',
    rut: '12345678-9',
    age: '30',
    pathology: 'DIAGNOSTICO BASE',
    cie10Code: 'A00',
    cie10Description: 'DESC CIE10 BASE',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '01-01-2024',
    admissionTime: '10:00',
    insurance: 'Fonasa',
    admissionOrigin: 'Urgencias',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
  };

  const baseDischargeData: DischargeFormData = {
    dischargeDate: '02-01-2024',
    dischargeTime: '11:00',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with initial data from patient', () => {
    render(
      <IEEHFormDialog
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        baseDischargeData={baseDischargeData}
      />
    );

    expect(screen.getByPlaceholderText(/Escriba el diagnóstico/i)).toHaveValue('DESC CIE10 BASE');
    expect(screen.getByDisplayValue('A00')).toHaveValue('A00');
  });

  it('updates surgery description when selecting "Sí"', async () => {
    render(
      <IEEHFormDialog
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        baseDischargeData={baseDischargeData}
      />
    );

    const siRadio = screen.getAllByRole('radio')[0];
    fireEvent.click(siRadio);

    const descInput = screen.getByPlaceholderText(/Descripción de la intervención quirúrgica/i);
    fireEvent.change(descInput, { target: { value: 'APENDICECTOMIA' } });
    expect(descInput).toHaveValue('APENDICECTOMIA');
  });

  it('calls printIEEHForm when clicking "Imprimir documento"', async () => {
    render(
      <IEEHFormDialog
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        baseDischargeData={baseDischargeData}
      />
    );

    fireEvent.click(screen.getByText(/Imprimir documento/i));

    await waitFor(() => {
      expect(printIEEHForm).toHaveBeenCalled();
    });
    expect(mockBrowserOpen).toHaveBeenCalledWith('', '_blank');
  });

  it('sends "No" defaults for cirugía y procedimiento sin interacción previa', async () => {
    render(
      <IEEHFormDialog
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        baseDischargeData={baseDischargeData}
      />
    );

    fireEvent.click(screen.getByText(/Imprimir documento/i));

    await waitFor(() => {
      expect(printIEEHForm).toHaveBeenCalled();
    });

    const firstCall = vi.mocked(printIEEHForm).mock.calls[0];
    expect(firstCall?.[1]).toEqual(
      expect.objectContaining({
        intervencionQuirurgica: '2',
        procedimiento: '2',
      })
    );
  });

  it('uses a single blue focus treatment for the treating doctor inputs', () => {
    render(
      <IEEHFormDialog
        isOpen={true}
        onClose={vi.fn()}
        patient={mockPatient}
        baseDischargeData={baseDischargeData}
      />
    );

    const doctorNameInput = screen.getByPlaceholderText('Nombre');

    expect(doctorNameInput).toHaveClass(
      'outline-none',
      'focus:outline-none',
      'border-slate-200',
      'focus:ring-1',
      'focus:ring-blue-500/20',
      'focus:border-blue-400'
    );
    expect(doctorNameInput.className).not.toContain('rose-500');
  });
});
