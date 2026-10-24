import { useEffect, useRef, useState } from 'react';
import { printLibraryDocument } from '../../../services/libraryDocumentActions';
import type { DicomCapture } from '@/services/radiology/dicomTypes';
import type {
  ClinicalFormDefinition,
  ClinicalFormValues,
} from '../../../domain/forms/clinicalFormTypes';

export type ClinicalFormPdfGenerator = (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>
) => Promise<Uint8Array>;

export type ClinicalFormDocxGenerator = (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>,
  annexes: ReadonlyArray<DicomCapture>
) => Promise<Uint8Array>;

interface PreparedPdf {
  bytes: Uint8Array;
  url: string;
  fingerprint: string;
  revision: number;
}

export const useClinicalFormPdf = (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>,
  sourceState: string,
  generate: ClinicalFormPdfGenerator,
  onNotice: (notice: string) => void,
  generateDocx: ClinicalFormDocxGenerator = async (...args) => {
    const { generateClinicalFormDocx } = await import('../../../services/clinicalFormDocx');
    return generateClinicalFormDocx(...args);
  },
  annexes: ReadonlyArray<DicomCapture> = []
) => {
  const [busyFormat, setBusyFormat] = useState<'pdf' | 'docx' | null>(null);
  const busy = busyFormat !== null;
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null);
  const ownedPdf = useRef<PreparedPdf | null>(null);
  const fingerprint = JSON.stringify([
    form.id,
    values,
    hidden,
    sourceState,
    annexes.map(image => [image.id, image.caption]),
  ]);
  const latest = useRef(fingerprint);
  const contextRevision = useRef(0);
  if (latest.current !== fingerprint) {
    latest.current = fingerprint;
    contextRevision.current += 1;
  }
  const revision = contextRevision.current;
  const sequence = useRef(0);
  const active = useRef(false);
  const mounted = useRef(true);
  const currentPdf = prepared?.revision === revision ? prepared : null;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      if (ownedPdf.current) URL.revokeObjectURL(ownedPdf.current.url);
      ownedPdf.current = null;
    };
  }, []);
  useEffect(() => {
    if (ownedPdf.current && ownedPdf.current.revision < revision) {
      URL.revokeObjectURL(ownedPdf.current.url);
      ownedPdf.current = null;
    }
  }, [revision]);

  const changedMessage = (format: 'pdf' | 'docx') =>
    `Los datos cambiaron mientras se preparaba ${format === 'pdf' ? 'el PDF' : 'Word'}. Revisa y vuelve a generar.`;
  const isCurrent = (attempt: number, format: 'pdf' | 'docx'): boolean => {
    if (!mounted.current || attempt !== sequence.current) return false;
    if (revision !== contextRevision.current) throw new Error(changedMessage(format));
    return true;
  };
  // Keep the lock through the deferred download module, including cached PDFs.
  const run = async <T>(
    format: 'pdf' | 'docx',
    action: (attempt: number) => Promise<T>
  ): Promise<T | null> => {
    if (active.current || !mounted.current) return null;
    active.current = true;
    const attempt = ++sequence.current;
    setBusyFormat(format);
    onNotice('');
    try {
      return await action(attempt);
    } catch (error) {
      if (attempt === sequence.current)
        onNotice(
          revision !== contextRevision.current
            ? changedMessage(format)
            : error instanceof Error
              ? error.message
              : 'No se pudo preparar el documento. Vuelve a intentarlo.'
        );
      return null;
    } finally {
      if (attempt === sequence.current) {
        active.current = false;
        setBusyFormat(null);
      }
    }
  };
  const preparePdf = async (attempt: number): Promise<PreparedPdf | null> => {
    if (!isCurrent(attempt, 'pdf')) return null;
    if (ownedPdf.current?.revision === revision) return ownedPdf.current;
    const bytes = await generate(form, { ...values }, [...hidden]);
    if (!isCurrent(attempt, 'pdf')) return null;
    const result = {
      bytes,
      url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })),
      fingerprint,
      revision,
    };
    if (ownedPdf.current) URL.revokeObjectURL(ownedPdf.current.url);
    // Own the URL immediately, even if the editor closes before the state commits.
    ownedPdf.current = result;
    setPrepared(result);
    return result;
  };
  const saveDocument = async (attempt: number, format: 'pdf' | 'docx', bytes: Uint8Array) => {
    try {
      const { saveAs } = await import('file-saver');
      if (!isCurrent(attempt, format)) return;
      saveAs(
        new Blob([new Uint8Array(bytes)], {
          type:
            format === 'pdf'
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        format === 'pdf' ? `${form.id}-imprimible.pdf` : `${form.id}.docx`
      );
    } catch {
      throw new Error(
        `No se pudo descargar ${format === 'pdf' ? 'el PDF' : 'Word'}. Vuelve a intentarlo.`
      );
    }
  };
  const prepare = () => run('pdf', preparePdf);
  const download = () =>
    run('pdf', async attempt => {
      const result = await preparePdf(attempt);
      if (!result || !isCurrent(attempt, 'pdf')) return;
      await saveDocument(attempt, 'pdf', result.bytes);
    });
  const downloadDocx = () =>
    run('docx', async attempt => {
      if (!isCurrent(attempt, 'docx')) return;
      const bytes = await generateDocx(
        form,
        { ...values },
        [...hidden],
        annexes.map(image => ({ ...image }))
      );
      if (!isCurrent(attempt, 'docx')) return;
      await saveDocument(attempt, 'docx', bytes);
    });
  return {
    busy,
    busyFormat,
    currentPdf,
    prepare,
    download,
    downloadDocx,
    print: () => {
      if (mounted.current && currentPdf && revision === contextRevision.current)
        printLibraryDocument(currentPdf.url);
    },
  };
};
