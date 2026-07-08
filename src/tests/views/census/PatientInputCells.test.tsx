import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientInputCells } from '@/features/census/components/patient-row/PatientInputCells';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useDailyRecordStability } from '@/context/DailyRecordContext';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { clearDailyRecordClinicalFieldPausesForTests } from '@/hooks/controllers/dailyRecordClinicalFieldAcknowledgementController';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStability: vi.fn(),
}));

describe('PatientInputCells', () => {
  beforeEach(() => {
    clearDailyRecordClinicalFieldPausesForTests();
  });

  it('renders flag checkboxes from section composition', () => {
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

    render(
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

    expect(screen.getByTitle('Comp. Qx')).toBeInTheDocument();
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

    render(
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

  it('uses the clinical block panel as the primary editor for diagnosis specialty and status', () => {
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

    render(
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
    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: PatientStatus.GRAVE },
    });
    fireEvent.click(screen.getByText('Guardar'));

    expect(onChange.multiple).toHaveBeenCalledWith({
      pathology: 'Neumonia',
      specialty: Specialty.CIRUGIA,
      status: PatientStatus.GRAVE,
    });
    expect(screen.queryByText(/Actualizado recién/i)).not.toBeInTheDocument();
  });

  it('preserves colored clinical status labels in the primary clinical block cell', () => {
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

    render(
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

    expect(screen.getByRole('button', { name: /editar estado clínico/i })).toHaveClass(
      'text-amber-700',
      'bg-amber-50',
      'border-amber-200/80',
      'rounded-md',
      'shadow-sm',
      'uppercase'
    );
    expect(screen.getByText(PatientStatus.DE_CUIDADO)).toHaveClass('flex-1', 'text-current');
    expect(
      screen.getByRole('button', { name: /editar estado clínico/i }).closest('td')
    ).toHaveClass('w-28');
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

    render(
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
    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: PatientStatus.DE_CUIDADO },
    });
    fireEvent.click(screen.getByText('Guardar'));

    expect(onChange.multiple).toHaveBeenCalledTimes(1);
    expect(onChange.multiple).toHaveBeenCalledWith({
      pathology: 'Infeccion urinaria',
      specialty: Specialty.MEDICINA,
      status: PatientStatus.DE_CUIDADO,
    });
    expect(onChange.text).not.toHaveBeenCalledWith('pathology');
    expect(onChange.text).not.toHaveBeenCalledWith('specialty');
    expect(onChange.text).not.toHaveBeenCalledWith('status');
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

    render(
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

    fireEvent.click(screen.getByRole('button', { name: /editar especialidad/i }));
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
      status: PatientStatus.DE_CUIDADO,
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

    render(
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
