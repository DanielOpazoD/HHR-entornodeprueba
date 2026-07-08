import type {
  ClinicalAttachmentRecord,
  ClinicalDocumentAuditActor,
  ClinicalDocumentRecord,
  ClinicalDocumentType,
} from '@/features/clinical-documents/internal';
import {
  compressClinicalAttachmentImage,
  resolveClinicalAttachmentFilePolicy,
  type ClinicalAttachmentImageCompressionResult,
} from '@/features/clinical-documents/internal';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import {
  ClinicalAttachmentRepository,
  type createClinicalAttachmentRepository,
} from '@/services/repositories/ClinicalAttachmentRepository';
import { suggestClinicalAttachmentDisplayName } from './clinicalAttachmentNameSuggestionService';

type ClinicalAttachmentRepositoryPort = ReturnType<typeof createClinicalAttachmentRepository>;

interface ClinicalAttachmentUseCaseDependencies {
  repository?: ClinicalAttachmentRepositoryPort;
  createId?: () => string;
  getNow?: () => string;
  compressImage?: (file: File) => Promise<ClinicalAttachmentImageCompressionResult>;
}

export interface UploadClinicalAttachmentUseCaseInput {
  hospitalId: string;
  patientRut: string;
  patientName?: string;
  episodeKey: string;
  admissionDate?: string;
  sourceDailyRecordDate?: string;
  bedId?: string;
  documentId?: string;
  documentType?: ClinicalDocumentType;
  sectionId?: string;
  file: File;
  displayName?: string;
  actor: ClinicalDocumentAuditActor;
  image?: ClinicalAttachmentRecord['image'];
}

export interface ListClinicalAttachmentsByEpisodeInput {
  episodeKey: string;
  hospitalId: string;
}

export interface ListClinicalAttachmentsByPatientInput {
  patientRut: string;
  hospitalId: string;
}

export interface AuditClinicalAttachmentPatientStorageInput {
  patientRut: string;
  hospitalId: string;
}

export interface ClinicalAttachmentStorageIntegrityReport {
  activeMetadataCount: number;
  storageObjectCount: number;
  orphanStoragePaths: string[];
  missingStorageRecords: Array<Pick<ClinicalAttachmentRecord, 'id' | 'storagePath'>>;
}

export interface DeleteClinicalAttachmentUseCaseInput {
  attachmentId: string;
  hospitalId: string;
  storagePath: string;
  actor: ClinicalDocumentAuditActor;
}

export interface RenameClinicalAttachmentUseCaseInput {
  attachmentId: string;
  hospitalId: string;
  displayName: string;
  actor: ClinicalDocumentAuditActor;
}

export interface RegenerateClinicalAttachmentAccessUseCaseInput {
  attachmentId: string;
  hospitalId: string;
  storagePath: string;
  actor: ClinicalDocumentAuditActor;
}

export interface SuggestClinicalAttachmentDisplayNameInput {
  attachment: Pick<
    ClinicalAttachmentRecord,
    | 'originalFileName'
    | 'displayName'
    | 'fileKind'
    | 'contentType'
    | 'documentType'
    | 'admissionDate'
    | 'sourceDailyRecordDate'
  >;
  document?: Pick<
    ClinicalDocumentRecord,
    'id' | 'documentType' | 'admissionDate' | 'sourceDailyRecordDate'
  > | null;
}

const defaultCreateId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const defaultGetNow = (): string => new Date().toISOString();

const normalizeAttachmentDisplayName = (displayName: string): string =>
  displayName.replace(/\s+/g, ' ').trim();

export const executeUploadClinicalAttachment = async (
  input: UploadClinicalAttachmentUseCaseInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalAttachmentRecord | null>> => {
  const policy = resolveClinicalAttachmentFilePolicy(input.file, { source: 'file-picker' });
  if (policy.action === 'rejected') {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'validation',
          message: policy.message || 'Archivo del episodio no permitido.',
          userSafeMessage: policy.message || 'Archivo del episodio no permitido.',
        },
      ],
      {
        userSafeMessage: policy.message || 'Archivo del episodio no permitido.',
      }
    );
  }

  const repository = dependencies.repository || ClinicalAttachmentRepository;
  const createId = dependencies.createId || defaultCreateId;
  const getNow = dependencies.getNow || defaultGetNow;
  const compressImage = dependencies.compressImage || compressClinicalAttachmentImage;

  try {
    let uploadFile = input.file;
    let imageMeta = input.image;

    if (policy.action === 'compress_image') {
      const compression = await compressImage(input.file);
      if (compression.status === 'failed') {
        return createApplicationFailed(
          null,
          [
            {
              kind: 'validation',
              message: compression.reason,
              userSafeMessage: compression.reason,
            },
          ],
          {
            userSafeMessage: compression.reason,
          }
        );
      }
      uploadFile = compression.file;
      if (compression.status === 'compressed') {
        imageMeta = {
          ...input.image,
          compressed: true,
          originalSizeBytes: compression.originalSizeBytes,
          compressionQuality: compression.quality,
        };
      }
    }

    const record = await repository.upload({
      ...input,
      file: uploadFile,
      image: imageMeta,
      id: createId(),
      now: getNow(),
    });
    return createApplicationSuccess(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo subir el archivo.';
    return createApplicationFailed(
      null,
      [
        {
          kind: 'unknown',
          message,
          userSafeMessage: 'No se pudo subir el archivo. El documento no fue modificado.',
          retryable: true,
        },
      ],
      {
        userSafeMessage: 'No se pudo subir el archivo. El documento no fue modificado.',
        retryable: true,
      }
    );
  }
};

export const executeListClinicalAttachmentsByEpisode = async (
  input: ListClinicalAttachmentsByEpisodeInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalAttachmentRecord[]>> => {
  const repository = dependencies.repository || ClinicalAttachmentRepository;
  try {
    return createApplicationSuccess(
      await repository.listByEpisode(input.episodeKey, input.hospitalId)
    );
  } catch (error) {
    return createApplicationFailed(
      [],
      [
        {
          kind: 'unknown',
          message: error instanceof Error ? error.message : 'No se pudieron cargar los archivos.',
          userSafeMessage: 'No se pudieron cargar los archivos del episodio.',
        },
      ]
    );
  }
};

export const executeListClinicalAttachmentsByPatient = async (
  input: ListClinicalAttachmentsByPatientInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalAttachmentRecord[]>> => {
  const repository = dependencies.repository || ClinicalAttachmentRepository;
  try {
    return createApplicationSuccess(
      await repository.listByPatient(input.patientRut, input.hospitalId)
    );
  } catch (error) {
    return createApplicationFailed(
      [],
      [
        {
          kind: 'unknown',
          message: error instanceof Error ? error.message : 'No se pudieron cargar los archivos.',
          userSafeMessage: 'No se pudieron cargar los archivos del paciente.',
        },
      ]
    );
  }
};

export const executeAuditClinicalAttachmentPatientStorage = async (
  input: AuditClinicalAttachmentPatientStorageInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<ClinicalAttachmentStorageIntegrityReport | null>> => {
  const repository = dependencies.repository || ClinicalAttachmentRepository;
  try {
    const [metadataRecords, storagePaths] = await Promise.all([
      repository.listByPatient(input.patientRut, input.hospitalId),
      repository.listStoragePathsByPatient(input.patientRut, input.hospitalId),
    ]);
    const metadataPathSet = new Set(metadataRecords.map(record => record.storagePath));
    const storagePathSet = new Set(storagePaths);

    return createApplicationSuccess({
      activeMetadataCount: metadataRecords.length,
      storageObjectCount: storagePaths.length,
      orphanStoragePaths: storagePaths.filter(storagePath => !metadataPathSet.has(storagePath)),
      missingStorageRecords: metadataRecords
        .filter(record => !storagePathSet.has(record.storagePath))
        .map(record => ({ id: record.id, storagePath: record.storagePath })),
    });
  } catch (error) {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'unknown',
          message:
            error instanceof Error
              ? error.message
              : 'No se pudo auditar la integridad de archivos.',
          userSafeMessage: 'No se pudo auditar la integridad de archivos del episodio.',
        },
      ],
      { userSafeMessage: 'No se pudo auditar la integridad de archivos del episodio.' }
    );
  }
};

export const executeDeleteClinicalAttachment = async (
  input: DeleteClinicalAttachmentUseCaseInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<void>> => {
  const repository = dependencies.repository || ClinicalAttachmentRepository;
  const getNow = dependencies.getNow || defaultGetNow;
  try {
    await repository.delete({
      ...input,
      now: getNow(),
    });
    return createApplicationSuccess(undefined);
  } catch (error) {
    return createApplicationFailed(undefined, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'No se pudo eliminar el archivo.',
        userSafeMessage: 'No se pudo eliminar el archivo.',
      },
    ]);
  }
};

export const executeRenameClinicalAttachment = async (
  input: RenameClinicalAttachmentUseCaseInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<{ id: string; displayName: string } | null>> => {
  const repository = dependencies.repository || ClinicalAttachmentRepository;
  const getNow = dependencies.getNow || defaultGetNow;
  const displayName = normalizeAttachmentDisplayName(input.displayName);

  if (!displayName) {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'validation',
          message: 'El nombre del archivo no puede quedar vacio.',
          userSafeMessage: 'El nombre del archivo no puede quedar vacio.',
        },
      ],
      { userSafeMessage: 'El nombre del archivo no puede quedar vacio.' }
    );
  }

  try {
    await repository.rename({
      ...input,
      displayName,
      now: getNow(),
    });
    return createApplicationSuccess({ id: input.attachmentId, displayName });
  } catch (error) {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'unknown',
          message: error instanceof Error ? error.message : 'No se pudo renombrar el archivo.',
          userSafeMessage: 'No se pudo renombrar el archivo.',
        },
      ],
      { userSafeMessage: 'No se pudo renombrar el archivo.' }
    );
  }
};

export const executeRegenerateClinicalAttachmentAccess = async (
  input: RegenerateClinicalAttachmentAccessUseCaseInput,
  dependencies: ClinicalAttachmentUseCaseDependencies = {}
): Promise<ApplicationOutcome<{ id: string; downloadUrl: string } | null>> => {
  const repository = dependencies.repository || ClinicalAttachmentRepository;
  const getNow = dependencies.getNow || defaultGetNow;

  try {
    const downloadUrl = await repository.regenerateAccess({
      ...input,
      now: getNow(),
    });
    return createApplicationSuccess({ id: input.attachmentId, downloadUrl });
  } catch (error) {
    return createApplicationFailed(
      null,
      [
        {
          kind: 'unknown',
          message:
            error instanceof Error ? error.message : 'No se pudo regenerar el acceso al archivo.',
          userSafeMessage: 'No se pudo regenerar el acceso al archivo.',
          retryable: true,
        },
      ],
      { userSafeMessage: 'No se pudo regenerar el acceso al archivo.', retryable: true }
    );
  }
};

export const executeSuggestClinicalAttachmentDisplayName = async (
  input: SuggestClinicalAttachmentDisplayNameInput
): Promise<ApplicationOutcome<string | null>> => {
  return suggestClinicalAttachmentDisplayName(input);
};
