import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PatientIdentityCell } from '@/features/census/components/patient-row/PatientIdentityCell';
import { DataFactory } from '@/tests/factories/DataFactory';
import * as browserClipboardRuntime from '@/shared/runtime/browserClipboardRuntime';
import type { DebouncedTextHandler } from '@/features/census/components/patient-row/inputCellTypes';

const noopChange: DebouncedTextHandler = () => vi.fn();

const renderCell = (props?: Partial<React.ComponentProps<typeof PatientIdentityCell>>) =>
  render(
    <table>
      <tbody>
        <tr>
          <PatientIdentityCell
            data={DataFactory.createMockPatient('R1')}
            hasRutError={false}
            onNameChange={noopChange}
            onOpenDemographics={vi.fn()}
            {...props}
          />
        </tr>
      </tbody>
    </table>
  );

describe('PatientIdentityCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders name, age badge and RUT inside a single cell', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Juana Rapu',
      rut: '12.345.678-5',
      age: '45',
    });

    const { container } = renderCell({ data });

    expect(container.querySelectorAll('td')).toHaveLength(1);

    const nameInput = container.querySelector('input[name="patientName"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Juana Rapu');
    expect(nameInput).toHaveAttribute('readonly');

    expect(screen.getByText('(45)')).toBeInTheDocument();
    expect(screen.getByText('12.345.678-5')).toBeInTheDocument();
    expect(screen.getByTitle('RUT válido')).toBeInTheDocument();
  });

  it('opens demographics from the age badge', () => {
    const onOpenDemographics = vi.fn();
    const data = DataFactory.createMockPatient('R1', { age: '45' });

    renderCell({ data, onOpenDemographics });

    fireEvent.click(screen.getByRole('button', { name: /abre datos demográficos/i }));
    expect(onOpenDemographics).toHaveBeenCalledTimes(1);
  });

  it('marks invalid RUTs with the validation indicator', () => {
    const data = DataFactory.createMockPatient('R1', { rut: '12.345.678-9' });

    renderCell({ data });

    expect(screen.getByTitle('RUT inválido')).toBeInTheDocument();
  });

  it('copies the RUT to clipboard when clicked', async () => {
    const writeClipboardTextSpy = vi
      .spyOn(browserClipboardRuntime, 'writeClipboardText')
      .mockResolvedValue(undefined);
    const data = DataFactory.createMockPatient('R1', { rut: '12.345.678-5' });

    renderCell({ data });

    fireEvent.click(screen.getByText('12.345.678-5'));

    await waitFor(() => expect(writeClipboardTextSpy).toHaveBeenCalledWith('12.345.678-5'));
    expect(screen.getByTitle('RUT copiado')).toBeInTheDocument();
  });

  it('shows the PAS marker instead of RUT validation for passports', () => {
    const data = DataFactory.createMockPatient('R1', {
      rut: 'AB123456',
      documentType: 'Pasaporte',
    });

    renderCell({ data });

    expect(screen.getByText('PAS')).toBeInTheDocument();
    expect(screen.queryByTitle('RUT válido')).not.toBeInTheDocument();
    expect(screen.queryByTitle('RUT inválido')).not.toBeInTheDocument();
  });

  it('keeps only the name input for empty beds (activation selector intact)', () => {
    const data = DataFactory.createMockPatient('R4', {
      patientName: '',
      rut: '',
      age: '',
    });

    const { container } = renderCell({ data, isEmpty: true });

    const nameInput = container.querySelector('input[name="patientName"]') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('');
    expect(screen.queryByText('Sin documento')).not.toBeInTheDocument();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('does not emit inline updates for official main-row names', () => {
    const handlePatientName = vi.fn();
    const onNameChange: DebouncedTextHandler = field =>
      field === 'patientName' ? handlePatientName : vi.fn();
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Principal',
      identityStatus: 'official',
      rut: '12.345.678-5',
    });

    const { container } = renderCell({ data, onNameChange });

    const nameInput = container.querySelector('input[name="patientName"]') as HTMLInputElement;
    expect(nameInput).toHaveAttribute('readonly');

    fireEvent.change(nameInput, { target: { value: 'Paciente Editado' } });
    fireEvent.blur(nameInput);
    expect(handlePatientName).not.toHaveBeenCalled();
  });

  it('allows inline name edition for provisional clinical crib sub-rows', () => {
    const handlePatientName = vi.fn();
    const onNameChange: DebouncedTextHandler = field =>
      field === 'patientName' ? handlePatientName : vi.fn();
    const data = DataFactory.createMockPatient('R1-cuna', {
      patientName: 'RN de Madre',
      identityStatus: 'provisional',
      rut: '',
      age: '',
    });

    const { container } = renderCell({ data, isSubRow: true, onNameChange });

    const nameInput = container.querySelector('input[name="patientName"]') as HTMLInputElement;
    expect(nameInput).not.toHaveAttribute('readonly');

    fireEvent.change(nameInput, { target: { value: 'RN de Maria Tuki' } });
    fireEvent.blur(nameInput);
    expect(handlePatientName).toHaveBeenCalledWith('RN de Maria Tuki');
  });
});
