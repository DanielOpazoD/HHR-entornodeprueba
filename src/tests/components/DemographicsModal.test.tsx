import { fireEvent, render, screen } from '@testing-library/react';
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
});
