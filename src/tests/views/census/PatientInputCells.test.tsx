import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientInputCells } from '@/features/census/components/patient-row/PatientInputCells';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useDailyRecordStability } from '@/context/DailyRecordContext';
import { UIProvider } from '@/context/UIContext';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { clearDailyRecordClinicalFieldPausesForTests } from '@/hooks/controllers/dailyRecordClinicalFieldAcknowledgementController';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStability: vi.fn(),
}));

const renderWithUI = (ui: ReactElement) => render(<UIProvider>{ui}</UIProvider>);

describe('PatientInputCells', () => {
  beforeEach(() => {
    clearDailyRecordClinicalFieldPausesForTests();
  });

  it('renders flag cells hiding the C.QX checkbox (rediseño 2026)', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
            />
          </tr>
        </tbody>
      </table>
    );

    // La columna C.QX está oculta (campo surgicalComplication conservado para el futuro).
    expect(screen.queryByTitle('Comp. Qx')).not.toBeInTheDocument();
    expect(screen.getByTitle(/Sin clasificación UPC/i)).toBeInTheDocument();
  });

  it('hides specialist-restricted cells in specialist census access', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={true}
              diagnosisMode="free"
              accessProfile="specialist"
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.queryByTitle('Comp. Qx')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Sin clasificación UPC/i)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/DE|ES|CU/)).not.toBeInTheDocument();
  });

  it('uses the clinical block panel as the primary editor for diagnosis and specialty (status decoupled)', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    data.pathology = 'ACV';
    data.specialty = Specialty.MEDICINA;
    data.status = PatientStatus.ESTABLE;
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
              clinicalFieldLocks={{ diagnosis: true }}
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.queryByPlaceholderText('Diagnóstico (texto libre)')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(PatientStatus.ESTABLE)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /editar diagnóstico/i }));
    expect(screen.queryByText('Bloque clínico')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Cerrar bloque clínico')).toHaveClass(
      'absolute',
      'right-2',
      'top-2'
    );
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Neumonia' },
    });
    fireEvent.change(screen.getByLabelText('Especialidad'), {
      target: { value: Specialty.CIRUGIA },
    });
    // The editor no longer has an "Estado" field — status lives in its own dot column.
    expect(screen.queryByLabelText('Estado')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Guardar'));

    expect(onChange.multiple).toHaveBeenCalledWith({
      pathology: 'Neumonia',
      specialty: Specialty.CIRUGIA,
    });
    expect(screen.queryByText(/Actualizado recién/i)).not.toBeInTheDocument();
  });

  it('shows the clinical status as a colored dot in its own column (decoupled)', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    data.status = PatientStatus.DE_CUIDADO;
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
            />
          </tr>
        </tbody>
      </table>
    );

    // The status is now a colored circle (amber for "De cuidado"), not a text label in the editor.
    const statusButton = screen.getByRole('button', { name: /estado: de cuidado/i });
    expect(statusButton.querySelector('.bg-amber-400')).toBeInTheDocument();
    expect(statusButton.closest('td')).toHaveClass('w-4');
    // And it is no longer part of the diagnosis/specialty editor.
    expect(
      screen.queryByRole('button', { name: /editar estado clínico/i })
    ).not.toBeInTheDocument();
  });

  it('saves the initial clinical block for a newly created patient in one patch', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Nuevo',
      pathology: '',
      specialty: '',
      status: undefined,
    });
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByRole('button', { name: /editar diagnóstico/i }));
    fireEvent.change(screen.getByLabelText('Diagnóstico'), {
      target: { value: 'Infeccion urinaria' },
    });
    fireEvent.change(screen.getByLabelText('Especialidad'), {
      target: { value: Specialty.MEDICINA },
    });
    fireEvent.click(screen.getByText('Guardar'));

    expect(onChange.multiple).toHaveBeenCalledTimes(1);
    expect(onChange.multiple).toHaveBeenCalledWith({
      pathology: 'Infeccion urinaria',
      specialty: Specialty.MEDICINA,
    });
    expect(onChange.text).not.toHaveBeenCalledWith('pathology');
    expect(onChange.text).not.toHaveBeenCalledWith('specialty');
  });

  it('shows a specialty description input when Otro is selected in the clinical block panel', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    data.pathology = 'Dolor abdominal';
    data.specialty = Specialty.MEDICINA;
    data.status = PatientStatus.DE_CUIDADO;
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
            />
          </tr>
        </tbody>
      </table>
    );

    // La especialidad ya no tiene celda propia: se edita desde el editor de Diagnóstico.
    fireEvent.click(screen.getByRole('button', { name: /editar diagnóstico/i }));
    fireEvent.change(screen.getByLabelText('Especialidad'), {
      target: { value: Specialty.OTRO },
    });

    const specialtyDescription = screen.getByLabelText('Describir especialidad');
    fireEvent.change(specialtyDescription, {
      target: { value: 'Unidad dolor' },
    });
    fireEvent.click(screen.getByText('Guardar'));

    expect(onChange.multiple).toHaveBeenCalledWith({
      pathology: 'Dolor abdominal',
      specialty: 'Unidad dolor',
    });
  });

  it('preserves ginecobstetric subtype and delivery route controls in the clinical block cells', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    data.patientName = 'Paciente GO';
    data.pathology = 'Puerperio';
    data.specialty = Specialty.GINECOBSTETRICIA;
    data.ginecobstetriciaType = 'Obstétrica';
    data.deliveryRoute = 'Cesárea';
    data.deliveryDate = '2026-02-15';
    data.deliveryCesareanLabor = 'Con TdP';
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    renderWithUI(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
            />
          </tr>
        </tbody>
      </table>
    );

    fireEvent.click(screen.getByTitle('Definir tipo de atención'));
    fireEvent.click(screen.getByRole('button', { name: 'Ginecológica' }));

    expect(onChange.multiple).toHaveBeenCalledWith({
      ginecobstetriciaType: 'Ginecológica',
      deliveryRoute: undefined,
      deliveryDate: undefined,
      deliveryCesareanLabor: undefined,
    });

    fireEvent.click(screen.getByTitle(/Cesárea \(Con TdP\)/i));
    expect(screen.getByText('Vía del Parto')).toBeInTheDocument();
  });
});
