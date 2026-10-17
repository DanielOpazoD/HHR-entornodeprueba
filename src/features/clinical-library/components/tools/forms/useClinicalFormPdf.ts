import { useEffect, useRef, useState } from 'react';
import { printLibraryDocument } from '../../../services/libraryDocumentActions';
import type {
  ClinicalFormDefinition,
  ClinicalFormValues,
} from '../../../domain/forms/clinicalFormTypes';

export type ClinicalFormPdfGenerator = (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>
) => Promise<Uint8Array>;

interface PreparedPdf {
  bytes: Uint8Array;
  url: string;
  fingerprint: string;
}

export const useClinicalFormPdf = (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>,
  sourceState: string,
  generate: ClinicalFormPdfGenerator,
  onNotice: (notice: string) => void,
  generateDocx: ClinicalFormPdfGenerator = async (...args) => {
    const { generateClinicalFormDocx } = await import('../../../services/clinicalFormDocx');
    return generateClinicalFormDocx(...args);
  }
) => {
  const [busyFormat, setBusyFormat] = useState<'pdf' | 'docx' | null>(null);
  const busy = busyFormat !== null;
  const [prepared, setPrepared] = useState<PreparedPdf | null>(null);
  const fingerprint = JSON.stringify([form.id, values, hidden, sourceState]);
  const latest = useRef(fingerprint);
  latest.current = fingerprint;
  const sequence = useRef(0);
  const currentPdf = prepared?.fingerprint === fingerprint ? prepared : null;
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    []
  );
  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL(prepared.url);
    },
    [prepared]
  );

  const prepare = async (): Promise<PreparedPdf | null> => {
    if (currentPdf) return currentPdf;
    const attempt = ++sequence.current;
    setBusyFormat('pdf');
    onNotice('');
    try {
      const bytes = await generate(form, { ...values }, [...hidden]);
      if (attempt !== sequence.current) return null;
      if (latest.current !== fingerprint)
        throw new Error(
          'Los datos cambiaron mientras se preparaba el PDF. Revisa y vuelve a generar.'
        );
      const result = {
        bytes,
        url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })),
        fingerprint,
      };
      setPrepared(result);
      return result;
    } catch (error) {
      if (attempt === sequence.current)
        onNotice(error instanceof Error ? error.message : 'No se pudo preparar el PDF.');
      return null;
    } finally {
      if (attempt === sequence.current) setBusyFormat(null);
    }
  };
  const download = async () => {
    const result = await prepare();
    if (!result || latest.current !== result.fingerprint) return;
    try {
      const { saveAs } = await import('file-saver');
      if (latest.current !== result.fingerprint) return;
      saveAs(
        new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }),
        `${form.id}-imprimible.pdf`
      );
    } catch {
      onNotice('No se pudo descargar el PDF. Vuelve a intentarlo.');
    }
  };
  const downloadDocx = async () => {
    const attempt = ++sequence.current;
    setBusyFormat('docx');
    onNotice('');
    try {
      const bytes = await generateDocx(form, { ...values }, [...hidden]);
      const { saveAs } = await import('file-saver');
      if (attempt !== sequence.current) return;
      if (latest.current !== fingerprint)
        throw new Error(
          'Los datos cambiaron mientras se preparaba Word. Revisa y vuelve a generar.'
        );
      saveAs(
        new Blob([new Uint8Array(bytes)], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        `${form.id}.docx`
      );
    } catch (error) {
      if (attempt === sequence.current)
        onNotice(error instanceof Error ? error.message : 'No se pudo descargar Word.');
    } finally {
      if (attempt === sequence.current) setBusyFormat(null);
    }
  };
  return {
    busy,
    busyFormat,
    currentPdf,
    prepare,
    download,
    downloadDocx,
    print: () => {
      if (currentPdf) printLibraryDocument(currentPdf.url);
    },
  };
};
