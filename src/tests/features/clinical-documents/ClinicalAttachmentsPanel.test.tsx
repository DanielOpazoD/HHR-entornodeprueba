import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalAttachmentsPanel } from '@/features/clinical-documents/components/ClinicalAttachmentsPanel';
import type { ClinicalAttachmentRecord } from '@/features/clinical-documents/domain/entities';

const actor = {
  uid: 'u1',
  email: 'doctor@example.com',
  displayName: 'Doctor',
  role: 'doctor_urgency',
};

const buildAttachment = (
  override: Partial<ClinicalAttachmentRecord> = {}
): ClinicalAttachmentRecord => ({
  id: 'att_1',
  hospitalId: 'hhr',
  patientRut: '13.545.665-9',
  patientRutKey: '13545665-9',
  patientName: 'Paciente Test',
  episodeKey: 'episode-1',
  storagePath: 'clinical-attachments/hhr/rut/episode/att_1/informe.pdf',
  downloadUrl: 'https://storage.test/informe.pdf',
  originalFileName: 'informe.pdf',
  displayName: 'Informe externo.pdf',
  contentType: 'application/pdf',
  fileKind: 'pdf',
  sizeBytes: 1024,
  status: 'active',
  createdAt: '2026-05-21T10:00:00.000Z',
  createdBy: actor,
  updatedAt: '2026-05-21T10:00:00.000Z',
  updatedBy: actor,
  ...override,
});

describe('ClinicalAttachmentsPanel', () => {
  it('presents storage files as episode files with contextual scope', async () => {
    const onUploadAttachment = vi.fn(async () => undefined);
    const onDeleteAttachment = vi.fn(async () => undefined);
    const onRenameAttachment = vi.fn(async () => undefined);
    const onRegenerateAttachmentAccess = vi.fn(async () => undefined);
    const onSuggestAttachmentName = vi.fn(async () => null);

    render(
      <ClinicalAttachmentsPanel
        canEdit={true}
        currentDocumentId="doc-current"
        currentEpisodeKey="episode-1"
        attachments={[
          buildAttachment({ documentId: 'doc-current' }),
          buildAttachment({
            id: 'att_2',
            displayName: 'Foto clínica.jpg',
            fileKind: 'image',
            contentType: 'image/jpeg',
            sizeBytes: 700 * 1024,
            documentId: 'doc-other',
          }),
        ]}
        patientAttachments={[]}
        isLoading={false}
        isLoadingPatientAttachments={false}
        isUploading={false}
        uploadStatusMessage={null}
        onUploadAttachment={onUploadAttachment}
        onDeleteAttachment={onDeleteAttachment}
        onRenameAttachment={onRenameAttachment}
        onRegenerateAttachmentAccess={onRegenerateAttachmentAccess}
        onSuggestAttachmentName={onSuggestAttachmentName}
      />
    );

    expect(
      screen.getByRole('heading', { name: /archivos globales del episodio/i })
    ).toBeInTheDocument();
    expect(document.querySelector('.clinical-document-attachments-panel')).toHaveClass(
      'mx-auto',
      'w-full',
      'max-w-[900px]'
    );
    expect(document.querySelector('.clinical-document-attachments-header')).toHaveClass(
      'flex-wrap'
    );
    expect(document.querySelector('.clinical-document-attachments-title')).toHaveClass('min-w-0');
    expect(screen.getByRole('button', { name: /adjuntar/i })).toHaveClass('shrink-0');
    expect(document.querySelector('.clinical-document-attachment-row')).toHaveClass(
      'min-w-0',
      'overflow-hidden'
    );
    expect(screen.getByText(/no forman parte del documento actual/i)).toBeInTheDocument();
    expect(screen.queryByText(/adjuntos de este documento/i)).not.toBeInTheDocument();
    expect(screen.getByText('Informe externo.pdf')).toBeInTheDocument();
    expect(screen.getByText('Foto clínica.jpg')).toBeInTheDocument();
    expect(screen.getByText(/vinculado al documento/i)).toBeInTheDocument();
    expect(screen.getByText(/archivo del episodio/i)).toBeInTheDocument();
    expect(screen.getByText(/700 KB/i)).toBeInTheDocument();

    const file = new File([new Uint8Array(16)], 'nuevo.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/adjuntar archivo al episodio/i), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onUploadAttachment).toHaveBeenCalledWith(file));

    fireEvent.click(screen.getByRole('button', { name: /eliminar informe externo.pdf/i }));
    expect(onDeleteAttachment).toHaveBeenCalledWith(buildAttachment({ documentId: 'doc-current' }));
  });

  it('allows manual renaming and AI name suggestion for an attachment', async () => {
    const onRenameAttachment = vi.fn(async () => undefined);
    const onSuggestAttachmentName = vi.fn(async () => 'Eco abdominal ingreso.pdf');

    render(
      <ClinicalAttachmentsPanel
        canEdit={true}
        currentDocumentId="doc-current"
        currentEpisodeKey="episode-1"
        attachments={[buildAttachment({ documentId: 'doc-current' })]}
        patientAttachments={[]}
        isLoading={false}
        isLoadingPatientAttachments={false}
        isUploading={false}
        uploadStatusMessage={null}
        onUploadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onRenameAttachment={onRenameAttachment}
        onRegenerateAttachmentAccess={vi.fn()}
        onSuggestAttachmentName={onSuggestAttachmentName}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /renombrar informe externo.pdf/i }));
    fireEvent.change(screen.getByLabelText(/nombre visible del archivo/i), {
      target: { value: 'Informe cardiologia.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar nombre/i }));

    await waitFor(() =>
      expect(onRenameAttachment).toHaveBeenCalledWith(
        buildAttachment({ documentId: 'doc-current' }),
        'Informe cardiologia.pdf'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /renombrar informe externo.pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /sugerir nombre con ia/i }));

    await waitFor(() =>
      expect(onSuggestAttachmentName).toHaveBeenCalledWith(
        buildAttachment({ documentId: 'doc-current' })
      )
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre visible del archivo/i)).toHaveValue(
        'Eco abdominal ingreso.pdf'
      )
    );
  });

  it('shows empty and uploading states', () => {
    render(
      <ClinicalAttachmentsPanel
        canEdit={true}
        currentDocumentId="doc-current"
        currentEpisodeKey="episode-1"
        attachments={[]}
        patientAttachments={[]}
        isLoading={false}
        isLoadingPatientAttachments={false}
        isUploading={true}
        uploadStatusMessage="Comprimiendo imagen antes de subir..."
        onUploadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onRegenerateAttachmentAccess={vi.fn()}
        onSuggestAttachmentName={vi.fn()}
      />
    );

    expect(screen.getByText(/sin archivos del episodio/i)).toBeInTheDocument();
    expect(screen.getByText(/comprimiendo imagen/i)).toBeInTheDocument();
  });

  it('shows patient-wide attachments from other hospitalizations', () => {
    render(
      <ClinicalAttachmentsPanel
        canEdit={true}
        currentDocumentId="doc-current"
        currentEpisodeKey="episode-1"
        attachments={[buildAttachment({ documentId: 'doc-current' })]}
        patientAttachments={[
          buildAttachment({ documentId: 'doc-current' }),
          buildAttachment({
            id: 'att_other',
            displayName: 'Informe hospitalización previa.pdf',
            episodeKey: 'episode-previous',
            createdAt: '2026-04-10T10:00:00.000Z',
          }),
        ]}
        isLoading={false}
        isLoadingPatientAttachments={false}
        isUploading={false}
        uploadStatusMessage={null}
        onUploadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onRegenerateAttachmentAccess={vi.fn()}
        onSuggestAttachmentName={vi.fn()}
      />
    );

    expect(screen.getByText(/otros episodios del paciente/i)).toBeInTheDocument();
    expect(screen.getByText('Informe hospitalización previa.pdf')).toBeInTheDocument();
  });

  it('classifies patient-wide attachments by the selected episode key even when the episode list is empty', () => {
    render(
      <ClinicalAttachmentsPanel
        canEdit={true}
        currentDocumentId="doc-current"
        currentEpisodeKey="episode-1"
        attachments={[]}
        patientAttachments={[
          buildAttachment({
            id: 'att_same_episode',
            displayName: 'Informe mismo episodio.pdf',
            episodeKey: 'episode-1',
          }),
          buildAttachment({
            id: 'att_other',
            displayName: 'Informe hospitalización previa.pdf',
            episodeKey: 'episode-previous',
          }),
        ]}
        isLoading={false}
        isLoadingPatientAttachments={false}
        isUploading={false}
        uploadStatusMessage={null}
        onUploadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onRegenerateAttachmentAccess={vi.fn()}
        onSuggestAttachmentName={vi.fn()}
      />
    );

    expect(screen.queryByText('Informe mismo episodio.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('Informe hospitalización previa.pdf')).toBeInTheDocument();
  });

  it('renders unavailable files without opening a broken link and allows regenerating access', async () => {
    const onRegenerateAttachmentAccess = vi.fn(async () => undefined);
    const unavailableAttachment = buildAttachment({
      downloadUrl: undefined,
      displayName: 'Archivo migrado sin URL.pdf',
    });

    render(
      <ClinicalAttachmentsPanel
        canEdit={true}
        currentDocumentId="doc-current"
        currentEpisodeKey="episode-1"
        attachments={[unavailableAttachment]}
        patientAttachments={[]}
        isLoading={false}
        isLoadingPatientAttachments={false}
        isUploading={false}
        uploadStatusMessage={null}
        onUploadAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
        onRenameAttachment={vi.fn()}
        onRegenerateAttachmentAccess={onRegenerateAttachmentAccess}
        onSuggestAttachmentName={vi.fn()}
      />
    );

    expect(
      screen.queryByRole('link', { name: /archivo migrado sin url/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Archivo migrado sin URL.pdf')).toBeInTheDocument();
    expect(screen.getByText(/archivo no disponible/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /regenerar acceso de archivo migrado/i }));

    await waitFor(() =>
      expect(onRegenerateAttachmentAccess).toHaveBeenCalledWith(unavailableAttachment)
    );
  });
});
