import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

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

type UpdateAttachments = (items: ClinicalAttachmentRecord[]) => ClinicalAttachmentRecord[];

const EMPTY_ATTACHMENTS: ClinicalAttachmentRecord[] = [];

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
  const selectedEpisodeKey = selectedDocument?.episodeKey ?? null;
  const selectedPatientRut = selectedDocument?.patientRut ?? null;
  const documentId = selectedDocument?.id ?? null;
  const scope = useMemo(
    () => ({
      hospitalId,
      selectedEpisodeKey,
      selectedPatientRut,
      key: JSON.stringify([hospitalId, selectedEpisodeKey, selectedPatientRut]),
    }),
    [hospitalId, selectedEpisodeKey, selectedPatientRut]
  );
  const selection = useMemo(() => ({ scope, documentId }), [scope, documentId]);
  const activeSelection = useRef<typeof selection | null>(null);
  const pendingRead = useRef<{ key: string; updates: UpdateAttachments[] } | null>(null);
  const [result, setResult] = useState<{
    scope: typeof scope;
    attachments: ClinicalAttachmentRecord[];
    patientAttachments: ClinicalAttachmentRecord[];
    isLoading: boolean;
  } | null>(null);
  const [upload, setUpload] = useState<{ selection: typeof selection; message: string } | null>(
    null
  );
  const current = result?.scope === scope ? result : null;
  const attachments = current?.attachments ?? EMPTY_ATTACHMENTS;
  const patientAttachments = current?.patientAttachments ?? EMPTY_ATTACHMENTS;
  const isLoadingAttachments =
    Boolean(selectedEpisodeKey && selectedPatientRut) && (!current || current.isLoading);
  const isUploadingAttachment = upload?.selection === selection;
  const uploadStatusMessage = isUploadingAttachment ? upload.message : null;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useLayoutEffect(() => {
    activeSelection.current = selection;
    return () => {
      activeSelection.current = null;
    };
  }, [selection]);

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

  useEffect(() => {
    let cancelled = false;
    const read = { key: scope.key, updates: [] as UpdateAttachments[] };
    const { hospitalId, selectedEpisodeKey, selectedPatientRut } = scope;

    const run = async () => {
      if (!selectedEpisodeKey || !selectedPatientRut) {
        return;
      }
      pendingRead.current = read;
      setResult({ scope, attachments: [], patientAttachments: [], isLoading: true });
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
      if (pendingRead.current === read) pendingRead.current = null;
      setResult(current => (current?.scope === scope ? { ...current, isLoading: false } : current));
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
      setResult({
        scope,
        attachments: read.updates.reduce((items, update) => update(items), outcome.data),
        patientAttachments: read.updates.reduce(
          (items, update) => update(items),
          patientOutcome.data
        ),
        isLoading: false,
      });
    };

    void run();

    return () => {
      cancelled = true;
      if (pendingRead.current === read) pendingRead.current = null;
    };
  }, [scope]);

  const updateAttachmentLists = useCallback(
    (update: UpdateAttachments) => {
      if (pendingRead.current?.key === scope.key) pendingRead.current.updates.push(update);
      setResult(current =>
        current?.scope.key === scope.key
          ? {
              ...current,
              attachments: update(current.attachments),
              patientAttachments: update(current.patientAttachments),
            }
          : current
      );
    },
    [scope]
  );

  const uploadAttachment = useCallback(
    async (file: File) => {
      if (!selectedDocument || !canEdit || activeSelection.current !== selection) return;
      const pendingUpload = { selection, message: resolveUploadStatusMessage(file) };
      setUpload(pendingUpload);
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

        if (activeSelection.current?.scope.key !== scope.key) return;
        if (outcome.status === 'failed' || !outcome.data) {
          if (activeSelection.current === selection)
            notifyRef.current.error('No se pudo subir el archivo', outcome.userSafeMessage);
          return;
        }

        updateAttachmentLists(current => [
          outcome.data!,
          ...current.filter(item => item.id !== outcome.data!.id),
        ]);
        if (activeSelection.current !== selection) return;
        notifyRef.current.success(
          'Archivo guardado',
          'El archivo quedó disponible para todo el episodio clínico.'
        );
      } finally {
        setUpload(current => (current === pendingUpload ? null : current));
      }
    },
    [canEdit, hospitalId, role, selectedDocument, user, updateAttachmentLists, scope, selection]
  );

  const uploadPastedImage = useCallback(
    async (
      file: File
    ): Promise<{ attachmentId: string; imageUrl: string; storagePath: string } | null> => {
      if (!selectedDocument || !canEdit || activeSelection.current !== selection) return null;

      const pendingUpload = { selection, message: resolveUploadStatusMessage(file) };
      setUpload(pendingUpload);
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

        if (activeSelection.current?.scope.key !== scope.key) return null;
        if (outcome.status === 'failed' || !outcome.data?.downloadUrl) {
          if (activeSelection.current === selection)
            notifyRef.current.error('No se pudo subir la imagen', outcome.userSafeMessage);
          return null;
        }

        updateAttachmentLists(current => [
          outcome.data!,
          ...current.filter(item => item.id !== outcome.data!.id),
        ]);
        if (activeSelection.current !== selection) return null;
        return {
          attachmentId: outcome.data.id,
          imageUrl: outcome.data.downloadUrl,
          storagePath: outcome.data.storagePath,
        };
      } finally {
        setUpload(current => (current === pendingUpload ? null : current));
      }
    },
    [canEdit, hospitalId, role, selectedDocument, user, updateAttachmentLists, scope, selection]
  );

  const deleteAttachment = useCallback(
    async (attachment: ClinicalAttachmentRecord) => {
      if (!canEdit || activeSelection.current !== selection) return;
      const outcome = await executeDeleteClinicalAttachment({
        attachmentId: attachment.id,
        hospitalId: attachment.hospitalId,
        storagePath: attachment.storagePath,
        actor: buildClinicalDocumentActor(user, role),
      });

      if (activeSelection.current?.scope.key !== scope.key) return;
      if (outcome.status === 'failed') {
        if (activeSelection.current === selection)
          notifyRef.current.error('No se pudo eliminar el archivo', outcome.userSafeMessage);
        return;
      }

      updateAttachmentLists(current => current.filter(item => item.id !== attachment.id));
      if (activeSelection.current !== selection) return;
      notifyRef.current.info(
        'Archivo eliminado',
        'El archivo ya no se muestra en los archivos del episodio.'
      );
    },
    [canEdit, role, user, updateAttachmentLists, scope, selection]
  );

  const renameAttachment = useCallback(
    async (attachment: ClinicalAttachmentRecord, displayName: string) => {
      if (!canEdit || activeSelection.current !== selection) return;
      const outcome = await executeRenameClinicalAttachment({
        attachmentId: attachment.id,
        hospitalId: attachment.hospitalId,
        displayName,
        actor: buildClinicalDocumentActor(user, role),
      });

      if (activeSelection.current?.scope.key !== scope.key) return;
      if (outcome.status === 'failed' || !outcome.data) {
        if (activeSelection.current === selection)
          notifyRef.current.error('No se pudo renombrar el archivo', outcome.userSafeMessage);
        return;
      }

      const updateDisplayName = (item: ClinicalAttachmentRecord): ClinicalAttachmentRecord =>
        item.id === attachment.id ? { ...item, displayName: outcome.data!.displayName } : item;

      updateAttachmentLists(current => current.map(updateDisplayName));
      if (activeSelection.current !== selection) return;
      notifyRef.current.success(
        'Archivo renombrado',
        'El nombre visible del archivo fue actualizado.'
      );
    },
    [canEdit, role, user, updateAttachmentLists, scope, selection]
  );

  const regenerateAttachmentAccess = useCallback(
    async (attachment: ClinicalAttachmentRecord) => {
      if (!canEdit || activeSelection.current !== selection) return;
      const outcome = await executeRegenerateClinicalAttachmentAccess({
        attachmentId: attachment.id,
        hospitalId: attachment.hospitalId,
        storagePath: attachment.storagePath,
        actor: buildClinicalDocumentActor(user, role),
      });

      if (activeSelection.current?.scope.key !== scope.key) return;
      if (outcome.status === 'failed' || !outcome.data) {
        if (activeSelection.current === selection)
          notifyRef.current.error('No se pudo regenerar el acceso', outcome.userSafeMessage);
        return;
      }

      const updateDownloadUrl = (item: ClinicalAttachmentRecord): ClinicalAttachmentRecord =>
        item.id === attachment.id ? { ...item, downloadUrl: outcome.data!.downloadUrl } : item;

      updateAttachmentLists(current => current.map(updateDownloadUrl));
      if (activeSelection.current !== selection) return;
      notifyRef.current.success('Acceso regenerado', 'El archivo vuelve a estar disponible.');
    },
    [canEdit, role, user, updateAttachmentLists, scope, selection]
  );

  const suggestAttachmentName = useCallback(
    async (attachment: ClinicalAttachmentRecord): Promise<string | null> => {
      if (!selectedDocument || activeSelection.current !== selection) return null;
      const outcome = await executeSuggestClinicalAttachmentDisplayName({
        attachment,
        document: selectedDocument,
      });

      if (activeSelection.current !== selection) return null;
      if (outcome.status === 'failed' || !outcome.data) {
        notifyRef.current.error('No se pudo sugerir un nombre', outcome.userSafeMessage);
        return null;
      }

      return outcome.data;
    },
    [selectedDocument, selection]
  );

  return {
    attachments,
    patientAttachments,
    otherEpisodeAttachments,
    isLoadingAttachments,
    isLoadingPatientAttachments: isLoadingAttachments,
    isUploadingAttachment,
    uploadStatusMessage,
    uploadAttachment,
    uploadPastedImage,
    deleteAttachment,
    renameAttachment,
    regenerateAttachmentAccess,
    suggestAttachmentName,
  };
};
