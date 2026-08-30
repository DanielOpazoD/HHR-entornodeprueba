import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { createPortal } from 'react-dom';
import { PatientRow } from '@/features/census/components/PatientRow';
import { BedType } from '@/types/domain/beds';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import { render } from '../integration/setup';
import { DataFactory } from '../factories/DataFactory';

const { mockAlert, mockConfirm } = vi.hoisted(() => ({
  mockAlert: vi.fn().mockResolvedValue(true),
  mockConfirm: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/context/UIContext', async () => {
  const actual = await vi.importActual('@/context/UIContext');
  return {
    ...actual,
    useConfirmDialog: () => ({
      confirm: mockConfirm,
      alert: mockAlert,
    }),
  };
});

vi.mock('@/components/modals/DemographicsModal', () => ({
  DemographicsModal: ({
    isOpen,
    onSave,
  }: {
    isOpen: boolean;
    onSave: (payload: Record<string, unknown>) => void;
  }) => {
    if (!isOpen) {
      return null;
    }

    return createPortal(
      <div>
        <div>Datos Demográficos</div>
        <button onClick={() => onSave({ patientName: 'Paciente Actualizado' })}>
          Guardar Cambios
        </button>
      </div>,
      document.body
    );
  },
}));

describe('PatientRow crib and demographics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockPatient = DataFactory.createMockPatient('R1', {
    patientName: 'Juan Pérez',
    rut: '12.345.678-9',
    age: '45',
    pathology: 'Neumonía',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '2023-01-01',
    devices: ['VVP#1'],
  });

  const mockBedDef = {
    id: 'R1',
    name: 'R1',
    type: BedType.UTI,
    isCuna: false,
  };

  const mockOnAction = vi.fn();

  it('does not expose the retired primary-bed Cuna RN mode', () => {
    render(
      <table>
        <tbody>
          <PatientRow
            data={mockPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Configuración de cama'));
    expect(screen.queryByText(/Cambiar a Cuna RN/i)).not.toBeInTheDocument();
  });

  it('does not offer the retired RN Sano classification', () => {
    render(
      <table>
        <tbody>
          <PatientRow
            data={mockPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Configuración de cama'));
    expect(screen.queryByText(/^RN Sano$/i)).not.toBeInTheDocument();
  });

  it('adds the associated crib when the Cuna button is clicked', () => {
    const { mockContext } = render(
      <table>
        <tbody>
          <PatientRow
            data={mockPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Configuración de cama'));
    fireEvent.click(screen.getByText(/^Agregar Cuna$/i));

    expect(mockContext.updateClinicalCrib).toHaveBeenCalledWith('R1', 'create');
  });

  it('closes bed config menu on outside click', () => {
    render(
      <table>
        <tbody>
          <PatientRow
            data={mockPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Configuración de cama'));
    expect(screen.getByText(/^Agregar Cuna$/i)).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText(/^Agregar Cuna$/i)).not.toBeInTheDocument();
  });

  it('opens demographics modal and saves changes', async () => {
    const { mockContext } = render(
      <table>
        <tbody>
          <PatientRow
            data={mockPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Datos del Paciente'));
    fireEvent.click(await screen.findByText(/Guardar Cambios/i, {}, { timeout: 10000 }));

    expect(mockContext.updatePatientMultiple).toHaveBeenCalledWith('R1', expect.any(Object));
  });

  it('removes clinical crib if it already exists', () => {
    const dataWithCrib = {
      ...mockPatient,
      clinicalCrib: DataFactory.createMockPatient('R1-C', {
        patientName: 'Baby',
        bedMode: 'Cuna',
      }),
    };

    const { mockContext } = render(
      <table>
        <tbody>
          <PatientRow
            data={dataWithCrib}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Configuración de cama'));
    fireEvent.click(screen.getByTitle('Eliminar Cuna'));

    expect(mockContext.updateClinicalCrib).toHaveBeenCalledWith('R1', 'remove');
  });

  it('does not expose the retired companion-crib action in Cuna mode', () => {
    const cunaPatient = { ...mockPatient, bedMode: 'Cuna' as const };

    const { mockContext } = render(
      <table>
        <tbody>
          <PatientRow
            data={cunaPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Configuración de cama'));
    expect(screen.queryByText(/^RN Sano$/i)).not.toBeInTheDocument();
    expect(mockContext.updatePatient).not.toHaveBeenCalledWith('R1', 'hasCompanionCrib', true);
  });

  it('allows UPC on clinical crib when the parent bed is UPC-eligible', () => {
    const clinicalCrib = DataFactory.createMockPatient('R1', {
      patientName: 'RN UPC',
      bedMode: 'Cuna',
    });

    render(
      <table>
        <tbody>
          <PatientRow
            data={clinicalCrib}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            recordLastUpdated="2023-01-01T10:00:00.000Z"
            onAction={mockOnAction}
            isSubRow={true}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    expect(screen.getByTitle(/Sin clasificación UPC/i)).toBeEnabled();
  });

  it('renders sub-row when clinicalCrib exists', () => {
    const dataWithCrib = {
      ...mockPatient,
      clinicalCrib: DataFactory.createMockPatient('R1-C', {
        patientName: 'Sub Patient',
        bedMode: 'Cuna',
      }),
    };

    render(
      <table>
        <tbody>
          <PatientRow
            data={dataWithCrib.clinicalCrib!}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            isSubRow={true}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('CUNA', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sub Patient')).toBeInTheDocument();
    expect(screen.getByTitle('Acciones')).toBeInTheDocument();
  });

  it('offers only safe cuna actions and removes the clinical crib after confirmation', async () => {
    const clinicalCrib = DataFactory.createMockPatient('R1-C', {
      patientName: 'Sub Patient',
      bedMode: 'Cuna',
    });

    const { mockContext } = render(
      <table>
        <tbody>
          <PatientRow
            data={clinicalCrib}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            recordLastUpdated="2023-01-01T10:00:00.000Z"
            onAction={mockOnAction}
            isSubRow={true}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Acciones'));

    expect(await screen.findByText('Ver Historial')).toBeInTheDocument();
    expect(screen.getByText('Limpiar')).toBeInTheDocument();
    expect(screen.queryByText('Copiar')).not.toBeInTheDocument();
    expect(screen.queryByText('Mover')).not.toBeInTheDocument();
    expect(screen.queryByText('Dar de Alta')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Limpiar'));

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Limpiar cuna',
        confirmText: 'Sí, limpiar',
      })
    );
    await waitFor(() => {
      expect(mockContext.updateClinicalCrib).toHaveBeenCalledWith(
        'R1',
        'remove',
        undefined,
        '2023-01-01T10:00:00.000Z',
        expect.objectContaining({ patientName: 'Sub Patient' })
      );
    });
    expect(mockOnAction).not.toHaveBeenCalled();
  });

  it('keeps the clinical crib when its cleanup is cancelled', async () => {
    mockConfirm.mockResolvedValueOnce(false);
    const clinicalCrib = DataFactory.createMockPatient('R1-C', {
      patientName: 'Sub Patient',
      bedMode: 'Cuna',
    });

    const { mockContext } = render(
      <table>
        <tbody>
          <PatientRow
            data={clinicalCrib}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            recordLastUpdated="2023-01-01T10:00:00.000Z"
            onAction={mockOnAction}
            isSubRow={true}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Acciones'));
    fireEvent.click(await screen.findByText('Limpiar'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockContext.updateClinicalCrib).not.toHaveBeenCalled();
  });

  it('opens sub-row demographics modal', async () => {
    const dataWithCrib = {
      ...mockPatient,
      clinicalCrib: DataFactory.createMockPatient('R1-C', {
        patientName: 'Sub Patient',
        bedMode: 'Cuna',
      }),
    };

    render(
      <table>
        <tbody>
          <PatientRow
            data={dataWithCrib.clinicalCrib!}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            isSubRow={true}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    const subDemoBtn = screen
      .getAllByTitle('Datos demográficos')
      .find(element => element.tagName === 'BUTTON');

    if (subDemoBtn) {
      fireEvent.click(subDemoBtn);
      expect(await screen.findByText(/Datos Demográficos/i)).toBeInTheDocument();
    }
  });
});
