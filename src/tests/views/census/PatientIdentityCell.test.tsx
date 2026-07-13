import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('renders name with inline age badge and RUT inside a single cell', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Juana Rapu',
      rut: '12.345.678-5',
      age: '45',
    });

    const { container } = renderCell({ data });

    expect(container.querySelectorAll('td')).toHaveLength(1);

    // Read-only official names render as a borderless, read-only input (keeps
    // input[name="patientName"] as the stable hook for the census/e2e suite) with
    // the age badge hugging it in the same line: "Juana Rapu (45a)".
    const nameInput = container.querySelector('input[name="patientName"]') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveValue('Juana Rapu');
    expect(nameInput).toHaveAttribute('readonly');
    const ageBadge = screen.getByText('(45a)');
    expect(nameInput.parentElement).toBe(ageBadge.parentElement);
    expect(nameInput.nextElementSibling).toBe(ageBadge);

    expect(screen.getByText('12.345.678-5')).toBeInTheDocument();
    expect(screen.getByTitle('RUT válido')).toBeInTheDocument();
  });

  it('shows the specialty as a small chip next to the admission date', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Juana Rapu',
      rut: '12.345.678-5',
      age: '45',
      admissionDate: '2026-07-12',
      specialty: 'Med Interna',
    });

    renderCell({ data });

    const chip = screen.getByTitle('Especialidad: Med Interna');
    expect(chip).toHaveTextContent('Med Interna');
    // Rendered after the "FI:" date within the same details line (separated by "/").
    expect(screen.getByText('FI:')).toBeInTheDocument();
  });

  it('renders no specialty chip when the patient has no specialty set', () => {
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Juana Rapu',
      rut: '12.345.678-5',
      specialty: '',
    });

    renderCell({ data });

    expect(screen.queryByTitle(/^Especialidad:/)).not.toBeInTheDocument();
  });

  it('keeps unit-suffixed ages as-is in the inline badge', () => {
    const data = DataFactory.createMockPatient('R1', { age: '10d' });

    renderCell({ data });

    expect(screen.getByText('(10d)')).toBeInTheDocument();
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

  it('does not render an editable input for official main-row names', () => {
    const handlePatientName = vi.fn();
    const onNameChange: DebouncedTextHandler = field =>
      field === 'patientName' ? handlePatientName : vi.fn();
    const data = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Principal',
      identityStatus: 'official',
      rut: '12.345.678-5',
    });

    const { container } = renderCell({ data, onNameChange });

    // The official main-row name is read-only: the input still exists (stable test
    // hook) but is not editable and never fires the name-change handler.
    const nameInput = container.querySelector('input[name="patientName"]') as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('readonly');
    expect(nameInput).toHaveValue('Paciente Principal');
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

  it('shows an isolation badge when the patient is in isolation', () => {
    const isolated = DataFactory.createMockPatient('R1', {
      patientName: 'Juana',
      isIsolated: true,
    });
    renderCell({ data: isolated });
    expect(screen.getByLabelText('En aislamiento')).toBeInTheDocument();

    const notIsolated = DataFactory.createMockPatient('R1', { patientName: 'Juana' });
    const { container } = renderCell({ data: notIsolated });
    expect(within(container).queryByLabelText('En aislamiento')).not.toBeInTheDocument();
  });
});
