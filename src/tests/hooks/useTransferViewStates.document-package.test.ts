import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransferViewStates } from '@/hooks/useTransferViewStates';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { generateTransferDocuments } from '@/services/transfers/documentGeneratorService';
import type { TransferRequest, TransferFormData } from '@/types/transferRequestTypes';
import type { QuestionnaireResponse } from '@/types/transferDocuments';

vi.mock('@/constants/hospitalConfigs', () => ({
  getHospitalConfigById: vi
    .fn()
    .mockReturnValue({ id: 'hospital-salvador', name: 'Hospital Salvador' }),
  getHospitalConfigByDestinationName: vi
    .fn()
    .mockReturnValue({ id: 'hospital-salvador', name: 'Hospital Salvador' }),
}));

vi.mock('@/services/transfers/documentGeneratorService', () => ({
  generateTransferDocuments: vi.fn().mockResolvedValue([]),
}));

const { mockRuntimeAlert } = vi.hoisted(() => ({
  mockRuntimeAlert: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntimeCore', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime({
      alert: mockRuntimeAlert,
    }),
  };
});

describe('useTransferViewStates document package', () => {
  let mockUpdateTransfer: (id: string, data: Partial<TransferRequest>) => Promise<void>;
  let mockCreateTransfer: (data: TransferFormData) => Promise<void>;
  let mockAdvanceStatus: (transfer: TransferRequest) => Promise<void>;
  let mockMarkAsTransferred: (transfer: TransferRequest, method: string) => Promise<void>;
  let mockCancelTransfer: (transfer: TransferRequest, reason: string) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTransfer = vi.fn().mockResolvedValue(undefined);
    mockCreateTransfer = vi.fn().mockResolvedValue(undefined);
    mockAdvanceStatus = vi.fn().mockResolvedValue(undefined);
    mockMarkAsTransferred = vi.fn().mockResolvedValue(undefined);
    mockCancelTransfer = vi.fn().mockResolvedValue(undefined);
  });

  it('should alert when document generation fails', async () => {
    const mockTransfer = {
      id: 'test-1',
      bedId: 'R1',
      patientSnapshot: {
        name: 'Paciente',
        rut: '1-9',
        age: '20',
        diagnosis: 'Dx',
        admissionDate: '2024-12-27',
      },
    } as unknown as TransferRequest;

    vi.mocked(generateTransferDocuments).mockRejectedValueOnce(new Error('Doc error'));

    const { result } = renderHook(() =>
      useTransferViewStates(
        {
          date: '2024-12-28',
          beds: { R1: { birthDate: '2000-01-01' } },
        } as unknown as DailyRecord,
        mockUpdateTransfer,
        mockCreateTransfer,
        mockAdvanceStatus,
        mockMarkAsTransferred,
        mockCancelTransfer
      )
    );

    act(() => {
      result.current.handlers.handleGenerateDocs(mockTransfer);
    });

    const emptyResponses: QuestionnaireResponse = {
      responses: [],
      completedAt: '2026-02-20T00:00:00.000Z',
      completedBy: 'test-user',
    };

    await act(async () => {
      await result.current.handlers.handleQuestionnaireComplete(emptyResponses);
    });

    expect(mockRuntimeAlert).toHaveBeenCalledWith(
      'Error al generar documentos. Por favor intente nuevamente.'
    );
  });

  it('should alert when no documents could be prepared', async () => {
    const mockTransfer = {
      id: 'test-1',
      bedId: 'R1',
      patientSnapshot: {
        name: 'Paciente',
        rut: '1-9',
        age: '20',
        diagnosis: 'Dx',
        admissionDate: '2024-12-27',
      },
    } as unknown as TransferRequest;

    vi.mocked(generateTransferDocuments).mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useTransferViewStates(
        {
          date: '2024-12-28',
          beds: { R1: { birthDate: '2000-01-01' } },
        } as unknown as DailyRecord,
        mockUpdateTransfer,
        mockCreateTransfer,
        mockAdvanceStatus,
        mockMarkAsTransferred,
        mockCancelTransfer
      )
    );

    act(() => {
      result.current.handlers.handleGenerateDocs(mockTransfer);
    });

    const emptyResponses: QuestionnaireResponse = {
      responses: [],
      completedAt: '2026-02-20T00:00:00.000Z',
      completedBy: 'test-user',
    };

    await act(async () => {
      await result.current.handlers.handleQuestionnaireComplete(emptyResponses);
    });

    expect(mockRuntimeAlert).toHaveBeenCalledWith(
      'No fue posible preparar los documentos en este momento. Verifique las plantillas o intente nuevamente en unos segundos.'
    );
    expect(result.current.modals.package).toBe(false);
  });

  it('should view existing documents without persisting questionnaire responses again', async () => {
    const generatedDocs = [
      {
        templateId: 'tapa-traslado',
        fileName: 'traslado.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob: new Blob(['demo']),
        generatedAt: '2026-03-01T00:00:00.000Z',
      },
    ];

    vi.mocked(generateTransferDocuments).mockResolvedValue(generatedDocs);

    const mockTransfer = {
      id: 'test-1',
      bedId: 'R1',
      patientSnapshot: {
        name: 'Paciente',
        rut: '1-9',
        age: '20',
        diagnosis: 'Dx',
        admissionDate: '2024-12-27',
      },
      destinationHospital: 'Hospital Salvador',
      customFields: {},
      questionnaireResponses: {
        responses: [],
        completedAt: '2026-02-20T00:00:00.000Z',
        completedBy: 'test-user',
      },
    } as unknown as TransferRequest;

    const { result } = renderHook(() =>
      useTransferViewStates(
        {
          date: '2024-12-28',
          beds: { R1: { birthDate: '2000-01-01' } },
        } as unknown as DailyRecord,
        mockUpdateTransfer,
        mockCreateTransfer,
        mockAdvanceStatus,
        mockMarkAsTransferred,
        mockCancelTransfer
      )
    );

    await act(async () => {
      await result.current.handlers.handleViewDocs(mockTransfer);
    });

    expect(mockUpdateTransfer).not.toHaveBeenCalled();
    expect(vi.mocked(generateTransferDocuments)).toHaveBeenCalledTimes(1);
    expect(result.current.modals.package).toBe(true);
  });

  it('should reuse generated documents when viewing again without changes', async () => {
    const generatedDocs = [
      {
        templateId: 'tapa-traslado',
        fileName: 'traslado.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob: new Blob(['demo']),
        generatedAt: '2026-03-01T00:00:00.000Z',
      },
    ];

    vi.mocked(generateTransferDocuments).mockResolvedValue(generatedDocs);

    const responses: QuestionnaireResponse = {
      responses: [],
      completedAt: '2026-02-20T00:00:00.000Z',
      completedBy: 'test-user',
    };

    const mockTransfer = {
      id: 'test-1',
      bedId: 'R1',
      patientSnapshot: {
        name: 'Paciente',
        rut: '1-9',
        age: '20',
        diagnosis: 'Dx',
        admissionDate: '2024-12-27',
      },
      destinationHospital: 'Hospital Salvador',
      customFields: {},
      questionnaireResponses: responses,
    } as unknown as TransferRequest;

    const { result } = renderHook(() =>
      useTransferViewStates(
        {
          date: '2024-12-28',
          beds: { R1: { birthDate: '2000-01-01' } },
        } as unknown as DailyRecord,
        mockUpdateTransfer,
        mockCreateTransfer,
        mockAdvanceStatus,
        mockMarkAsTransferred,
        mockCancelTransfer
      )
    );

    await act(async () => {
      await result.current.handlers.handleViewDocs(mockTransfer);
    });

    act(() => {
      result.current.handlers.handleClosePackageModal();
    });

    await act(async () => {
      await result.current.handlers.handleViewDocs(mockTransfer);
    });

    expect(vi.mocked(generateTransferDocuments)).toHaveBeenCalledTimes(1);
    expect(mockUpdateTransfer).not.toHaveBeenCalled();
    expect(result.current.modals.package).toBe(true);
  });

  it('should clear generated package state when closing the package modal', async () => {
    const generatedDocs = [
      {
        templateId: 'tapa-traslado',
        fileName: 'traslado.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob: new Blob(['demo']),
        generatedAt: '2026-03-01T00:00:00.000Z',
      },
    ];

    vi.mocked(generateTransferDocuments).mockResolvedValue(generatedDocs);

    const responses: QuestionnaireResponse = {
      responses: [],
      completedAt: '2026-02-20T00:00:00.000Z',
      completedBy: 'test-user',
    };

    const mockTransfer = {
      id: 'test-1',
      bedId: 'R1',
      patientSnapshot: {
        name: 'Paciente',
        rut: '1-9',
        age: '20',
        diagnosis: 'Dx',
        admissionDate: '2024-12-27',
      },
      destinationHospital: 'Hospital Salvador',
      customFields: {},
      questionnaireResponses: responses,
    } as unknown as TransferRequest;

    const { result } = renderHook(() =>
      useTransferViewStates(
        {
          date: '2024-12-28',
          beds: { R1: { birthDate: '2000-01-01' } },
        } as unknown as DailyRecord,
        mockUpdateTransfer,
        mockCreateTransfer,
        mockAdvanceStatus,
        mockMarkAsTransferred,
        mockCancelTransfer
      )
    );

    await act(async () => {
      await result.current.handlers.handleViewDocs(mockTransfer);
    });

    expect(result.current.generatedDocs).toHaveLength(1);
    expect(result.current.patientDataForDocs).not.toBeNull();

    act(() => {
      result.current.handlers.handleClosePackageModal();
    });

    expect(result.current.generatedDocs).toEqual([]);
    expect(result.current.patientDataForDocs).toBeNull();
    expect(result.current.modals.package).toBe(false);
  });
});
