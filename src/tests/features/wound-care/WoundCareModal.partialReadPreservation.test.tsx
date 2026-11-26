import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WoundCareModal } from '@/features/wound-care/components/WoundCareModal';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';
import type {
  WoundCareConsentPort,
  WoundCarePhotoPort,
} from '@/features/wound-care/use-cases/woundCarePort';

const listPhotosByPatientRutMock = vi.fn();
const listConsentsByPatientRutMock = vi.fn();
const uploadConsentUseCaseMock = vi.fn();
const updatePhotoDescriptionMock = vi.fn();

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
  executeUploadWoundCarePhoto: vi.fn(),
  executeUploadWoundCareConsent: (...args: unknown[]) => uploadConsentUseCaseMock(...args),
  executeDeleteWoundCarePhoto: vi.fn(),
  executeUpdatePhotoDescription: (...args: unknown[]) => updatePhotoDescriptionMock(...args),
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

const episodeContext = {
  episodeKey: '11.111.111-1__2026-04-01__10:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const secondEpisodeContext = {
  episodeKey: '11.111.111-1__2026-04-02__08:00',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const samplePhoto: WoundCarePhoto = {
  id: 'photo-1',
  patientRut: episodeContext.patientRut,
  patientName: episodeContext.patientName,
  episodeKey: episodeContext.episodeKey,
  storagePath: 'photos/1.webp',
  thumbnailStoragePath: 'photos/1-thumb.webp',
  downloadUrl: 'https://example.test/1.webp',
  thumbnailDownloadUrl: 'https://example.test/1-thumb.webp',
  mimeType: 'image/webp',
  originalFileSize: 10000,
  compressedFileSize: 3000,
  width: 800,
  height: 600,
  description: 'Curación de prueba',
  takenAt: '2026-04-01T10:05:00Z',
  uploadedAt: '2026-04-01T10:05:00Z',
  uploadedBy: sampleActor,
  isDeleted: false,
};

const signedConsent: WoundCareConsent = {
  id: 'consent-1',
  patientRut: episodeContext.patientRut,
  patientName: episodeContext.patientName,
  episodeKey: episodeContext.episodeKey,
  status: 'signed',
  consentFileStoragePath: 'consents/c1.pdf',
  consentFileDownloadUrl: 'https://example.test/c1.pdf',
  consentFileMimeType: 'application/pdf',
  consentFileSize: 2048,
  signedAt: '2026-04-01T09:00:00Z',
  uploadedAt: '2026-04-01T09:05:00Z',
  uploadedBy: sampleActor,
};

describe('WoundCareModal partial history read preservation', () => {
  beforeEach(() => {
    listPhotosByPatientRutMock.mockReset();
    listConsentsByPatientRutMock.mockReset();
    uploadConsentUseCaseMock.mockReset();
    updatePhotoDescriptionMock.mockReset();
  });

  it('keeps photos visible, blocks duplicate consent upload, and recovers on retry when consents fail', async () => {
    listPhotosByPatientRutMock.mockResolvedValue([samplePhoto]);
    listConsentsByPatientRutMock
      .mockRejectedValueOnce(new Error('consents read failed'))
      .mockResolvedValueOnce([signedConsent]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByAltText('Curación de prueba');

    expect(screen.getByRole('alert')).toHaveTextContent(
      /no fue posible verificar el consentimiento/i
    );
    const consentButton = screen.getByRole('button', { name: /subir ci/i });
    expect(consentButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(consentButton).not.toBeDisabled();
    expect(screen.getByText('Consentimiento firmado')).toBeInTheDocument();
  });

  it('keeps signed consent visible and replaces empty photo copy with an error alert when photos fail', async () => {
    listPhotosByPatientRutMock
      .mockRejectedValueOnce(new Error('photos read failed'))
      .mockResolvedValueOnce([samplePhoto]);
    listConsentsByPatientRutMock.mockResolvedValue([signedConsent]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByText('Consentimiento firmado');

    expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    expect(screen.queryByText(/no hay fotografías en esta sesión/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin registro audiovisual/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subir ci/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await screen.findByAltText('Curación de prueba');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never renders empty audiovisual copy when both photos and consents fail', async () => {
    listPhotosByPatientRutMock.mockRejectedValueOnce(new Error('photos down'));
    listConsentsByPatientRutMock.mockRejectedValueOnce(new Error('consents down'));

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={{ ...episodeContext, episodeKey: '' }}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByRole('alert')).toHaveLength(2);
    });
    expect(screen.queryByText(/sin registro audiovisual/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no hay fotografías en esta sesión/i)).not.toBeInTheDocument();
  });

  it('blocks consent upload when a consent refresh fails and the only preserved consent is revoked', async () => {
    const revokedConsent: WoundCareConsent = {
      ...signedConsent,
      id: 'consent-revoked',
      status: 'revoked',
    };

    listPhotosByPatientRutMock
      .mockRejectedValueOnce(new Error('photos initial outage'))
      .mockResolvedValueOnce([samplePhoto]);
    listConsentsByPatientRutMock
      .mockResolvedValueOnce([revokedConsent])
      .mockRejectedValueOnce(new Error('consents refresh failed'));

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    });
    expect(screen.getByRole('button', { name: /subir ci/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    await screen.findByAltText('Curación de prueba');
    expect(screen.getByRole('alert')).toHaveTextContent(
      /no fue posible verificar el consentimiento/i
    );
    expect(screen.getByRole('button', { name: /subir ci/i })).toBeDisabled();
  });

  it('keeps photosError and retry visible even when the current hospitalization section is collapsed', async () => {
    const delayedPhotosReload = createDeferred<WoundCarePhoto[]>();
    listPhotosByPatientRutMock
      .mockRejectedValueOnce(new Error('photos initial outage'))
      .mockReturnValueOnce(delayedPhotosReload.promise);
    listConsentsByPatientRutMock.mockResolvedValue([]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    });

    // Collapse the current hospitalization section before retrying.
    fireEvent.click(screen.getByRole('button', { name: /hospitalización actual/i }));

    // Trigger retry while collapsed and reject photos again.
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    await act(async () => {
      delayedPhotosReload.reject(new Error('still failing'));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    });
    expect(screen.getByRole('button', { name: /reintentar/i })).not.toBeDisabled();
  });

  it('clears an unsent consent draft when the active episode changes and switches to view-only if target episode has a signed consent', async () => {
    const signedConsentForB: WoundCareConsent = {
      ...signedConsent,
      id: 'consent-b',
      episodeKey: secondEpisodeContext.episodeKey,
    };

    listPhotosByPatientRutMock.mockResolvedValue([samplePhoto]);
    listConsentsByPatientRutMock.mockResolvedValue([signedConsentForB]);

    const { rerender } = render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByAltText('Curación de prueba');
    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));

    const fileInputs = document.querySelectorAll('input[type="file"]');
    const consentInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    fireEvent.change(consentInput, {
      target: { files: [new File(['%PDF'], 'ci-ep-a.pdf', { type: 'application/pdf' })] },
    });
    expect(screen.getByRole('button', { name: /subir consentimiento/i })).not.toBeDisabled();

    // Switch active episode to B (which already has a signed consent).
    rerender(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={secondEpisodeContext.patientName}
        patientRut={secondEpisodeContext.patientRut}
        episodeContext={secondEpisodeContext}
      />
    );

    expect(screen.getByText('Ver documento PDF')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /subir consentimiento/i })).not.toBeInTheDocument();

    // Switch to a third episode without consent: old draft must remain cleared and submit disabled.
    rerender(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={{
          ...episodeContext,
          episodeKey: '11.111.111-1__2026-04-03__08:00',
        }}
      />
    );

    expect(screen.getByRole('button', { name: /subir consentimiento/i })).toBeDisabled();
    expect(uploadConsentUseCaseMock).not.toHaveBeenCalled();
  });

  it('blocks an already-open consent modal when background refresh fails verification or discovers a signed consent', async () => {
    const deferredDescriptionSave = createDeferred<{ status: 'success'; data: null; issues: [] }>();
    const reloadConsentsFail = createDeferred<WoundCareConsent[]>();
    const reloadConsentsSigned = createDeferred<WoundCareConsent[]>();

    listPhotosByPatientRutMock.mockResolvedValue([samplePhoto]);
    listConsentsByPatientRutMock
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(reloadConsentsFail.promise)
      .mockReturnValueOnce(reloadConsentsSigned.promise);
    updatePhotoDescriptionMock.mockReturnValueOnce(deferredDescriptionSave.promise);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByAltText('Curación de prueba');

    // Start a description save, close lightbox, and open "Subir CI" with a selected PDF.
    fireEvent.click(screen.getByAltText('Curación de prueba').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));
    fireEvent.change(screen.getByPlaceholderText('Agregar descripción...'), {
      target: { value: 'Borde limpio' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripción' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const consentInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    fireEvent.change(consentInput, {
      target: { files: [new File(['%PDF'], 'ci.pdf', { type: 'application/pdf' })] },
    });
    expect(screen.getByRole('button', { name: /subir consentimiento/i })).not.toBeDisabled();

    // Description finishes -> triggers reload -> consents verification fails.
    await act(async () => {
      deferredDescriptionSave.resolve({ status: 'success', data: null, issues: [] });
    });
    await act(async () => {
      reloadConsentsFail.reject(new Error('consents unreachable'));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /subir consentimiento/i })).toBeDisabled();
    });

    // Retry from inside the open consent modal -> server returns an existing signed consent.
    const retryButtons = screen.getAllByRole('button', { name: /reintentar/i });
    fireEvent.click(retryButtons[retryButtons.length - 1]);
    await act(async () => {
      reloadConsentsSigned.resolve([signedConsent]);
    });

    await waitFor(() => {
      expect(screen.getByText('Ver documento PDF')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /subir consentimiento/i })).not.toBeInTheDocument();
    expect(uploadConsentUseCaseMock).not.toHaveBeenCalled();
  });

  it('publishes a verified signed consent immediately during retry even while photos remain pending', async () => {
    const slowPhotosRetry = createDeferred<WoundCarePhoto[]>();
    const fastConsentsRetry = createDeferred<WoundCareConsent[]>();

    listPhotosByPatientRutMock
      .mockRejectedValueOnce(new Error('photos outage'))
      .mockReturnValueOnce(slowPhotosRetry.promise);
    listConsentsByPatientRutMock
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(fastConsentsRetry.promise);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no fue posible cargar las fotografías/i);
    });

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    // Consents resolve immediately while photos stay pending.
    await act(async () => {
      fastConsentsRetry.resolve([signedConsent]);
    });

    await waitFor(() => {
      expect(screen.getByText('Consentimiento firmado')).toBeInTheDocument();
    });

    // Opening "Subir CI" while photos are still pending must show view-only signed consent.
    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    expect(screen.getByText('Ver documento PDF')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /subir consentimiento/i })).not.toBeInTheDocument();
  });

  it('reconciles a committed consent into history and blocks duplicate upload when the modal is closed mid-upload', async () => {
    const deferredConsentUpload = createDeferred<{
      status: 'success';
      data: WoundCareConsent;
      issues: [];
    }>();
    uploadConsentUseCaseMock.mockReturnValueOnce(deferredConsentUpload.promise);

    listPhotosByPatientRutMock.mockResolvedValue([samplePhoto]);
    listConsentsByPatientRutMock.mockResolvedValueOnce([]).mockResolvedValue([signedConsent]);

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    await screen.findByAltText('Curación de prueba');
    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));

    const fileInputs = document.querySelectorAll('input[type="file"]');
    const consentInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    fireEvent.change(consentInput, {
      target: { files: [new File(['%PDF'], 'ci.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /subir consentimiento/i }));

    // User cancels/closes ConsentUploadModal while the server write is still in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Consentimiento Informado')).not.toBeInTheDocument();

    // While the first upload is still in flight, "Subir CI" stays blocked to prevent a concurrent duplicate.
    expect(screen.getByRole('button', { name: /subir ci/i })).toBeDisabled();

    // The in-flight upload finishes on the server.
    await act(async () => {
      deferredConsentUpload.resolve({
        status: 'success',
        data: signedConsent,
        issues: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Consentimiento firmado')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /subir ci/i })).not.toBeDisabled();

    // Reopening "Subir CI" shows the committed signed consent in view-only mode.
    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    expect(screen.getByText('Ver documento PDF')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /subir consentimiento/i })).not.toBeInTheDocument();
    expect(uploadConsentUseCaseMock).toHaveBeenCalledTimes(1);
  });
});
