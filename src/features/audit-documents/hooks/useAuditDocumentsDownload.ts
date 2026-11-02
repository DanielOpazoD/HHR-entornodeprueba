import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuditContext } from '@/context/AuditContext';

import type { AuditDocumentType, AuditPatientRequest } from '../domain/auditDocumentsRequest';
import {
  requestAuditDocuments,
  type AuditDocumentsProgress,
  type AuditDocumentsResult,
  type AuditDocumentsRun,
} from '../services/auditDocumentsBridge';

export const useAuditDocumentsDownload = () => {
  const { logEvent } = useAuditContext();
  const [progress, setProgress] = useState<AuditDocumentsProgress | null>(null);
  const [result, setResult] = useState<AuditDocumentsResult | null>(null);
  const runRef = useRef<AuditDocumentsRun | null>(null);

  // Leaving the screen stops the download; the extension also stops when the session changes.
  useEffect(() => () => runRef.current?.cancel(), []);

  const start = useCallback(
    async (patients: AuditPatientRequest[], documentTypes: AuditDocumentType[]) => {
      if (runRef.current) return;
      setResult(null);
      setProgress({ phase: 'accepted', done: 0, total: 0 });
      const run = requestAuditDocuments({ patients, documentTypes, onProgress: setProgress });
      runRef.current = run;
      const outcome = await run.result;
      if (runRef.current !== run) return;
      runRef.current = null;
      setProgress(null);
      setResult(outcome);
      if (outcome.ok) {
        logEvent('DATA_EXPORTED', 'system', 'auditoria-documentos-eloisa', {
          scope: 'eloisa_audit_documents',
          runs: patients.map(patient => patient.run),
          ranges: patients.map(patient => [patient.dateFrom ?? '', patient.dateTo ?? '']),
          documentTypes,
          documentCount: outcome.documentCount ?? 0,
          failedCount: outcome.failedCount ?? 0,
        });
      }
    },
    [logEvent]
  );

  const cancel = useCallback(() => runRef.current?.cancel(), []);

  return { progress, result, running: progress !== null, start, cancel };
};
