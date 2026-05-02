import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PatientRowModals } from '@/features/census/components/patient-row/PatientRowModals';
import { DataFactory } from '@/tests/factories/DataFactory';

vi.mock('@/components/modals/DemographicsModal', () => ({
  DemographicsModal: ({
    bedId,
    isClinicalCribPatient,
    requiresCompleteDemographics,
    onCancel,
    onEmptySave,
  }: {
    bedId: string;
    isClinicalCribPatient?: boolean;
    requiresCompleteDemographics?: boolean;
    onCancel?: () => void;
    onEmptySave?: () => void;
  }) => (
    <div
      data-rn-context={String(Boolean(isClinicalCribPatient))}
      data-requires-complete-demographics={String(Boolean(requiresCompleteDemographics))}
    >
      <span>Demographics {bedId}</span>
      <button onClick={onCancel}>Cancelar Demographics</button>
      <button onClick={onEmptySave}>Guardar Vacío</button>
    </div>
  ),
}));

vi.mock('@/components/modals/ExamRequestModal', () => ({
  ExamRequestModal: ({ recordDate }: { recordDate?: string }) => (
    <div>Exam Request {recordDate}</div>
  ),
}));

vi.mock('@/components/modals/ImagingRequestDialog', () => ({
  ImagingRequestDialog: () => <div>Imaging Request</div>,
}));

vi.mock('@/components/modals/PatientHistoryModal', () => ({
  PatientHistoryModal: () => <div>Patient History</div>,
}));

vi.mock('@/features/clinical-documents', () => ({
  ClinicalDocumentsModal: () => <div>Clinical Documents</div>,
  ClinicalDocumentsPanel: () => <div>Clinical Documents Panel</div>,
}));

describe('PatientRowModals', () => {
  const baseProps = {
    bedId: 'R1',
    data: DataFactory.createMockPatient('R1', {
      patientName: 'Paciente',
      rut: '11.111.111-1',
    }),
    currentDateString: '2026-03-05',
    isSubRow: false,
    showDemographics: false,
    showClinicalDocuments: false,
    canOpenClinicalDocuments: false,
    showExamRequest: false,
    canOpenExamRequest: true,
    showImagingRequest: false,
    canOpenImagingRequest: true,
    showHistory: false,
    canOpenHistory: true,
    onCloseDemographics: vi.fn(),
    onCloseClinicalDocuments: vi.fn(),
    onCloseExamRequest: vi.fn(),
    onCloseImagingRequest: vi.fn(),
    onCloseHistory: vi.fn(),
    onSaveDemographics: vi.fn(),
    onSaveCribDemographics: vi.fn(),
    onRevertEmptyDemographics: vi.fn(),
  } as const;

  it('mounts only active modals', async () => {
    render(
      <PatientRowModals
        {...baseProps}
        showDemographics
        showExamRequest
        showImagingRequest
        showHistory
      />
    );

    const demographics = await screen.findByText('Demographics R1');
    expect(demographics).toBeInTheDocument();
    expect(demographics.closest('div')).toHaveAttribute('data-rn-context', 'false');
    expect(await screen.findByText('Exam Request 2026-03-05')).toBeInTheDocument();
    expect(await screen.findByText('Imaging Request')).toBeInTheDocument();
    expect(await screen.findByText('Patient History')).toBeInTheDocument();
    expect(screen.queryByText('Clinical Documents')).not.toBeInTheDocument();
  });

  it('does not mount clinical documents modal when user lacks permission', () => {
    render(
      <PatientRowModals {...baseProps} showClinicalDocuments canOpenClinicalDocuments={false} />
    );

    expect(screen.queryByText('Clinical Documents')).not.toBeInTheDocument();
  });

  it('mounts clinical documents modal when requested and authorized', async () => {
    render(<PatientRowModals {...baseProps} showClinicalDocuments canOpenClinicalDocuments />);

    expect(await screen.findByText('Clinical Documents')).toBeInTheDocument();
  });

  it('does not mount history, exam or imaging modals when capability is missing', () => {
    render(
      <PatientRowModals
        {...baseProps}
        showExamRequest
        canOpenExamRequest={false}
        showImagingRequest
        canOpenImagingRequest={false}
        showHistory
        canOpenHistory={false}
      />
    );

    expect(screen.queryByText('Exam Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Imaging Request')).not.toBeInTheDocument();
    expect(screen.queryByText('Patient History')).not.toBeInTheDocument();
  });

  it('enables RN identity context for main-row patients in Cuna mode', async () => {
    render(
      <PatientRowModals
        {...baseProps}
        showDemographics
        data={DataFactory.createMockPatient('R1', {
          patientName: 'RN principal',
          rut: '',
          bedMode: 'Cuna',
        })}
      />
    );

    expect((await screen.findByText('Demographics R1')).closest('div')).toHaveAttribute(
      'data-rn-context',
      'true'
    );
  });

  it('reverts a newly activated empty bed when demographics are cancelled', async () => {
    const onRevertEmptyDemographics = vi.fn();

    render(
      <PatientRowModals
        {...baseProps}
        showDemographics
        onRevertEmptyDemographics={onRevertEmptyDemographics}
        data={DataFactory.createMockPatient('R1', {
          patientName: ' ',
          rut: '',
          firstName: '',
          lastName: '',
          secondLastName: '',
          birthDate: '',
          insurance: undefined,
          origin: undefined,
          admissionOrigin: undefined,
          admissionDate: '',
          admissionTime: '',
          biologicalSex: 'Indeterminado',
        })}
      />
    );

    fireEvent.click(await screen.findByText('Cancelar Demographics'));

    expect(onRevertEmptyDemographics).toHaveBeenCalledTimes(1);
  });

  it('requires complete demographics for a newly activated empty bed', async () => {
    render(
      <PatientRowModals
        {...baseProps}
        showDemographics
        data={DataFactory.createMockPatient('R1', {
          patientName: ' ',
          rut: '',
          firstName: '',
          lastName: '',
          secondLastName: '',
          birthDate: '',
          insurance: undefined,
          origin: undefined,
          admissionOrigin: undefined,
          admissionDate: '',
          admissionTime: '',
          biologicalSex: 'Indeterminado',
        })}
      />
    );

    expect((await screen.findByText('Demographics R1')).closest('div')).toHaveAttribute(
      'data-requires-complete-demographics',
      'true'
    );
  });

  it('reverts a newly activated empty bed when the demographics modal saves empty data', async () => {
    const onRevertEmptyDemographics = vi.fn();

    render(
      <PatientRowModals
        {...baseProps}
        showDemographics
        onRevertEmptyDemographics={onRevertEmptyDemographics}
        data={DataFactory.createMockPatient('R1', {
          patientName: ' ',
          rut: '',
          firstName: '',
          lastName: '',
          secondLastName: '',
          birthDate: '',
          insurance: undefined,
          origin: undefined,
          admissionOrigin: undefined,
          admissionDate: '',
          admissionTime: '',
          biologicalSex: 'Indeterminado',
        })}
      />
    );

    fireEvent.click(await screen.findByText('Guardar Vacío'));

    expect(onRevertEmptyDemographics).toHaveBeenCalledTimes(1);
  });

  it('does not revert an existing patient when demographics are cancelled', async () => {
    const onRevertEmptyDemographics = vi.fn();

    render(
      <PatientRowModals
        {...baseProps}
        showDemographics
        onRevertEmptyDemographics={onRevertEmptyDemographics}
      />
    );

    fireEvent.click(await screen.findByText('Cancelar Demographics'));

    expect(onRevertEmptyDemographics).not.toHaveBeenCalled();
  });
});
