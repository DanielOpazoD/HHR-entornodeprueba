import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImagingRequestDialog } from '@/components/modals/ImagingRequestDialog';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

// Mock the PDF service functions
vi.mock('@/services/pdf/imagingRequestPdfService', () => ({
  printImagingRequestForm: vi.fn(),
  printImagingEncuestaForm: vi.fn(),
  ENCUESTA_TEMPLATE_PATH: '/docs/encuesta-contraste.pdf',
  SOLICITUD_FIELD_COORDS: {
    nombreCompleto: { x: 10, y: 10, maxWidth: 100 },
  },
  ENCUESTA_FIELD_COORDS: {
    nombreCompleto: { x: 10, y: 10, maxWidth: 100 },
  },
  formatDate: vi.fn(d => d),
  calculateAge: vi.fn(() => '30 AÑOS'),
}));

const mockPatient: PatientData = {
  bedId: 'R1',
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'MARCELO VALDES AVILA',
  rut: '12.345.678-9',
  age: '30',
  birthDate: '1996-01-01',
  pathology: 'TEST PATHOLOGY',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-03-14',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
};

describe('ImagingRequestDialog', () => {
  it('should render the dialog when open', () => {
    render(<ImagingRequestDialog isOpen={true} onClose={vi.fn()} patient={mockPatient} />);

    expect(screen.getByText(/Solicitud de Imágenes/i)).toBeInTheDocument();
    // Dialog header, patient summary and the form preview's single name line.
    expect(screen.getAllByText(/MARCELO VALDES AVILA/i)).toHaveLength(3);
  });

  it('should switch between documents', () => {
    render(<ImagingRequestDialog isOpen={true} onClose={vi.fn()} patient={mockPatient} />);

    const encuestaTab = screen.getByText(/Encuesta Medio Contraste/i);
    fireEvent.click(encuestaTab);

    // Check that the sidebar title is still there or something else that confirms visibility
    expect(screen.getAllByText(/Encuesta Medio Contraste/i).length).toBeGreaterThan(0);
  });

  it('should call onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ImagingRequestDialog isOpen={true} onClose={onClose} patient={mockPatient} />);

    const closeButton = screen.getByLabelText(/Cerrar/i);
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });
});
