import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { WoundCareModal } from '@/features/wound-care/components/WoundCareModal';
import { useWoundCareUpload } from '@/features/wound-care/hooks/useWoundCareUpload';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';
import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
} from '@/features/wound-care/use-cases/woundCarePort';

const uploadPhotoUseCaseMock = vi.fn();
const uploadConsentUseCaseMock = vi.fn();
const deletePhotoUseCaseMock = vi.fn();
const executeUpdatePhotoDescriptionMock = vi.fn();
const listPhotosByPatientRutMock = vi.fn();
const listConsentsByPatientRutMock = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: {
      uid: 'u-1',
      email: 'enfermeria@hospital.cl',
      displayName: 'Enfermería Prueba',
    },
    role: 'nurse_hospital',
  }),
}));

vi.mock('@/constants/firestorePaths', () => ({
  getActiveHospitalId: () => 'hanga-roa',
}));

vi.mock('@/features/wound-care/use-cases/woundCarePort', () => ({
  defaultWoundCarePhotoPort: {
    listByPatientRut: (...args: unknown[]) => listPhotosByPatientRutMock(...args),
  } as unknown as WoundCarePhotoPort,
  defaultWoundCareConsentPort: {
    listByPatientRut: (...args: unknown[]) => listConsentsByPatientRutMock(...args),
  } as unknown as WoundCareConsentPort,
}));

vi.mock('@/features/wound-care/use-cases/woundCareUseCases', () => ({
  executeUploadWoundCarePhoto: (...args: unknown[]) => uploadPhotoUseCaseMock(...args),
  executeUploadWoundCareConsent: (...args: unknown[]) => uploadConsentUseCaseMock(...args),
  executeDeleteWoundCarePhoto: (...args: unknown[]) => deletePhotoUseCaseMock(...args),
  executeUpdatePhotoDescription: (...args: unknown[]) => executeUpdatePhotoDescriptionMock(...args),
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sampleActor = {
  uid: 'u-1',
  email: 'enfermeria@hospital.cl',
  displayName: 'Enfermería Prueba',
  role: 'nurse_hospital',
};

const makePhoto = (id: string, episodeKey: string, description: string): WoundCarePhoto => ({
  id,
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
  episodeKey,
  storagePath: `photos/${id}.webp`,
  thumbnailStoragePath: `photos/${id}-thumb.webp`,
  downloadUrl: `https://example.test/${id}.webp`,
  thumbnailDownloadUrl: `https://example.test/${id}-thumb.webp`,
  mimeType: 'image/webp',
  originalFileSize: 10000,
  compressedFileSize: 3000,
  width: 800,
  height: 600,
  description,
  takenAt: id === 'photo-a' ? '2026-04-01T10:05:00Z' : '2026-04-01T10:06:00Z',
  uploadedAt: id === 'photo-a' ? '2026-04-01T10:05:00Z' : '2026-04-01T10:06:00Z',
  uploadedBy: sampleActor,
  isDeleted: false,
});

const episodeAt10 = {
  episodeKey: '11.111.111-1__2026-04-01__10:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const episodeAt11 = {
  episodeKey: '11.111.111-1__2026-04-01__11:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const signedConsent: WoundCareConsent = {
  id: 'consent-1',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
  episodeKey: episodeAt10.episodeKey,
  status: 'signed',
  consentFileStoragePath: 'consents/c1.pdf',
  consentFileDownloadUrl: 'https://example.test/c1.pdf',
  consentFileMimeType: 'application/pdf',
  consentFileSize: 2048,
  signedAt: '2026-04-01T09:00:00Z',
  uploadedAt: '2026-04-01T09:05:00Z',
  uploadedBy: sampleActor,
};

describe('WoundCareModal write confirmations & concurrency resilience', () => {
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useRealTimers();
    uploadPhotoUseCaseMock.mockReset();
    uploadConsentUseCaseMock.mockReset();
    deletePhotoUseCaseMock.mockReset();
    executeUpdatePhotoDescriptionMock.mockReset();
    listPhotosByPatientRutMock.mockReset();
    listConsentsByPatientRutMock.mockReset();

    listPhotosByPatientRutMock.mockResolvedValue([
      makePhoto('photo-a', episodeAt10.episodeKey, 'Curación A'),
      makePhoto('photo-b', episodeAt10.episodeKey, 'Curación B'),
    ]);
    listConsentsByPatientRutMock.mockResolvedValue([]);

    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview');
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('does not reload or confirm consent upload when canceling or closing an already signed consent', async () => {
    listConsentsByPatientRutMock.mockResolvedValueOnce([]);

    const { unmount } = render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    expect(listPhotosByPatientRutMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    expect(screen.getByText('Consentimiento Informado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByText('Consentimiento Informado')).not.toBeInTheDocument();
    expect(uploadConsentUseCaseMock).not.toHaveBeenCalled();
    expect(listPhotosByPatientRutMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Consentimiento guardado')).not.toBeInTheDocument();

    unmount();

    listConsentsByPatientRutMock.mockResolvedValueOnce([signedConsent]);
    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    const callsBeforeView = listPhotosByPatientRutMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    expect(screen.getByText('Ver documento PDF')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: /cerrar modal/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(listPhotosByPatientRutMock).toHaveBeenCalledTimes(callsBeforeView);
    expect(screen.queryByText('Consentimiento guardado')).not.toBeInTheDocument();
  });

  it('locks upload fields while uploading and closes on accredited write even if admission time changes mid-upload', async () => {
    const deferredPhoto = createDeferred<{ status: 'success'; data: null; issues: [] }>();
    uploadPhotoUseCaseMock.mockReturnValueOnce(deferredPhoto.promise);

    const { rerender } = render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    const photoInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const photoFile = new File(['jpg-bytes'], 'herida.jpg', { type: 'image/jpeg' });
    fireEvent.change(photoInput, { target: { files: [photoFile] } });

    const descBox = screen.getByPlaceholderText(
      /Curación de herida operatoria/i
    ) as HTMLTextAreaElement;
    fireEvent.change(descBox, { target: { value: 'Texto original' } });
    fireEvent.click(screen.getByRole('button', { name: /subir fotografía/i }));

    expect(descBox).toBeDisabled();

    // Admission time is corrected while the first write is still in flight.
    rerender(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt11.patientName}
        patientRut={episodeAt11.patientRut}
        episodeContext={episodeAt11}
      />
    );

    await act(async () => {
      deferredPhoto.resolve({ status: 'success', data: null, issues: [] });
    });

    await waitFor(() => {
      expect(screen.getByText('Foto subida exitosamente')).toBeInTheDocument();
    });
    expect(screen.queryByText('Subir Foto de Curación')).not.toBeInTheDocument();
    expect(uploadPhotoUseCaseMock).toHaveBeenCalledTimes(1);
  });

  it('closes consent modal on accredited write even if admission time changes mid-upload, and locks file input while uploading', async () => {
    const deferredConsent = createDeferred<{ status: 'success'; data: null; issues: [] }>();
    uploadConsentUseCaseMock.mockReturnValueOnce(deferredConsent.promise);

    const { rerender } = render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));

    const fileInputs = document.querySelectorAll('input[type="file"]');
    const consentInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    const pdfFile = new File(['%PDF'], 'consentimiento.pdf', { type: 'application/pdf' });
    fireEvent.change(consentInput, { target: { files: [pdfFile] } });

    fireEvent.click(screen.getByRole('button', { name: /subir consentimiento/i }));
    expect(consentInput).toBeDisabled();

    rerender(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt11.patientName}
        patientRut={episodeAt11.patientRut}
        episodeContext={episodeAt11}
      />
    );

    await act(async () => {
      deferredConsent.resolve({ status: 'success', data: null, issues: [] });
    });

    await waitFor(() => {
      expect(screen.getByText('Consentimiento guardado')).toBeInTheDocument();
    });
    expect(screen.queryByText('Consentimiento Informado')).not.toBeInTheDocument();
    expect(uploadConsentUseCaseMock).toHaveBeenCalledTimes(1);
  });

  it('preserves draft in photo B when description confirmation for photo A triggers background reload', async () => {
    const deferredSaveA = createDeferred<{ status: 'success'; data: null; issues: [] }>();
    executeUpdatePhotoDescriptionMock.mockReturnValueOnce(deferredSaveA.promise);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    fireEvent.click(screen.getByAltText('Curación A').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));
    fireEvent.change(screen.getByPlaceholderText('Agregar descripción...'), {
      target: { value: 'Descripción A nueva' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripción' }));

    // Navigate to photo B while A is still saving, and type a new draft on B.
    fireEvent.click(screen.getByRole('button', { name: 'Foto siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));
    const inputB = screen.getByPlaceholderText('Agregar descripción...');
    fireEvent.change(inputB, { target: { value: 'Borrador en progreso B' } });

    // Photo A resolves and triggers background reload.
    listPhotosByPatientRutMock.mockResolvedValueOnce([
      makePhoto('photo-a', episodeAt10.episodeKey, 'Descripción A nueva'),
      makePhoto('photo-b', episodeAt10.episodeKey, 'Curación B'),
    ]);

    await act(async () => {
      deferredSaveA.resolve({ status: 'success', data: null, issues: [] });
    });

    await waitFor(() => {
      expect(screen.getByText('Descripción actualizada')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('dialog', { name: 'Visor de fotografías de curaciones' })
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Agregar descripción...')).toHaveValue(
      'Borrador en progreso B'
    );
  });

  it('handles failed description save with Escape on body without closing WoundCareModal, and removes editor if episode becomes historical', async () => {
    const onCloseModal = vi.fn();
    executeUpdatePhotoDescriptionMock.mockResolvedValueOnce({
      status: 'failed',
      data: null,
      issues: [{ kind: 'unknown', message: 'Error de red al guardar descripción.' }],
    });

    const { rerender } = render(
      <WoundCareModal
        isOpen
        onClose={onCloseModal}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    fireEvent.click(screen.getByAltText('Curación A').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));
    fireEvent.change(screen.getByPlaceholderText('Agregar descripción...'), {
      target: { value: 'Bordes limpios' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripción' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error de red al guardar descripción.');
    });

    // Simulate Chromium dropping focus to document.body after disabling the clicked button.
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onCloseModal).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Agregar descripción...')).not.toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Visor de fotografías de curaciones' })
    ).toBeInTheDocument();

    // Start another edit and change admission time mid-flight so episode becomes read-only.
    const deferredFail = createDeferred<{
      status: 'failed';
      data: null;
      issues: [{ kind: 'unknown'; message: string }];
    }>();
    executeUpdatePhotoDescriptionMock.mockReturnValueOnce(deferredFail.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripción' }));

    rerender(
      <WoundCareModal
        isOpen
        onClose={onCloseModal}
        patientName={episodeAt11.patientName}
        patientRut={episodeAt11.patientRut}
        episodeContext={episodeAt11}
      />
    );

    await act(async () => {
      deferredFail.resolve({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Fallo tardío en episodio anterior.' }],
      });
    });

    expect(screen.queryByRole('button', { name: 'Guardar descripción' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Fallo tardío en episodio anterior.');
  });

  it('keeps delete confirm open with inline alert on failure, blocks cancel while deleting, and closes only on success', async () => {
    const deferredDelete = createDeferred<{
      status: 'failed' | 'success';
      data: null;
      issues: Array<{ kind: 'unknown'; message: string }>;
    }>();
    deletePhotoUseCaseMock
      .mockReturnValueOnce(deferredDelete.promise)
      .mockResolvedValueOnce({ status: 'success', data: null, issues: [] });

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeAt10.patientName}
        patientRut={episodeAt10.patientRut}
        episodeContext={episodeAt10}
      />
    );

    await screen.findByAltText('Curación A');
    fireEvent.click(screen.getAllByTitle('Eliminar foto')[0]);
    expect(screen.getByText('Eliminar fotografía')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();

    await act(async () => {
      deferredDelete.resolve({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Sin conexión para eliminar.' }],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión para eliminar.');
    });
    expect(screen.getByRole('button', { name: 'Cancelar' })).not.toBeDisabled();
    expect(screen.queryByText('Foto eliminada')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));

    await waitFor(() => {
      expect(screen.getByText('Foto eliminada')).toBeInTheDocument();
    });
    expect(screen.queryByText('Eliminar fotografía')).not.toBeInTheDocument();
    expect(deletePhotoUseCaseMock).toHaveBeenCalledTimes(2);
  });

  it('aborts scheduled upload retry when unmounted or canceled mid-flight', async () => {
    vi.useFakeTimers();
    const deferredFirstAttempt = createDeferred<{
      status: 'failed';
      data: null;
      issues: [{ kind: 'unknown'; message: string }];
    }>();
    uploadConsentUseCaseMock.mockReturnValueOnce(deferredFirstAttempt.promise);

    const { result, unmount } = renderHook(() => useWoundCareUpload());
    const pdfFile = new File(['%PDF'], 'consentimiento.pdf', { type: 'application/pdf' });

    let uploadPromise!: Promise<{ success: boolean; error?: string }>;
    act(() => {
      uploadPromise = result.current.uploadConsent(pdfFile, episodeAt10);
    });

    // User cancels / unmounts modal while first attempt is still in flight.
    unmount();

    await act(async () => {
      deferredFirstAttempt.resolve({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Fallo transitorio.' }],
      });
      await vi.advanceTimersByTimeAsync(2000);
    });

    const outcome = await uploadPromise;
    expect(outcome.success).toBe(false);
    expect(uploadConsentUseCaseMock).toHaveBeenCalledTimes(1);
  });
});
