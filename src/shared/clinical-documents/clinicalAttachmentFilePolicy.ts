import type { ClinicalAttachmentFileKind } from '@/shared/clinical-documents/clinicalAttachmentContracts';

export const CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES = 500 * 1024;
export const CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

export type ClinicalAttachmentFilePolicyAction =
  | 'inline_image'
  | 'storage_image'
  | 'compress_image'
  | 'storage_file'
  | 'rejected';

export type ClinicalAttachmentFilePolicyCode =
  | 'accepted'
  | 'unsupported_type'
  | 'file_too_large'
  | 'image_too_large';

export interface ClinicalAttachmentFilePolicyOptions {
  source: 'pasted-image' | 'file-picker';
}

export interface ClinicalAttachmentFilePolicyResult {
  action: ClinicalAttachmentFilePolicyAction;
  fileKind?: ClinicalAttachmentFileKind;
  code: ClinicalAttachmentFilePolicyCode;
  message?: string;
}

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const resolveFileKind = (file: File): ClinicalAttachmentFileKind | null => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === DOCX_CONTENT_TYPE || file.name.toLowerCase().endsWith('.docx')) return 'docx';
  return null;
};

export const resolveClinicalAttachmentFilePolicy = (
  file: File,
  options: ClinicalAttachmentFilePolicyOptions
): ClinicalAttachmentFilePolicyResult => {
  const fileKind = resolveFileKind(file);

  if (!fileKind) {
    return {
      action: 'rejected',
      code: 'unsupported_type',
      message: 'Solo se permiten imagenes, PDF y documentos DOCX como archivos del episodio.',
    };
  }

  if (fileKind === 'image') {
    if (
      options.source === 'pasted-image' &&
      file.size <= CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES
    ) {
      return { action: 'inline_image', fileKind, code: 'accepted' };
    }
    if (file.size <= CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES) {
      return { action: 'storage_image', fileKind, code: 'accepted' };
    }
    if (file.size <= CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES) {
      return { action: 'compress_image', fileKind, code: 'accepted' };
    }
    return {
      action: 'rejected',
      fileKind,
      code: 'image_too_large',
      message: 'La imagen es demasiado grande para comprimirla de forma segura en el navegador.',
    };
  }

  if (file.size > CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES) {
    return {
      action: 'rejected',
      fileKind,
      code: 'file_too_large',
      message: 'El archivo supera el limite permitido para archivos del episodio.',
    };
  }

  return { action: 'storage_file', fileKind, code: 'accepted' };
};
