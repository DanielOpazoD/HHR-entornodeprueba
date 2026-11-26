import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WoundCareModal } from '@/features/wound-care/components/WoundCareModal';
import type { WoundCareConsent, WoundCarePhoto } from '@/types/domain/woundCare';
import type { EpisodePhotoGroup } from '@/features/wound-care/hooks/useWoundCareHistory';

const reloadMock = vi.fn();
const uploadPhotoMock = vi.fn();
const uploadConsentMock = vi.fn();
const deletePhotoMock = vi.fn();
const executeUpdatePhotoDescriptionMock = vi.fn();

let mockedEpisodes: EpisodePhotoGroup[] = [];

vi.mock('@/features/wound-care/hooks/useWoundCareHistory', () => ({
  useWoundCareHistory: () => ({
    episodes: mockedEpisodes,
    allPhotos: mockedEpisodes.flatMap(group => group.photos),
    allConsents: mockedEpisodes.flatMap(group => (group.consent ? [group.consent] : [])),
    isLoading: false,
    reload: reloadMock,
  }),
}));

vi.mock('@/features/wound-care/hooks/useWoundCareUpload', () => ({
  useWoundCareUpload: () => ({
    uploadPhoto: uploadPhotoMock,
    uploadConsent: uploadConsentMock,
    deletePhoto: deletePhotoMock,
    progress: null,
    isUploading: false,
  }),
}));

vi.mock('@/features/wound-care/use-cases/woundCareUseCases', () => ({
  executeUpdatePhotoDescription: (...args: unknown[]) => executeUpdatePhotoDescriptionMock(...args),
}));

const episodeContext = {
  episodeKey: '11.111.111-1__2026-04-01',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
};

const sampleActor = {
  uid: 'u-1',
  email: 'enfermeria@hospital.cl',
  displayName: 'Enfermería Prueba',
  role: 'nurse_hospital',
};

const samplePhoto: WoundCarePhoto = {
  id: 'photo-1',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
  episodeKey: episodeContext.episodeKey,
  storagePath: 'photos/photo-1.webp',
  thumbnailStoragePath: 'photos/photo-1-thumb.webp',
  downloadUrl: 'https://example.test/photo-1.webp',
  thumbnailDownloadUrl: 'https://example.test/photo-1-thumb.webp',
  mimeType: 'image/webp',
  originalFileSize: 10000,
  compressedFileSize: 3000,
  width: 800,
  height: 600,
  description: 'Curación inicial',
  takenAt: '2026-04-01T10:00:00Z',
  uploadedAt: '2026-04-01T10:05:00Z',
  uploadedBy: sampleActor,
  isDeleted: false,
};

const signedConsent: WoundCareConsent = {
  id: 'consent-1',
  patientRut: '11.111.111-1',
  patientName: 'Paciente Sintético',
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

describe('WoundCareModal write confirmations', () => {
  let createObjectUrlSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectUrlSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reloadMock.mockReset();
    uploadPhotoMock.mockReset();
    uploadConsentMock.mockReset();
    deletePhotoMock.mockReset();
    executeUpdatePhotoDescriptionMock.mockReset();
    mockedEpisodes = [
      {
        episodeKey: episodeContext.episodeKey,
        photos: [samplePhoto],
        consent: undefined,
        isCurrent: true,
      },
    ];
    createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview');
    revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('does not reload or confirm consent upload when canceling or closing the consent modal', () => {
    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    expect(screen.getByText('Consentimiento Informado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByText('Consentimiento Informado')).not.toBeInTheDocument();
    expect(uploadConsentMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Consentimiento guardado')).not.toBeInTheDocument();
  });

  it('does not confirm consent upload when viewing and closing an already signed consent', () => {
    mockedEpisodes = [
      {
        episodeKey: episodeContext.episodeKey,
        photos: [samplePhoto],
        consent: signedConsent,
        isCurrent: true,
      },
    ];

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    expect(screen.getByText('Consentimiento Informado')).toBeInTheDocument();
    expect(screen.getByText('Ver documento PDF')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button', { name: /cerrar modal/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    expect(screen.queryByText('Consentimiento Informado')).not.toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Consentimiento guardado')).not.toBeInTheDocument();
  });

  it('confirms consent upload only after an accredited write and keeps error visible on failure', async () => {
    uploadConsentMock
      .mockResolvedValueOnce({ success: false, error: 'Permiso denegado en servidor.' })
      .mockResolvedValueOnce({ success: true });

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /subir ci/i }));
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const consentInput = fileInputs[fileInputs.length - 1] as HTMLInputElement;
    const pdfFile = new File(['%PDF'], 'consentimiento.pdf', { type: 'application/pdf' });
    fireEvent.change(consentInput, { target: { files: [pdfFile] } });

    fireEvent.click(screen.getByRole('button', { name: /subir consentimiento/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Permiso denegado en servidor.');
    });
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Consentimiento guardado')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /subir consentimiento/i }));

    await waitFor(() => {
      expect(screen.getByText('Consentimiento guardado')).toBeInTheDocument();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Consentimiento Informado')).not.toBeInTheDocument();
  });

  it('does not reload or confirm photo upload when canceling the photo modal, and confirms only on success', async () => {
    uploadPhotoMock
      .mockResolvedValueOnce({ success: false, error: 'Fallo al guardar imagen.' })
      .mockResolvedValueOnce({ success: true });

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    const uploadButtonInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const photoFile = new File(['jpg-bytes'], 'herida.jpg', { type: 'image/jpeg' });

    fireEvent.change(uploadButtonInput, { target: { files: [photoFile] } });
    expect(screen.getByText('Subir Foto de Curación')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Subir Foto de Curación')).not.toBeInTheDocument();
    expect(uploadPhotoMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Foto subida exitosamente')).not.toBeInTheDocument();

    fireEvent.change(uploadButtonInput, { target: { files: [photoFile] } });
    fireEvent.click(screen.getByRole('button', { name: /subir fotografía/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Fallo al guardar imagen.');
    });
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Foto subida exitosamente')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /subir fotografía/i }));

    await waitFor(() => {
      expect(screen.getByText('Foto subida exitosamente')).toBeInTheDocument();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('keeps description editor open with draft and inline alert on failure, confirming only on success', async () => {
    executeUpdatePhotoDescriptionMock
      .mockResolvedValueOnce({
        status: 'failed',
        data: null,
        issues: [{ kind: 'unknown', message: 'Error de red al guardar descripción.' }],
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: null,
        issues: [],
      });

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    fireEvent.click(screen.getByAltText('Curación inicial').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));

    const input = screen.getByPlaceholderText('Agregar descripción...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Bordes limpios sin exudado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripción' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error de red al guardar descripción.');
    });
    expect(screen.getByPlaceholderText('Agregar descripción...')).toHaveValue(
      'Bordes limpios sin exudado'
    );
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Descripción actualizada')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar descripción' }));

    await waitFor(() => {
      expect(screen.getByText('Descripción actualizada')).toBeInTheDocument();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText('Agregar descripción...')).not.toBeInTheDocument();
  });

  it('keeps delete confirmation dialog open with inline alert on failure and closes only on success', async () => {
    deletePhotoMock
      .mockResolvedValueOnce({ success: false, error: 'Sin conexión para eliminar.' })
      .mockResolvedValueOnce({ success: true });

    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    fireEvent.click(screen.getByTitle('Eliminar foto'));
    expect(screen.getByText('Eliminar fotografía')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión para eliminar.');
    });
    expect(screen.getByText('Eliminar fotografía')).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Foto eliminada')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));

    await waitFor(() => {
      expect(screen.getByText('Foto eliminada')).toBeInTheDocument();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Eliminar fotografía')).not.toBeInTheDocument();
  });

  it('cancels description editing on Escape without closing the lightbox', () => {
    render(
      <WoundCareModal
        isOpen
        onClose={vi.fn()}
        patientName={episodeContext.patientName}
        patientRut={episodeContext.patientRut}
        episodeContext={episodeContext}
      />
    );

    fireEvent.click(screen.getByAltText('Curación inicial').closest('button')!);
    expect(
      screen.getByRole('dialog', { name: 'Visor de fotografías de curaciones' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Editar descripción' }));
    const input = screen.getByPlaceholderText('Agregar descripción...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Agregar descripción...')).not.toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: 'Visor de fotografías de curaciones' })
    ).toBeInTheDocument();
  });
});
