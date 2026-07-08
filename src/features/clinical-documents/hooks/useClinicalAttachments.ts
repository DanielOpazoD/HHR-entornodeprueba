import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  executeDeleteClinicalAttachment,
  executeListClinicalAttachmentsByEpisode,
  executeListClinicalAttachmentsByPatient,
  executeRegenerateClinicalAttachmentAccess,
  executeRenameClinicalAttachment,
  executeSuggestClinicalAttachmentDisplayName,
  executeUploadClinicalAttachment,
} from '@/application/clinical-documents/clinicalAttachmentUseCases';
import {
  resolveClinicalAttachmentFilePolicy,
  type ClinicalAttachmentFilePolicyAction,
} from '@/features/clinical-documents/controllers/clinicalAttachmentFilePolicy';
import { buildClinicalDocumentActor } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import type {
  ClinicalAttachmentRecord,
  ClinicalDocumentRecord,
} from '@/features/clinical-documents/domain/entities';

interface ClinicalAttachmentNotificationPort {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

interface UseClinicalAttachmentsParams {
  selectedDocument: ClinicalDocumentRecord | null;
  hospitalId: string;
  canEdit: boolean;
  user: { uid?: string; email?: string | null; displayName?: string | null } | null;
  role: string | null;
  notify: ClinicalAttachmentNotificationPort;
}

export const useClinicalAttachments = ({
  selectedDocument,
  hospitalId,
  canEdit,
  user,
  role,
  notify,
}: UseClinicalAttachmentsParams) => {
  const [attachments, setAttachments] = useState<ClinicalAttachmentRecord[]>([]);
  const [patientAttachments, setPatientAttachments] = useState<ClinicalAttachmentRecord[]>([]);
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false);
  const [isLoadingPatientAttachments, setIsLoadingPatientAttachments] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [uploadStatusMessage, setUploadStatusMessage] = useState<string | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const selectedEpisodeKey = selectedDocument?.episodeKey ?? null;
  const selectedPatientRut = selectedDocument?.patientRut ?? null;

  const otherEpisodeAttachments = useMemo(
    () => patientAttachments.filter(attachment => attachment.episodeKey !== selectedEpisodeKey),
    [patientAttachments, selectedEpisodeKey]
  );

  const resolveUploadStatusMessage = (file: File): string => {
    const policy = resolveClinicalAttachmentFilePolicy(file, { source: 'file-picker' });
    const actionLabels: Record<ClinicalAttachmentFilePolicyAction, string> = {
      inline_image: 'Preparando imagen...',
      storage_image: 'Subiendo imagen a archivos del episodio...',
      compress_image: 'Comprimiendo imagen antes de subir...',
      storage_file: 'Subiendo archivo a archivos del episodio...',
      rejected: 'Validando archivo...',
    };
    return actionLabels[policy.action];
  };

  const loadAttachments = useCallback(async () => {
    if (!selectedEpisodeKey || !selectedPatientRut) {
      setAttachments([]);
      setPatientAttachments([]);
      return;
    }

    setIsLoadingAttachments(true);
    setIsLoadingPatientAttachments(true);
    const [outcome, patientOutcome] = await Promise.all([
      executeListClinicalAttachmentsByEpisode({
        episodeKey: selectedEpisodeKey,
        hospitalId,
      }),
      executeListClinicalAttachmentsByPatient({
        patientRut: selectedPatientRut,
        hospitalId,
      }),
    ]);
    setIsLoadingAttachments(false);
    setIsLoadingPatientAttachments(false);

    if (outcome.status === 'failed') {
      notifyRef.current.error(
        'No se pudieron cargar archivos del episodio',
        outcome.userSafeMessage
      );
      return;
    }
    if (patientOutcome.status === 'failed') {
      notifyRef.current.error(
        'No se pudieron cargar archivos del paciente',
        patientOutcome.userSafeMessage
      );
      return;
    }

    setAttachments(outcome.data);
    setPatientAttachments(patientOutcome.data);
  }, [hospitalId, selectedEpisodeKey, selectedPatientRut]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!selectedEpisodeKey || !selectedPatientRut) {
        setAttachments([]);
        setPatientAttachments([]);
        return;
      }
      setIsLoadingAttachments(true);
      setIsLoadingPatientAttachments(true);
      const [outcome, patientOutcome] = await Promise.all([
        executeListClinicalAttachmentsByEpisode({
          episodeKey: selectedEpisodeKey,
          hospitalId,
        }),
        executeListClinicalAttachmentsByPatient({
          patientRut: selectedPatientRut,
          hospitalId,
        }),
      ]);
      if (cancelled) return;
      setIsLoadingAttachments(false);
      setIsLoadingPatientAttachments(false);
      if (outcome.status === 'failed') {
        notifyRef.current.error(
          'No se pudieron cargar archivos del episodio',
          outcome.userSafeMessage
        );
        return;
      }
      if (patientOutcome.status === 'failed') {
        notifyRef.current.error(
          'No se pudieron cargar archivos del paciente',
          patientOutcome.userSafeMessage
        );
        return;
      }
      setAttachments(outcome.data);
      setPatientAttachments(patientOutcome.data);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [hospitalId, selectedEpisodeKey, selectedPatientRut]);

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!selectedDocument || !canEdit) return;
      setIsUploadingAttachment(true);
      setUploadStatusMessage(resolveUploadStatusMessage(file));
      try {
        const outcome = await executeUploadClinicalAttachment({
          hospitalId,
          patientRut: selectedDocument.patientRut,
          patientName: selectedDocument.patientName,
          episodeKey: selectedDocument.episodeKey,
          admissionDate: selectedDocument.admissionDate,
          sourceDailyRecordDate: selectedDocument.sourceDailyRecordDate,
          bedId: selectedDocument.sourceBedId,
          documentId: selectedDocument.id,
          documentType: selectedDocument.documentType,
          file,
          actor: buildClinicalDocumentActor(user, role),
        });

        if (outcome.status === 'failed' || !outcome.data) {
          notifyRef.current.error('No se pudo subir el archivo', outcome.userSafeMessage);
          return;
        }

        setAttachments(current => [outcome.data!, ...current]);
        setPatientAttachments(current => [outcome.data!, ...current]);
        notifyRef.current.success(
          'Archivo guardado',
          'El archivo quedó disponible para todo el episodio clínico.'
        );
      } finally {
        setIsUploadingAttachment(false);
        setUploadStatusMessage(null);
      }
    },
    [canEdit, hospitalId, role, selectedDocument, user]
  );

  const uploadPastedImage = useCallback(
    async (
      file: File
    ): Promise<{ attachmentId: string; imageUrl: string; storagePath: string } | null> => {
      if (!selectedDocument || !canEdit) return null;

      setIsUploadingAttachment(true);
      setUploadStatusMessage(resolveUploadStatusMessage(file));
      try {
        const outcome = await executeUploadClinicalAttachment({
          hospitalId,
          patientRut: selectedDocument.patientRut,
          patientName: selectedDocument.patientName,
          episodeKey: selectedDocument.episodeKey,
          admissionDate: selectedDocument.admissionDate,
          sourceDailyRecordDate: selectedDocument.sourceDailyRecordDate,
          bedId: selectedDocument.sourceBedId,
          documentId: selectedDocument.id,
          documentType: selectedDocument.documentType,
          file,
          displayName: file.name || 'Imagen pegada',
          actor: buildClinicalDocumentActor(user, role),
          image: { compressed: false },
        });

        if (outcome.status === 'failed' || !outcome.data?.downloadUrl) {
          notifyRef.current.error('No se pudo subir la imagen', outcome.userSafeMessage);
          return null;
        }

        setAttachments(current => [outcome.data!, ...current]);
        setPatientAttachments(current => [outcome.data!, ...current]);
        return {
          attachmentId: outcome.data.id,
          imageUrl: outcome.data.downloadUrl,
          storagePath: outcome.data.storagePath,
        };
      } finally {
        setIsUploadingAttachment(false);
        setUploadStatusMessage(null);
      }
    },
    [canEdit, hospitalId, role, selectedDocument, user]
  );

  const deleteAttachment = useCallback(
    async (attachment: ClinicalAttachmentRecord) => {
      if (!canEdit) return;
      const outcome = await executeDeleteClinicalAttachment({
        attachmentId: attachment.id,
        hospitalId: attachment.hospitalId,
        storagePath: attachment.storagePath,
        actor: buildClinicalDocumentActor(user, role),
      });

      if (outcome.status === 'failed') {
        notifyRef.current.error('No se pudo eliminar el archivo', outcome.userSafeMessage);
        return;
      }

      setAttachments(current => current.filter(item => item.id !== attachment.id));
      setPatientAttachments(current => current.filter(item => item.id !== attachment.id));
      notifyRef.current.info(
        'Archivo eliminado',
        'El archivo ya no se muestra en los archivos del episodio.'
      );
    },
    [canEdit, role, user]
  );

  const renameAttachment = useCallback(
    async (attachment: ClinicalAttachmentRecord, displayName: string) => {
      if (!canEdit) return;
      const outcome = await executeRenameClinicalAttachment({
        attachmentId: attachment.id,
        hospitalId: attachment.hospitalId,
        displayName,
        actor: buildClinicalDocumentActor(user, role),
      });

      if (outcome.status === 'failed' || !outcome.data) {
        notifyRef.current.error('No se pudo renombrar el archivo', outcome.userSafeMessage);
        return;
      }

      const updateDisplayName = (item: ClinicalAttachmentRecord): ClinicalAttachmentRecord =>
        item.id === attachment.id ? { ...item, displayName: outcome.data!.displayName } : item;

      setAttachments(current => current.map(updateDisplayName));
      setPatientAttachments(current => current.map(updateDisplayName));
      notifyRef.current.success(
        'Archivo renombrado',
        'El nombre visible del archivo fue actualizado.'
      );
    },
    [canEdit, role, user]
  );

  const regenerateAttachmentAccess = useCallback(
    async (attachment: ClinicalAttachmentRecord) => {
      if (!canEdit) return;
      const outcome = await executeRegenerateClinicalAttachmentAccess({
        attachmentId: attachment.id,
        hospitalId: attachment.hospitalId,
        storagePath: attachment.storagePath,
        actor: buildClinicalDocumentActor(user, role),
      });

      if (outcome.status === 'failed' || !outcome.data) {
        notifyRef.current.error('No se pudo regenerar el acceso', outcome.userSafeMessage);
        return;
      }

      const updateDownloadUrl = (item: ClinicalAttachmentRecord): ClinicalAttachmentRecord =>
        item.id === attachment.id ? { ...item, downloadUrl: outcome.data!.downloadUrl } : item;

      setAttachments(current => current.map(updateDownloadUrl));
      setPatientAttachments(current => current.map(updateDownloadUrl));
      notifyRef.current.success('Acceso regenerado', 'El archivo vuelve a estar disponible.');
    },
    [canEdit, role, user]
  );

  const suggestAttachmentName = useCallback(
    async (attachment: ClinicalAttachmentRecord): Promise<string | null> => {
      if (!selectedDocument) return null;
      const outcome = await executeSuggestClinicalAttachmentDisplayName({
        attachment,
        document: selectedDocument,
      });

      if (outcome.status === 'failed' || !outcome.data) {
        notifyRef.current.error('No se pudo sugerir un nombre', outcome.userSafeMessage);
        return null;
      }

      return outcome.data;
    },
    [selectedDocument]
  );

  return {
    attachments,
    patientAttachments,
    otherEpisodeAttachments,
    isLoadingAttachments,
    isLoadingPatientAttachments,
    isUploadingAttachment,
    uploadStatusMessage,
    loadAttachments,
    uploadAttachment,
    uploadPastedImage,
    deleteAttachment,
    renameAttachment,
    regenerateAttachmentAccess,
    suggestAttachmentName,
  };
};
