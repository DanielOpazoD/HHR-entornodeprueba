import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
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

describe('PatientRow layout and actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(hover: hover) and (pointer: fine)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('renders patient name and bed name correctly', () => {
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

    expect(screen.getByDisplayValue(/Juan Pérez/)).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
  });

  it('keeps the main row action cell above the table but below sticky app bars', () => {
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

    expect(screen.getByTitle('Acciones').closest('td')).toHaveClass('z-[36]');
  });

  it('does not render the orbital quick actions launcher for a row without name and rut', () => {
    render(
      <table>
        <tbody>
          <PatientRow
            data={DataFactory.createMockPatient('R1', {
              patientName: '',
              rut: '',
            })}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    expect(
      screen.queryByRole('button', { name: /acciones clínicas rápidas/i })
    ).not.toBeInTheDocument();
  });

  it('opens the UPC checklist when the classification button is clicked', async () => {
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

    fireEvent.click(screen.getByTitle(/Sin clasificación UPC/i));

    expect(
      await screen.findByRole('dialog', { name: /checklist de clasificación upc/i })
    ).toBeInTheDocument();
  });

  it('renders a passive UPC placeholder on non-eligible beds', () => {
    const hBedDef = {
      id: 'H1C1',
      name: 'H1C1',
      type: BedType.MEDIA,
      isCuna: false,
    };
    const patientInGeneralBed = DataFactory.createMockPatient('H1C1', {
      patientName: 'Paciente Sala',
      isUPC: true,
    });

    render(
      <table>
        <tbody>
          <PatientRow
            data={patientInGeneralBed}
            bed={hBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.MEDIA}
          />
        </tbody>
      </table>
    );

    expect(screen.getByTitle('UPC disponible solo en R1-R4, Neo 1-2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upc/i })).not.toBeInTheDocument();
  });

  it('updates status through the clinical block editor', () => {
    vi.useFakeTimers();
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

    fireEvent.click(screen.getByRole('button', { name: /editar estado clínico/i }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: PatientStatus.GRAVE } });
    fireEvent.click(screen.getByText('Guardar'));

    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(mockContext.updatePatientMultiple).toHaveBeenCalledWith('R1', {
      pathology: 'Neumonía',
      specialty: Specialty.MEDICINA,
      status: PatientStatus.GRAVE,
    });
  });

  it('renders blocked message and reason instead of inputs', () => {
    const blockedPatient = { ...mockPatient, isBlocked: true, blockedReason: 'Mantenimiento' };
    render(
      <table>
        <tbody>
          <PatientRow
            data={blockedPatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText(/Cama Bloqueada/i)).toBeInTheDocument();
    expect(screen.getByText(/\(Mantenimiento\)/i)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Juan Pérez')).not.toBeInTheDocument();
  });

  it('calls onAction when copy, move, discharge, or transfer is clicked', async () => {
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

    const actions = [
      {
        matcher: () => screen.findByTitle('Copiar a otro día', {}, { timeout: 4000 }),
        expected: 'copy',
      },
      {
        matcher: () => screen.findByTitle('Mover de cama', {}, { timeout: 4000 }),
        expected: 'move',
      },
      {
        matcher: () => screen.findByText(/Dar de Alta/i, {}, { timeout: 4000 }),
        expected: 'discharge',
      },
      {
        matcher: () => screen.findByText(/Trasladar/i, {}, { timeout: 4000 }),
        expected: 'transfer',
      },
    ] as const;

    for (const { matcher, expected } of actions) {
      fireEvent.click(screen.getByTitle('Acciones'));
      fireEvent.click(await matcher());
      expect(mockOnAction).toHaveBeenCalledWith(expected, 'R1', mockPatient);
    }
  });

  it('closes menu when clicking background overlay', async () => {
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

    fireEvent.click(screen.getByTitle('Acciones'));
    expect(await screen.findByText(/Copiar/i)).toBeInTheDocument();

    const overlay = document.querySelector('.fixed.inset-0.z-40');
    if (overlay) {
      fireEvent.click(overlay);
      await waitFor(() => {
        expect(screen.queryByText(/Copiar/i)).not.toBeInTheDocument();
      });
    }
  });

  it('keeps admission date visible without opening an inline editor', () => {
    const editablePatient = {
      ...mockPatient,
      admissionDate: '2023-01-01',
      firstSeenDate: '2023-01-01',
    };

    render(
      <table>
        <tbody>
          <PatientRow
            data={editablePatient}
            bed={mockBedDef}
            currentDateString="2023-01-01"
            onAction={mockOnAction}
            bedType={BedType.UTI}
          />
        </tbody>
      </table>
    );

    expect(screen.getByText('01/01/2023')).toBeInTheDocument();
    expect(screen.queryByLabelText('Editar fecha y hora de ingreso')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Configurar fecha y hora de ingreso' })
    ).not.toBeInTheDocument();
  });

  it('keeps patient name read-only in table (edition only via demographics)', () => {
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

    const nameInput = screen.getByDisplayValue('Juan Pérez');
    expect(nameInput).toHaveAttribute('readonly');
    fireEvent.change(nameInput, { target: { value: 'Juan Actualizado' } });
    expect(mockContext.updatePatient).not.toHaveBeenCalled();
  });
});
