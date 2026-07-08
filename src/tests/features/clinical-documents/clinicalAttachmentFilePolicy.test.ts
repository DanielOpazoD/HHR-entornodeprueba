import { describe, expect, it } from 'vitest';

import {
  CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES,
  CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES,
  CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES,
  CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES,
  resolveClinicalAttachmentFilePolicy,
} from '@/features/clinical-documents/controllers/clinicalAttachmentFilePolicy';

const buildFile = (size: number, type: string, name = 'archivo.bin'): File =>
  new File([new Uint8Array(size)], name, { type });

describe('resolveClinicalAttachmentFilePolicy', () => {
  it('keeps small pasted images inline', () => {
    const file = buildFile(CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES, 'image/png', 'mini.png');

    expect(resolveClinicalAttachmentFilePolicy(file, { source: 'pasted-image' })).toMatchObject({
      action: 'inline_image',
      fileKind: 'image',
    });
  });

  it('routes medium images to Storage without compression', () => {
    const file = buildFile(
      CLINICAL_ATTACHMENT_INLINE_IMAGE_MAX_BYTES + 1,
      'image/jpeg',
      'foto.jpg'
    );

    expect(resolveClinicalAttachmentFilePolicy(file, { source: 'pasted-image' })).toMatchObject({
      action: 'storage_image',
      fileKind: 'image',
    });
  });

  it('routes small picker images to Storage instead of embedding them inline', () => {
    const file = buildFile(64 * 1024, 'image/png', 'adjunto.png');

    expect(resolveClinicalAttachmentFilePolicy(file, { source: 'file-picker' })).toMatchObject({
      action: 'storage_image',
      fileKind: 'image',
    });
  });

  it('routes large images to compression before Storage upload', () => {
    const file = buildFile(
      CLINICAL_ATTACHMENT_DIRECT_IMAGE_MAX_BYTES + 1,
      'image/jpeg',
      'foto-grande.jpg'
    );

    expect(resolveClinicalAttachmentFilePolicy(file, { source: 'file-picker' })).toMatchObject({
      action: 'compress_image',
      fileKind: 'image',
    });
  });

  it('rejects images that are too large for browser-side compression', () => {
    const file = buildFile(
      CLINICAL_ATTACHMENT_COMPRESSIBLE_IMAGE_MAX_BYTES + 1,
      'image/jpeg',
      'enorme.jpg'
    );

    const result = resolveClinicalAttachmentFilePolicy(file, { source: 'file-picker' });

    expect(result.action).toBe('rejected');
    expect(result.message).toContain('demasiado grande');
  });

  it('accepts PDF and DOCX documents up to the document limit', () => {
    const pdf = buildFile(CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES, 'application/pdf', 'informe.pdf');
    const docx = buildFile(
      CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'traslado.docx'
    );

    expect(resolveClinicalAttachmentFilePolicy(pdf, { source: 'file-picker' })).toMatchObject({
      action: 'storage_file',
      fileKind: 'pdf',
    });
    expect(resolveClinicalAttachmentFilePolicy(docx, { source: 'file-picker' })).toMatchObject({
      action: 'storage_file',
      fileKind: 'docx',
    });
  });

  it('rejects unsupported files and oversized documents', () => {
    const zip = buildFile(1024, 'application/zip', 'paquete.zip');
    const pdf = buildFile(CLINICAL_ATTACHMENT_DOCUMENT_MAX_BYTES + 1, 'application/pdf', 'big.pdf');

    expect(resolveClinicalAttachmentFilePolicy(zip, { source: 'file-picker' })).toMatchObject({
      action: 'rejected',
      code: 'unsupported_type',
    });
    expect(resolveClinicalAttachmentFilePolicy(pdf, { source: 'file-picker' })).toMatchObject({
      action: 'rejected',
      code: 'file_too_large',
    });
  });
});
