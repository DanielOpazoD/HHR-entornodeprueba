import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentSubmissionKey,
  useDocumentScannerDemoController,
} from '@/features/document-scanner/hooks/useDocumentScannerDemoController';

const scannerMocks = vi.hoisted(() => ({
  appendPages: vi.fn(),
  createSession: vi.fn(),
  createPreview: vi.fn(),
  disposeSession: vi.fn(),
  revokePreview: vi.fn(),
  createPdf: vi.fn(),
  createUploadImages: vi.fn(),
  createCropState: vi.fn(),
  createThumbnails: vi.fn(),
  applyCrop: vi.fn(),
  applyFilter: vi.fn(),
  deletePage: vi.fn(),
  getPageFilter: vi.fn(),
  redetectPage: vi.fn(),
  reorderPage: vi.fn(),
  rotatePage: vi.fn(),
  listPatientOptions: vi.fn(),
  submitDocument: vi.fn(),
}));

vi.mock('@/features/document-scanner/services/jscanifyDocumentScannerService', () => ({
  appendJscanifyDocumentPages: scannerMocks.appendPages,
  applyDocumentScanCrop: scannerMocks.applyCrop,
  applyDocumentScanFilter: scannerMocks.applyFilter,
  createDocumentCropEditorState: scannerMocks.createCropState,
  createDocumentPageThumbnails: scannerMocks.createThumbnails,
  createDocumentScanPdf: scannerMocks.createPdf,
  createDocumentScanUploadImages: scannerMocks.createUploadImages,
  createDocumentScanPreview: scannerMocks.createPreview,
  createJscanifyDocumentSession: scannerMocks.createSession,
  deleteDocumentScanPage: scannerMocks.deletePage,
  disposeDocumentScanSession: scannerMocks.disposeSession,
  getDocumentScanPageFilter: scannerMocks.getPageFilter,
  redetectDocumentScanPage: scannerMocks.redetectPage,
  reorderDocumentScanPage: scannerMocks.reorderPage,
  revokeDocumentScanPreview: scannerMocks.revokePreview,
  rotateDocumentScanPage: scannerMocks.rotatePage,
}));

vi.mock('@/shared/document-intake/qrDocumentAccessService', () => ({
  listPatientOptionsWithPrescriptionPin: scannerMocks.listPatientOptions,
}));

vi.mock('@/features/document-scanner/services/documentScannerQueueService', () => ({
  arrayBufferToBase64: () => 'pdf-base64',
  submitScannedDocument: scannerMocks.submitDocument,
}));

describe('useDocumentScannerDemoController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scannerMocks.disposeSession.mockResolvedValue(undefined);
    scannerMocks.listPatientOptions.mockResolvedValue({
      date: '2026-07-22',
      patientOptions: [
        {
          key: 'H1C2',
          bedId: 'H1C2',
          patientName: 'Paciente Prueba',
          patientRut: '11.111.111-1',
          patientStatus: 'active',
        },
      ],
    });
    scannerMocks.createPdf.mockResolvedValue(new ArrayBuffer(8));
    scannerMocks.createUploadImages.mockResolvedValue([new ArrayBuffer(8)]);
    scannerMocks.createThumbnails.mockResolvedValue([{ pageIndex: 0, objectUrl: 'blob:thumb-1' }]);
    scannerMocks.getPageFilter.mockReturnValue('scanner');
    scannerMocks.createCropState.mockReturnValue({
      sourceObjectUrl: 'blob:source',
      corners: {
        topLeftCorner: { x: 0.1, y: 0.1 },
        topRightCorner: { x: 0.9, y: 0.1 },
        bottomLeftCorner: { x: 0.1, y: 0.9 },
        bottomRightCorner: { x: 0.9, y: 0.9 },
      },
    });
    scannerMocks.applyCrop.mockResolvedValue(undefined);
    scannerMocks.applyFilter.mockResolvedValue(undefined);
    scannerMocks.redetectPage.mockResolvedValue(undefined);
    scannerMocks.rotatePage.mockResolvedValue(undefined);
    scannerMocks.appendPages.mockImplementation(async (session, files) => {
      const firstAddedPageIndex = session.pages.length;
      session.pages.push(...files.map(() => ({ filterMode: 'scanner' })));
      return firstAddedPageIndex;
    });
    scannerMocks.submitDocument.mockResolvedValue({
      id: 'scan_1',
      createdAt: '2026-07-22T12:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates an idempotency key when randomUUID is unavailable on local HTTP', () => {
    expect(createDocumentSubmissionKey(null)).toMatch(/^[a-zA-Z0-9_-]{16,128}$/);
  });

  it('starts behind the shared QR PIN gate and loads the canonical bed options', async () => {
    const hook = renderHook(() => useDocumentScannerDemoController());
    expect(hook.result.current.phase).toBe('awaiting-pin');

    await act(async () => {
      await hook.result.current.submitPin('1313');
    });

    expect(scannerMocks.listPatientOptions).toHaveBeenCalledWith('1313');
    expect(hook.result.current.phase).toBe('ready');
    expect(hook.result.current.patientOptions).toEqual([
      expect.objectContaining({ key: 'H1C2', bedId: 'H1C2' }),
    ]);
  });

  it('explains when the callable backend is not available instead of showing internal', async () => {
    scannerMocks.listPatientOptions.mockRejectedValueOnce(
      Object.assign(new Error('internal'), { code: 'functions/internal' })
    );
    const hook = renderHook(() => useDocumentScannerDemoController());

    await act(async () => {
      await hook.result.current.submitPin('1313');
    });

    expect(hook.result.current.phase).toBe('awaiting-pin');
    expect(hook.result.current.errorMessage).toContain('servicio de acceso no está disponible');
  });

  it('uploads the processed PDF with the selected bed and keeps deletion out of the mobile flow', async () => {
    const session = { pages: [{ filterMode: 'color' }] };
    scannerMocks.createSession.mockResolvedValue(session);
    scannerMocks.createPreview.mockResolvedValue({
      objectUrl: 'blob:preview',
      pageCount: 1,
      detectedPageCount: 1,
    });
    const hook = renderHook(() => useDocumentScannerDemoController());

    await act(async () => {
      await hook.result.current.submitPin('1313');
      await hook.result.current.startScanning([
        new File(['photo'], 'documento.jpg', { type: 'image/jpeg' }),
      ]);
    });
    act(() => hook.result.current.setSelectedPatientKey('H1C2'));
    await act(async () => {
      await hook.result.current.uploadDocument();
    });

    expect(scannerMocks.submitDocument).toHaveBeenCalledWith({
      pin: '1313',
      submissionKey: expect.any(String),
      requestDate: '2026-07-22',
      sourceDate: '2026-07-22',
      patientOptionKey: 'H1C2',
      expectedPatientRut: '11.111.111-1',
      pageCount: 1,
      pageImagesBase64: ['pdf-base64'],
    });
    expect(hook.result.current.phase).toBe('success');
  });

  it('requires a new patient selection when the census changes across midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 22, 23, 59));
    const session = { pages: [{ filterMode: 'color' }] };
    scannerMocks.createSession.mockResolvedValue(session);
    scannerMocks.createPreview.mockResolvedValue({
      objectUrl: 'blob:preview',
      pageCount: 1,
      detectedPageCount: 1,
    });
    scannerMocks.listPatientOptions
      .mockResolvedValueOnce({
        date: '2026-07-22',
        patientOptions: [
          {
            key: 'H1C2',
            bedId: 'H1C2',
            patientName: 'Paciente Anterior',
            patientRut: '11.111.111-1',
            patientStatus: 'active',
          },
        ],
      })
      .mockResolvedValueOnce({
        date: '2026-07-23',
        patientOptions: [
          {
            key: 'H1C2',
            bedId: 'H1C2',
            patientName: 'Paciente Nuevo',
            patientRut: '22.222.222-2',
            patientStatus: 'active',
          },
        ],
      });
    const hook = renderHook(() => useDocumentScannerDemoController());

    await act(async () => {
      await hook.result.current.submitPin('1313');
      await hook.result.current.startScanning([
        new File(['photo'], 'documento.jpg', { type: 'image/jpeg' }),
      ]);
    });
    act(() => hook.result.current.setSelectedPatientKey('H1C2'));
    vi.setSystemTime(new Date(2026, 6, 23, 0, 1));
    await act(async () => {
      await hook.result.current.uploadDocument();
    });

    expect(scannerMocks.listPatientOptions).toHaveBeenCalledTimes(2);
    expect(scannerMocks.submitDocument).not.toHaveBeenCalled();
    expect(hook.result.current.selectedPatientKey).toBe('');
    expect(hook.result.current.errorMessage).toContain('El censo se actualizó');
    expect(hook.result.current.phase).toBe('review');
  });

  it('refreshes patient options before the first upload when the same-day census changes', async () => {
    const session = { pages: [{ filterMode: 'color' }] };
    scannerMocks.createSession.mockResolvedValue(session);
    scannerMocks.createPreview.mockResolvedValue({
      objectUrl: 'blob:preview',
      pageCount: 1,
      detectedPageCount: 1,
    });
    scannerMocks.listPatientOptions
      .mockResolvedValueOnce({
        date: '2026-07-22',
        patientOptions: [
          {
            key: 'H1C2',
            bedId: 'H1C2',
            patientName: 'Paciente Anterior',
            patientRut: '11.111.111-1',
          },
        ],
      })
      .mockResolvedValueOnce({
        date: '2026-07-22',
        patientOptions: [
          {
            key: 'H1C2',
            bedId: 'H1C2',
            patientName: 'Paciente Nuevo',
            patientRut: '22.222.222-2',
          },
        ],
      });
    const hook = renderHook(() => useDocumentScannerDemoController());

    await act(async () => {
      await hook.result.current.submitPin('1313');
      await hook.result.current.startScanning([
        new File(['photo'], 'documento.jpg', { type: 'image/jpeg' }),
      ]);
    });
    act(() => hook.result.current.setSelectedPatientKey('H1C2'));
    await act(async () => hook.result.current.uploadDocument());

    expect(scannerMocks.submitDocument).not.toHaveBeenCalled();
    expect(hook.result.current.selectedPatientKey).toBe('');
    expect(hook.result.current.errorMessage).toContain('El censo se actualizó');
  });

  it('opens the four-corner editor and regenerates the preview after applying it', async () => {
    const session = { pages: [{ filterMode: 'scanner' }] };
    scannerMocks.createSession.mockResolvedValue(session);
    scannerMocks.createPreview.mockResolvedValue({
      objectUrl: 'blob:preview',
      pageCount: 1,
      detectedPageCount: 1,
    });
    const hook = renderHook(() => useDocumentScannerDemoController());

    await act(async () => {
      await hook.result.current.submitPin('1313');
      await hook.result.current.startScanning([
        new File(['photo'], 'documento.jpg', { type: 'image/jpeg' }),
      ]);
    });
    act(() => hook.result.current.openCropEditor());
    expect(hook.result.current.phase).toBe('crop-editing');

    await act(async () => {
      await hook.result.current.applyCrop(
        scannerMocks.createCropState.mock.results[0].value.corners
      );
    });

    expect(scannerMocks.applyCrop).toHaveBeenCalledWith(
      session,
      0,
      scannerMocks.createCropState.mock.results[0].value.corners
    );
    expect(hook.result.current.phase).toBe('review');
  });

  it('adds new photos to the existing session and selects the first new page', async () => {
    const session = { pages: [{ filterMode: 'scanner' }] };
    scannerMocks.createSession.mockResolvedValue(session);
    scannerMocks.createPreview.mockImplementation(async currentSession => ({
      objectUrl: `blob:preview-${currentSession.pages.length}`,
      pageCount: currentSession.pages.length,
      detectedPageCount: currentSession.pages.length,
    }));
    scannerMocks.createThumbnails.mockImplementation(async currentSession =>
      currentSession.pages.map((_: unknown, pageIndex: number) => ({
        pageIndex,
        objectUrl: `blob:thumb-${pageIndex}`,
      }))
    );
    const hook = renderHook(() => useDocumentScannerDemoController());

    await act(async () => {
      await hook.result.current.submitPin('1313');
      await hook.result.current.startScanning([
        new File(['one'], 'pagina-1.jpg', { type: 'image/jpeg' }),
      ]);
      await hook.result.current.addPages([
        new File(['two'], 'pagina-2.jpg', { type: 'image/jpeg' }),
        new File(['three'], 'pagina-3.jpg', { type: 'image/jpeg' }),
      ]);
    });

    expect(scannerMocks.appendPages).toHaveBeenCalledWith(session, expect.any(Array));
    expect(scannerMocks.createSession).toHaveBeenCalledTimes(1);
    expect(hook.result.current.pageCount).toBe(3);
    expect(hook.result.current.selectedPageIndex).toBe(1);
    expect(hook.result.current.phase).toBe('review');
  });

  it('revokes and disposes a preview that finishes after unmount', async () => {
    const session = { pages: [] };
    let resolvePreview: ((value: object) => void) | undefined;
    const previewPromise = new Promise<object>(resolve => {
      resolvePreview = resolve;
    });
    scannerMocks.createSession.mockResolvedValue(session);
    scannerMocks.createPreview.mockReturnValue(previewPromise);

    const hook = renderHook(() => useDocumentScannerDemoController());
    let scanPromise: Promise<void> | undefined;
    act(() => {
      scanPromise = hook.result.current.startScanning([
        new File(['photo'], 'documento.jpg', { type: 'image/jpeg' }),
      ]);
    });
    await waitFor(() => expect(scannerMocks.createPreview).toHaveBeenCalledWith(session, 0));

    hook.unmount();
    resolvePreview?.({ objectUrl: 'blob:late-preview', pageCount: 1, detectedPageCount: 1 });
    await act(async () => {
      await scanPromise;
    });

    expect(scannerMocks.revokePreview).toHaveBeenCalledWith('blob:late-preview');
    expect(scannerMocks.disposeSession).toHaveBeenCalledWith(session);
  });
});
