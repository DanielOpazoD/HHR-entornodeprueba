import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DemographicsModal } from '@/components/modals/DemographicsModal';
import type { DemographicSubset } from '@/components/modals/DemographicsModal';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logPatientView: vi.fn(),
  }),
}));

const createEmptyDemographics = (): DemographicSubset =>
  DataFactory.createMockPatient('R1', {
    patientName: ' ',
    firstName: '',
    lastName: '',
    secondLastName: '',
    rut: '',
    birthDate: '',
    insurance: undefined,
    origin: undefined,
    admissionOrigin: undefined,
    admissionOriginDetails: '',
    admissionDate: '',
    admissionTime: '',
    biologicalSex: 'Indeterminado',
  });

describe('DemographicsModal', () => {
  it('does not close a new patient admission when the backdrop is clicked', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();

    render(
      <DemographicsModal
        isOpen
        onClose={onClose}
        onCancel={onCancel}
        data={createEmptyDemographics()}
        onSave={vi.fn()}
        bedId="R1"
        recordDate="2026-05-01"
        requiresCompleteDemographics
      />
    );

    const dialog = screen.getByRole('dialog', { name: /datos demográficos/i });
    const backdrop = dialog.closest('.fixed.inset-0');
    expect(backdrop).toBeTruthy();

    fireEvent.click(backdrop!);

    expect(onClose).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks saving a new census patient until required demographics are complete', () => {
    const onSave = vi.fn();

    render(
      <DemographicsModal
        isOpen
        onClose={vi.fn()}
        data={createEmptyDemographics()}
        onSave={onSave}
        bedId="R1"
        recordDate="2026-05-01"
        requiresCompleteDemographics
      />
    );

    const saveButton = screen.getByRole('button', { name: /guardar cambios/i });

    expect(saveButton).toBeDisabled();
    expect(screen.getByText('Campos obligatorios pendientes')).toBeInTheDocument();
    expect(screen.getByText('Faltan 9')).toBeInTheDocument();
    expect(screen.queryByText(/falta completar: nombre/i)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Fecha de ingreso' })).toHaveTextContent(
      '30/04/2026'
    );
    expect(screen.getByRole('combobox', { name: 'Fecha de ingreso' })).toHaveTextContent(
      '01/05/2026'
    );
    expect(screen.getByRole('combobox', { name: 'Fecha de ingreso' })).toHaveTextContent(
      '02/05/2026'
    );
    expect(screen.getByRole('combobox', { name: 'Hora de ingreso - horas' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Hora de ingreso - minutos' })).toHaveValue('');
    expect(
      screen.getByRole('group', { name: 'Configuración de hora de ingreso' })
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('Apellido paterno')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('Apellido materno')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('12.345.678-9')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: 'Fecha de ingreso' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Hora de ingreso' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('combobox', { name: 'Origen del ingreso' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('group', { name: 'Sexo biológico' })).toHaveAttribute(
      'aria-invalid',
      'true'
    );

    fireEvent.change(screen.getByPlaceholderText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByPlaceholderText('Apellido paterno'), {
      target: { value: 'Perez' },
    });
    fireEvent.change(screen.getByPlaceholderText('Apellido materno'), {
      target: { value: 'Soto' },
    });
    fireEvent.change(screen.getByPlaceholderText('12.345.678-9'), {
      target: { value: '11.111.111-1' },
    });

    const birthDateInput = document.querySelector('input[type="date"]');
    expect(birthDateInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(birthDateInput as HTMLInputElement, { target: { value: '1980-04-12' } });

    const [, , admissionOriginSelect] = screen.getAllByRole('combobox');
    fireEvent.change(admissionOriginSelect, { target: { value: 'Urgencias' } });

    fireEvent.change(screen.getByRole('combobox', { name: 'Fecha de ingreso' }), {
      target: { value: '2026-05-01' },
    });
    expect(screen.getByRole('combobox', { name: 'Hora de ingreso - horas' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Hora de ingreso - minutos' })).toHaveValue('');

    const [, femaleSexOption] = screen.getAllByRole('radio');
    fireEvent.click(femaleSexOption);

    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Hora de ingreso - horas' }), {
      target: { value: '09' },
    });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: 'Hora de ingreso - minutos' }), {
      target: { value: '30' },
    });

    expect(screen.getByPlaceholderText('Nombre')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByPlaceholderText('Apellido paterno')).not.toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByPlaceholderText('Apellido materno')).not.toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByPlaceholderText('12.345.678-9')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: 'Fecha de ingreso' })).not.toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Hora de ingreso' })).not.toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('combobox', { name: 'Origen del ingreso' })).not.toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('group', { name: 'Sexo biológico' })).not.toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        identityStatus: 'official',
        firstName: 'Ana',
        lastName: 'Perez',
        secondLastName: 'Soto',
        patientName: 'Ana Perez Soto',
        rut: '11.111.111-1',
        birthDate: '1980-04-12',
        admissionDate: '2026-05-01',
        admissionTime: '09:30',
        admissionOrigin: 'Urgencias',
        biologicalSex: 'Femenino',
      })
    );
  });

  it('shows the target bed and fills a fictitious patient from the icon action', () => {
    const onSave = vi.fn();

    render(
      <DemographicsModal
        isOpen
        onClose={vi.fn()}
        data={createEmptyDemographics()}
        onSave={onSave}
        bedId="R4"
        recordDate="2026-05-09"
        requiresCompleteDemographics
      />
    );

    expect(screen.getByText('Cama R4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rellenar paciente ficticio' }));

    expect(screen.getByPlaceholderText('Nombre')).toHaveValue('Daniel');
    expect(screen.getByPlaceholderText('Apellido paterno')).toHaveValue('Opazo');
    expect(screen.getByPlaceholderText('Apellido materno')).toHaveValue('Damiani');
    expect(screen.getByPlaceholderText('12.345.678-9')).toHaveValue('17.752.753-K');

    const birthDateInput = document.querySelector('input[type="date"]');
    expect(birthDateInput).toBeInstanceOf(HTMLInputElement);
    expect(birthDateInput).toHaveValue('1990-11-15');

    fireEvent.change(screen.getByRole('combobox', { name: 'Fecha de ingreso' }), {
      target: { value: '2026-05-09' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Hora de ingreso - horas' }), {
      target: { value: '09' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Hora de ingreso - minutos' }), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Origen del ingreso' }), {
      target: { value: 'Urgencias' },
    });
    fireEvent.click(screen.getAllByRole('radio')[0]);

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Daniel',
        lastName: 'Opazo',
        secondLastName: 'Damiani',
        patientName: 'Daniel Opazo Damiani',
        rut: '17.752.753-K',
        birthDate: '1990-11-15',
        pathology: 'Neumonía (Probando)',
      })
    );
  });

  it('keeps rapid name-part edits when saving official demographics', () => {
    const onSave = vi.fn();

    render(
      <DemographicsModal
        isOpen
        onClose={vi.fn()}
        data={createEmptyDemographics()}
        onSave={onSave}
        bedId="R1"
        recordDate="2026-05-01"
      />
    );

    act(() => {
      fireEvent.change(screen.getByPlaceholderText('Nombre'), { target: { value: 'Legacy' } });
      fireEvent.change(screen.getByPlaceholderText('Apellido paterno'), {
        target: { value: 'Patient' },
      });
      fireEvent.change(screen.getByPlaceholderText('Apellido materno'), {
        target: { value: 'Normalized' },
      });
    });

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Legacy',
        lastName: 'Patient',
        secondLastName: 'Normalized',
        patientName: 'Legacy Patient Normalized',
      })
    );
  });

  it('allows typing admission time in HH:MM format from demographics', () => {
    const onSave = vi.fn();

    render(
      <DemographicsModal
        isOpen
        onClose={vi.fn()}
        data={createEmptyDemographics()}
        onSave={onSave}
        bedId="R1"
        recordDate="2026-05-01"
        requiresCompleteDemographics
      />
    );

    const saveButton = screen.getByRole('button', { name: /guardar cambios/i });

    fireEvent.change(screen.getByPlaceholderText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByPlaceholderText('Apellido paterno'), {
      target: { value: 'Perez' },
    });
    fireEvent.change(screen.getByPlaceholderText('Apellido materno'), {
      target: { value: 'Soto' },
    });
    fireEvent.change(screen.getByPlaceholderText('12.345.678-9'), {
      target: { value: '11.111.111-1' },
    });

    const birthDateInput = document.querySelector('input[type="date"]');
    expect(birthDateInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(birthDateInput as HTMLInputElement, { target: { value: '1980-04-12' } });

    const [, , admissionOriginSelect] = screen.getAllByRole('combobox');
    fireEvent.change(admissionOriginSelect, { target: { value: 'Urgencias' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Fecha de ingreso' }), {
      target: { value: '2026-05-01' },
    });
    const [, femaleSexOption] = screen.getAllByRole('radio');
    fireEvent.click(femaleSexOption);

    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Hora de ingreso' }), {
      target: { value: '14:' },
    });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Hora de ingreso' }), {
      target: { value: '14:00' },
    });

    expect(screen.getByRole('combobox', { name: 'Hora de ingreso - horas' })).toHaveValue('14');
    expect(screen.getByRole('combobox', { name: 'Hora de ingreso - minutos' })).toHaveValue('00');
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        admissionDate: '2026-05-01',
        admissionTime: '14:00',
      })
    );
  });

  it('allows saving an arbitrary past admission date from demographics', () => {
    const onSave = vi.fn();

    render(
      <DemographicsModal
        isOpen
        onClose={vi.fn()}
        data={createEmptyDemographics()}
        onSave={onSave}
        bedId="R1"
        recordDate="2026-05-01"
        requiresCompleteDemographics
        canUseArbitraryAdmissionDate
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Nombre'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByPlaceholderText('Apellido paterno'), {
      target: { value: 'Perez' },
    });
    fireEvent.change(screen.getByPlaceholderText('Apellido materno'), {
      target: { value: 'Soto' },
    });
    fireEvent.change(screen.getByPlaceholderText('12.345.678-9'), {
      target: { value: '11.111.111-1' },
    });

    const birthDateInput = document.querySelector('input[type="date"]');
    expect(birthDateInput).toBeInstanceOf(HTMLInputElement);
    fireEvent.change(birthDateInput as HTMLInputElement, { target: { value: '1980-04-12' } });

    fireEvent.change(screen.getByRole('combobox', { name: 'Origen del ingreso' }), {
      target: { value: 'Urgencias' },
    });
    fireEvent.change(screen.getByLabelText('Fecha de ingreso'), {
      target: { value: '2026-04-20' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Hora de ingreso' }), {
      target: { value: '14:00' },
    });
    fireEvent.click(screen.getAllByRole('radio')[1]);

    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        admissionDate: '2026-04-20',
        admissionTime: '14:00',
      })
    );
  });
});
