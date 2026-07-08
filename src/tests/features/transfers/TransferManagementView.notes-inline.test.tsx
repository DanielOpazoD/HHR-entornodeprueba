import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
] as const;

const mockTransferManagement = {
  transfers: [...activeTransfers],
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
        finalizedTransfers: [],
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
    transfers: [...activeTransfers],
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

describe('TransferManagementView inline notes', () => {
  it('allows admin users to add, edit and remove transfer notes inline', async () => {
    render(<TransferManagementView />);

    fireEvent.click(screen.getByRole('button', { name: /agregar nota/i }));
    fireEvent.change(screen.getByLabelText(/agregar nota/i), {
      target: { value: 'Nueva nota administrativa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar nota/i }));

    await waitFor(() => {
      expect(mockUpdateTransfer).toHaveBeenCalledWith(
        'tr-requested',
        expect.objectContaining({
          transferNotes: expect.arrayContaining([
            expect.objectContaining({ content: 'Nueva nota administrativa' }),
          ]),
        })
      );
    });

    fireEvent.click(screen.getByTitle('Editar nota'));
    fireEvent.change(screen.getByLabelText(/editar nota note-1/i), {
      target: { value: 'Nota actualizada por admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar nota/i }));

    await waitFor(() => {
      expect(mockUpdateTransfer).toHaveBeenCalledWith(
        'tr-requested',
        expect.objectContaining({
          transferNotes: expect.arrayContaining([
            expect.objectContaining({ id: 'note-1', content: 'Nota actualizada por admin' }),
          ]),
        })
      );
    });

    fireEvent.click(await screen.findByTitle('Eliminar nota'));

    await waitFor(() => {
      expect(mockUpdateTransfer).toHaveBeenCalledWith('tr-requested', {
        transferNotes: [],
      });
    });
  });
});
