const FALLBACK_ATTACHMENT_FILE_NAME = 'archivo';

export const normalizeClinicalAttachmentRutKey = (rut: string): string =>
  rut
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^0-9k-]/g, '');

export const sanitizeClinicalAttachmentFileName = (fileName: string): string => {
  const sanitized = fileName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-\./g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');

  return sanitized || FALLBACK_ATTACHMENT_FILE_NAME;
};

const sanitizeClinicalAttachmentPathSegment = (value: string): string =>
  sanitizeClinicalAttachmentFileName(value.replace(/\./g, ''));

export interface BuildClinicalAttachmentStoragePathParams {
  hospitalId: string;
  patientRut: string;
  episodeKey: string;
  attachmentId: string;
  fileName: string;
}

export const buildClinicalAttachmentStoragePath = ({
  hospitalId,
  patientRut,
  episodeKey,
  attachmentId,
  fileName,
}: BuildClinicalAttachmentStoragePathParams): string =>
  [
    'clinical-attachments',
    sanitizeClinicalAttachmentFileName(hospitalId.toLowerCase()),
    normalizeClinicalAttachmentRutKey(patientRut),
    sanitizeClinicalAttachmentPathSegment(episodeKey),
    sanitizeClinicalAttachmentFileName(attachmentId),
    sanitizeClinicalAttachmentFileName(fileName),
  ].join('/');
