import { describe, expect, it, vi } from 'vitest';

import {
  buildTransferCancelModalBindings,
  buildTransferConfirmModalBindings,
  buildTransferDocumentPackageModalBindings,
  buildTransferFinalizedSectionModel,
  buildTransferManagementPeriodModel,
  buildTransferHeaderModel,
  buildTransferMonthButtonModels,
  buildTransferProcessingOverlayModel,
  buildTransferQuestionnairePatientData,
  buildTransferQuestionnaireModalBindings,
  buildTransferStatusModalBindings,
  buildTransferTableActions,
  buildTransferTableSectionModel,
  buildTransferTableBindings,
  buildTransferYearButtonModels,
} from '@/features/transfers/components/controllers/transferManagementViewController';
import type { TransferFormData, TransferRequest } from '@/types/transferRequestTypes';
import type { TransferStatus } from '@/types/transferStatusTypes';

const buildTransfer = (overrides: Partial<TransferRequest> = {}): TransferRequest =>
  ({
    id: 'TR-1',
    requestDate: '2026-03-10',
    status: 'REQUESTED',
    statusHistory: [],
    ...overrides,
  }) as TransferRequest;

describe('transferManagementViewController', () => {
  it('keeps active requests scoped to their request month', () => {
    const model = buildTransferManagementPeriodModel({
      transfers: [
        buildTransfer({ id: 'TR-FEB', requestDate: '2026-02-15', status: 'REQUESTED' }),
        buildTransfer({ id: 'TR-MAR', requestDate: '2026-03-01', status: 'REQUESTED' }),
      ],
      selectedYear: 2026,
      selectedMonth: 3,
      currentYear: 2026,
    });

    expect(model.activeTransfers.map(transfer => transfer.id)).toEqual(['TR-MAR']);
    expect(model.filteredActiveCount).toBe(1);
  });

  it('keeps finalized requests only when requested or closed inside the selected month', () => {
    const model = buildTransferManagementPeriodModel({
      transfers: [
        buildTransfer({
          id: 'TR-OLD',
          requestDate: '2026-01-10',
          status: 'TRANSFERRED',
          statusHistory: [{ timestamp: '2026-01-11T10:00:00.000Z' }] as never,
        }),
        buildTransfer({
          id: 'TR-CLOSED-IN-PERIOD',
          requestDate: '2026-02-27',
          status: 'TRANSFERRED',
          statusHistory: [{ timestamp: '2026-03-02T10:00:00.000Z' }] as never,
        }),
      ],
      selectedYear: 2026,
      selectedMonth: 3,
      currentYear: 2026,
    });

    expect(model.finalizedTransfers.map(transfer => transfer.id)).toEqual(['TR-CLOSED-IN-PERIOD']);
  });

  it('builds reusable table bindings for active and finalized tables', async () => {
    const transfer = buildTransfer({ id: 'TR-ACTIVE' });
    const setTransferStatus =
      vi.fn<(transfer: TransferRequest, status: TransferStatus) => Promise<void>>();
    const updateTransfer =
      vi.fn<(transferId: string, data: Partial<TransferFormData>) => Promise<void>>();
    const undoTransfer = vi.fn<(transfer: TransferRequest) => Promise<void>>();
    const archiveTransfer = vi.fn<(transfer: TransferRequest) => Promise<void>>();
    const deleteHistoryEntry =
      vi.fn<(transfer: TransferRequest, historyIndex: number) => Promise<void>>();
    const deleteTransfer = vi.fn<(transferId: string) => Promise<void>>();
    const handlers = {
      handleEditTransfer: vi.fn(),
      handleStatusChange: vi.fn(),
      handleMarkTransferred: vi.fn(),
      handleCancel: vi.fn(),
      handleGenerateDocs: vi.fn(),
      handleViewDocs: vi.fn(),
    };

    const deleteFinalizedTransfer = vi.fn<(id: string) => Promise<void>>();
    const activeBindings = buildTransferTableBindings({
      transfers: [transfer],
      handlers,
      actions: {
        setTransferStatus,
        updateTransfer,
        undoTransfer,
        archiveTransfer,
        deleteHistoryEntry,
        deleteTransfer,
        deleteFinalizedTransfer,
      },
    });
    const finalizedBindings = buildTransferTableBindings({
      transfers: [transfer],
      mode: 'finalized',
      handlers,
      actions: {
        setTransferStatus,
        updateTransfer,
        undoTransfer,
        archiveTransfer,
        deleteHistoryEntry,
        deleteTransfer,
        deleteFinalizedTransfer,
      },
    });

    expect(activeBindings.emptyMessage).toBe(
      'No hay solicitudes activas de traslado para este período'
    );
    expect(finalizedBindings.emptyMessage).toBe('No hay traslados finalizados para este período');

    await activeBindings.onDelete(transfer);
    expect(deleteTransfer).toHaveBeenCalledWith('TR-ACTIVE');
    expect(finalizedBindings.mode).toBe('finalized');
  });

  it('builds questionnaire patient data from the selected transfer snapshot', () => {
    const transfer = buildTransfer({
      bedId: 'BED_H3',
      patientSnapshot: {
        name: 'Paciente Demo',
        rut: '12.345.678-9',
        age: 34,
        sex: 'M',
        diagnosis: 'Neumonía',
        admissionDate: '2026-03-02',
      },
    });

    expect(buildTransferQuestionnairePatientData(transfer)).toEqual({
      patientName: 'Paciente Demo',
      rut: '12.345.678-9',
      admissionDate: '2026-03-02',
      diagnosis: 'Neumonía',
      bedName: 'H3',
      bedType: 'Básica',
      isUPC: false,
      originHospital: 'Hospital Hanga Roa',
    });
  });

  it('builds period selector and finalized section models for the view shell', () => {
    expect(
      buildTransferHeaderModel({
        filteredActiveCount: 3,
      })
    ).toEqual({
      title: 'Gestión de Traslados',
      activeCountLabel: '3 solicitudes activas',
      newRequestLabel: 'Nueva Solicitud',
    });

    expect(
      buildTransferYearButtonModels({
        availableYears: [2026, 2025],
        selectedYear: 2026,
      })
    ).toEqual([
      { key: 2026, value: 2026, label: '2026', isSelected: true },
      { key: 2025, value: 2025, label: '2025', isSelected: false },
    ]);

    expect(
      buildTransferMonthButtonModels({
        monthLabels: ['Ene', 'Feb', 'Mar'],
        selectedMonth: 2,
      })
    ).toEqual([
      { key: 'Ene', value: 1, label: 'Ene', isSelected: false },
      { key: 'Feb', value: 2, label: 'Feb', isSelected: true },
      { key: 'Mar', value: 3, label: 'Mar', isSelected: false },
    ]);

    expect(
      buildTransferFinalizedSectionModel({
        finalizedTransfersCount: 4,
        showFinalizedTransfers: true,
        isLoading: false,
      })
    ).toEqual({
      title: 'Traslados Finalizados',
      description: 'Efectivos y cancelados del mes seleccionado',
      countLabel: '4',
      shouldShowContent: true,
      toggleIcon: 'down',
      shouldShowLoadingState: false,
      loadingMessage: 'Cargando traslados finalizados...',
    });

    expect(
      buildTransferTableSectionModel({
        isLoading: true,
        loadingMessage: 'Cargando solicitudes...',
      })
    ).toEqual({
      shouldShowLoadingState: true,
      loadingMessage: 'Cargando solicitudes...',
    });
  });

  it('builds reusable table actions and modal bindings for transfer orchestration', () => {
    const transfer = buildTransfer({
      id: 'TR-MODAL',
      bedId: 'BED_H4',
      questionnaireResponses: [{ questionId: 'q1', answer: 'si' }] as never,
      patientSnapshot: {
        name: 'Paciente Demo',
        rut: '12.345.678-9',
        age: 34,
        sex: 'M',
        diagnosis: 'Neumonía',
        admissionDate: '2026-03-02',
      },
    });
    const actions = {
      setTransferStatus: vi.fn(),
      updateTransfer: vi.fn(),
      undoTransfer: vi.fn(),
      archiveTransfer: vi.fn(),
      deleteHistoryEntry: vi.fn(),
      deleteTransfer: vi.fn(),
      deleteFinalizedTransfer: vi.fn(),
    };

    expect(buildTransferTableActions(actions)).toEqual(actions);

    expect(
      buildTransferStatusModalBindings({
        selectedTransfer: transfer,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
      })
    ).toEqual(
      expect.objectContaining({
        transfer,
      })
    );

    expect(
      buildTransferConfirmModalBindings({
        selectedTransfer: transfer,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
      })
    ).toEqual(
      expect.objectContaining({
        transfer,
      })
    );

    expect(
      buildTransferCancelModalBindings({
        selectedTransfer: transfer,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
      })
    ).toEqual(
      expect.objectContaining({
        transfer,
      })
    );

    expect(
      buildTransferQuestionnaireModalBindings({
        isOpen: true,
        selectedTransfer: transfer,
        onClose: vi.fn(),
        onComplete: vi.fn(),
      })
    ).toEqual(
      expect.objectContaining({
        isOpen: true,
        initialResponses: transfer.questionnaireResponses,
        patientData: expect.objectContaining({
          patientName: 'Paciente Demo',
        }),
      })
    );

    expect(
      buildTransferDocumentPackageModalBindings({
        isOpen: true,
        patientDataForDocs: {
          patientName: 'Paciente Docs',
          rut: '12.345.678-9',
          bedName: 'H4',
          bedType: 'Básica',
          isUPC: false,
          originHospital: 'Hospital Hanga Roa',
        },
        generatedDocs: [
          {
            templateId: 'epicrisis',
            fileName: 'epicrisis.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            blob: new Blob(['demo']),
            generatedAt: '2026-03-10T12:00:00.000Z',
          },
        ],
        onClose: vi.fn(),
      })
    ).toEqual({
      isOpen: true,
      patientData: {
        patientName: 'Paciente Docs',
        rut: '12.345.678-9',
        bedName: 'H4',
        bedType: 'Básica',
        isUPC: false,
        originHospital: 'Hospital Hanga Roa',
      },
      documents: [
        {
          templateId: 'epicrisis',
          fileName: 'epicrisis.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          blob: expect.any(Blob),
          generatedAt: '2026-03-10T12:00:00.000Z',
        },
      ],
      onClose: expect.any(Function),
    });
  });

  it('builds form and processing overlay bindings with stable copy', () => {
    expect(buildTransferProcessingOverlayModel()).toEqual({
      title: 'Preparando documentos',
      description: 'Esto puede tomar unos segundos',
    });
  });
});
