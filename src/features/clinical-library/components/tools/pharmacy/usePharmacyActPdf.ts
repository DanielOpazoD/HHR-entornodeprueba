import { useEffect, useRef, useState } from 'react';
import type { PharmacyActDraft } from '../../../domain/pharmacy/pharmacyTypes';
import { validatePharmacyDraft } from '../../../domain/pharmacy/pharmacyDraft';
import { generatePharmacyActPdf } from '../../../services/pharmacyActPdf';
import { printLibraryDocument } from '../../../services/libraryDocumentActions';

interface PreparedPharmacyPdf {
  bytes: Uint8Array;
  url: string;
  fingerprint: string;
}

export type PharmacyPdfGenerator = (draft: PharmacyActDraft) => Promise<Uint8Array>;

export const usePharmacyActPdf = (
  draft: PharmacyActDraft,
  onNotice: (notice: string) => void,
  generate: PharmacyPdfGenerator = generatePharmacyActPdf
) => {
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedPharmacyPdf | null>(null);
  const fingerprint = JSON.stringify(draft);
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

  const prepare = async (): Promise<PreparedPharmacyPdf | null> => {
    if (currentPdf) return currentPdf;
    if (validatePharmacyDraft(draft).length) return null;
    const attempt = ++sequence.current;
    setBusy(true);
    onNotice('');
    try {
      const snapshot: PharmacyActDraft = {
        ...draft,
        professional: { ...draft.professional },
        lines: draft.lines.map(line => ({ ...line })),
      };
      const bytes = await generate(snapshot);
      if (attempt !== sequence.current) return null;
      if (latest.current !== fingerprint) {
        onNotice('Los datos cambiaron. Genera nuevamente la vista previa.');
        return null;
      }
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
      if (attempt === sequence.current) setBusy(false);
    }
  };

  return {
    busy,
    currentPdf,
    prepare,
    download: async (): Promise<void> => {
      const result = currentPdf;
      if (!result) return;
      try {
        const { saveAs } = await import('file-saver');
        if (latest.current !== result.fingerprint) return;
        saveAs(
          new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }),
          `acta-${draft.kind === 'return' ? 'devolucion-farmacos' : 'entrega-eliminados'}-${draft.date}.pdf`
        );
      } catch {
        onNotice('No se pudo descargar el PDF. Vuelve a intentarlo.');
      }
    },
    print: (): void => {
      if (currentPdf && latest.current === currentPdf.fingerprint)
        printLibraryDocument(currentPdf.url);
    },
  };
};
