import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransferManagementView } from '@/features/transfers/components/TransferManagementView';

const { mockUpdateTransfer } = vi.hoisted(() => ({
  mockUpdateTransfer: vi.fn().mockResolvedValue(undefined),
}));

const activeTransfers = [
  {
    id: 'tr-requested',
    bedId: 'BED_H1',
    status: 'REQUESTED',
    requestDate: '2026-03-05',
    statusHistory: [],
    destinationHospital: 'Hospital Del Salvador',
    transferNotes: [
      {
        id: 'note-1',
        content: 'Nota de coordinación inicial',
        createdAt: '2026-03-05T10:30:00.000Z',
        createdBy: 'nurse@hospital.cl',
      },
    ],
    patientSnapshot: { name: 'Paciente solicitado', rut: '1-9', diagnosis: 'Dx' },
  },
  {
    id: 'tr-received',
    bedId: 'BED_H2',
    status: 'RECEIVED',
    requestDate: '2026-03-05',
    statusHistory: [],
    destinationHospital: 'Hospital Del Salvador',
    patientSnapshot: { name: 'Paciente recepcionado', rut: '2-7', diagnosis: 'Dx' },
  },
  {
    id: 'tr-accepted',
    bedId: 'BED_H3',
    status: 'ACCEPTED_WITH_CAPACITY',
    requestDate: '2026-06-05',
    statusHistory: [],
    destinationHospital: 'Hospital Del Salvador',
    patientSnapshot: { name: 'Paciente aceptado', rut: '3-5', diagnosis: 'Dx' },
  },
] as const;

const finalizedTransfers = [
  {
    id: 'tr-transferred',
    bedId: 'BED_H4',
    status: 'TRANSFERRED',
    requestDate: '2026-03-05',
    statusHistory: [{ timestamp: '2026-03-07T10:00:00.000Z' }],
    destinationHospital: 'Hospital Del Salvador',
    patientSnapshot: { name: 'Paciente trasladado', rut: '4-3', diagnosis: 'Dx' },
  },
  {
    id: 'tr-cancelled',
    bedId: 'BED_H5',
    status: 'CANCELLED',
    requestDate: '2026-03-05',
    statusHistory: [{ timestamp: '2026-03-08T10:00:00.000Z' }],
    destinationHospital: 'Hospital Del Salvador',
    patientSnapshot: { name: 'Paciente cancelado', rut: '5-1', diagnosis: 'Dx' },
  },
  {
    id: 'tr-rejected',
    bedId: 'BED_H6',
    status: 'REJECTED',
    requestDate: '2026-03-05',
    statusHistory: [{ timestamp: '2026-03-08T10:00:00.000Z' }],
    destinationHospital: 'Hospital Del Salvador',
    patientSnapshot: { name: 'Paciente rechazado', rut: '6-k', diagnosis: 'Dx' },
  },
  {
    id: 'tr-no-response',
    bedId: 'BED_H7',
    status: 'NO_RESPONSE',
    requestDate: '2026-03-05',
    statusHistory: [{ timestamp: '2026-03-09T10:00:00.000Z' }],
    destinationHospital: 'Hospital Del Salvador',
    patientSnapshot: { name: 'Paciente sin respuesta', rut: '7-8', diagnosis: 'Dx' },
  },
] as const;

const mockTransferManagement = {
  transfers: [...activeTransfers, ...finalizedTransfers],
  isLoading: false,
  error: null,
  createTransfer: vi.fn(),
  updateTransfer: mockUpdateTransfer,
  advanceStatus: vi.fn(),
  setTransferStatus: vi.fn(),
  markAsTransferred: vi.fn(),
  cancelTransfer: vi.fn(),
  deleteTransfer: vi.fn(),
  undoTransfer: vi.fn(),
  archiveTransfer: vi.fn(),
  deleteHistoryEntry: vi.fn(),
  getHospitalizedPatients: vi.fn().mockReturnValue([]),
};

const mockViewHandlers = {
  handleNewRequest: vi.fn(),
  handleEditTransfer: vi.fn(),
  handleCloseFormModal: vi.fn(),
  handleSave: vi.fn(),
  handleStatusChange: vi.fn(),
  handleCloseStatusModal: vi.fn(),
  handleConfirmStatusChange: vi.fn(),
  handleMarkTransferred: vi.fn(),
  handleCloseTransferModal: vi.fn(),
  handleConfirmTransfer: vi.fn(),
  handleCancel: vi.fn(),
  handleCloseCancelModal: vi.fn(),
  handleConfirmCancel: vi.fn(),
  handleGenerateDocs: vi.fn(),
  handleCloseQuestionnaire: vi.fn(),
  handleQuestionnaireComplete: vi.fn(),
  handleViewDocs: vi.fn(),
  handleClosePackageModal: vi.fn(),
};

vi.mock('@/features/transfers/hooks/useTransferManagementViewRuntime', () => ({
  useTransferManagementViewRuntime: () => {
    const [showFinalizedTransfers, setShowFinalizedTransfers] = React.useState(false);

    return {
      currentYear: 2026,
      selectedYear: 2026,
      setSelectedYear: vi.fn(),
      selectedMonth: 3,
      setSelectedMonth: vi.fn(),
      showFinalizedTransfers,
      setShowFinalizedTransfers,
      monthLabels: [
        'Ene',
        'Feb',
        'Mar',
        'Abr',
        'May',
        'Jun',
        'Jul',
        'Ago',
        'Sep',
        'Oct',
        'Nov',
        'Dic',
      ],
      transferManagement: mockTransferManagement,
      viewStates: {
        modals: {
          form: false,
          status: false,
          transfer: false,
          cancel: false,
          questionnaire: false,
          package: false,
        },
        selectedTransfer: mockTransferManagement.transfers[0],
        selectedHospitalId: 'hospital-salvador',
        isGenerating: false,
        generatedDocs: [],
        patientDataForDocs: null,
        handlers: mockViewHandlers,
      },
      periodModel: {
        availableYears: [2026],
        filteredActiveCount: activeTransfers.length,
        activeTransfers: [...activeTransfers],
        finalizedTransfers: [...finalizedTransfers],
      },
      selectedHospital: { id: 'hospital-salvador', name: 'Hospital Del Salvador' },
    };
  },
}));

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordData: () => ({ record: null }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    role: 'admin',
    currentUser: {
      email: 'admin@hospital.cl',
    },
  }),
}));

vi.mock('@/hooks/useTransferManagement', () => ({
  useTransferManagement: () => ({
    transfers: [...activeTransfers, ...finalizedTransfers],
    isLoading: false,
    error: null,
    createTransfer: vi.fn(),
    updateTransfer: mockUpdateTransfer,
    advanceStatus: vi.fn(),
    setTransferStatus: vi.fn(),
    markAsTransferred: vi.fn(),
    cancelTransfer: vi.fn(),
    deleteTransfer: vi.fn(),
    undoTransfer: vi.fn(),
    archiveTransfer: vi.fn(),
    deleteHistoryEntry: vi.fn(),
    getHospitalizedPatients: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('@/hooks/useTransferViewStates', () => ({
  useTransferViewStates: () => ({
    modals: {
      form: false,
      status: false,
      transfer: false,
      cancel: false,
      questionnaire: false,
      package: false,
    },
    selectedTransfer: null,
    selectedHospitalId: 'hospital-salvador',
    isGenerating: false,
    generatedDocs: [],
    patientDataForDocs: null,
    handlers: {
      handleNewRequest: vi.fn(),
      handleEditTransfer: vi.fn(),
      handleCloseFormModal: vi.fn(),
      handleSave: vi.fn(),
      handleStatusChange: vi.fn(),
      handleCloseStatusModal: vi.fn(),
      handleConfirmStatusChange: vi.fn(),
      handleMarkTransferred: vi.fn(),
      handleCloseTransferModal: vi.fn(),
      handleConfirmTransfer: vi.fn(),
      handleCancel: vi.fn(),
      handleCloseCancelModal: vi.fn(),
      handleConfirmCancel: vi.fn(),
      handleGenerateDocs: vi.fn(),
      handleCloseQuestionnaire: vi.fn(),
      handleQuestionnaireComplete: vi.fn(),
      handleViewDocs: vi.fn(),
      handleClosePackageModal: vi.fn(),
    },
  }),
}));

vi.mock('@/constants/hospitalConfigs', async importOriginal => {
  const actual = await importOriginal<typeof import('@/constants/hospitalConfigs')>();
  return {
    ...actual,
    getHospitalConfigById: vi
      .fn()
      .mockReturnValue({ id: 'hospital-salvador', name: 'Hospital Del Salvador' }),
  };
});

describe('TransferManagementView grouping', () => {
  it('separates active and finalized transfers using the expected statuses', () => {
    render(<TransferManagementView />);

    expect(screen.getByText('Paciente solicitado')).toBeInTheDocument();
    expect(screen.getByText('Paciente recepcionado')).toBeInTheDocument();
    expect(screen.getByText('Paciente aceptado')).toBeInTheDocument();
    expect(screen.getByText('Cama: H1')).toBeInTheDocument();
    expect(screen.getAllByText('Dg: Dx').length).toBeGreaterThan(0);
    expect(screen.getByText('Nota de coordinación inicial')).toBeInTheDocument();
    expect(screen.getByText('05-06-2026')).toBeInTheDocument();
    expect(screen.queryByText('04-06-2026')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /completar traslado/i })).toHaveAttribute(
      'title',
      'Configurar traslado como completado (egreso)'
    );

    expect(screen.queryByText('Paciente trasladado')).not.toBeInTheDocument();
    expect(screen.queryByText('Paciente cancelado')).not.toBeInTheDocument();
    expect(screen.queryByText('Paciente rechazado')).not.toBeInTheDocument();
    expect(screen.queryByText('Paciente sin respuesta')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /traslados finalizados/i }));

    expect(screen.getByText('Paciente trasladado')).toBeInTheDocument();
    expect(screen.getByText('Paciente cancelado')).toBeInTheDocument();
    expect(screen.getByText('Paciente rechazado')).toBeInTheDocument();
    expect(screen.getByText('Paciente sin respuesta')).toBeInTheDocument();
  });
});
