import { useEffect, useState } from 'react';
import {
  createDicomReviewCache,
  type DicomReviewCache,
} from '@/services/radiology/dicomReviewCache';
import { normalizeDicomPatientId } from '@/services/radiology/dicomTypes';

export const useDicomReviewCache = (open: boolean, patientId: string) => {
  const [cache, setCache] = useState<DicomReviewCache>();
  const patient = normalizeDicomPatientId(patientId);
  useEffect(() => {
    if (!open || !patient) return;
    let cancelled = false;
    let current: DicomReviewCache | undefined;
    // Publish only after a committed setup survives immediate teardown (including StrictMode).
    queueMicrotask(() => {
      if (cancelled) return;
      current = createDicomReviewCache(patient);
      setCache(current);
    });
    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [open, patient]);
  return open && cache?.active() && cache.patient === patient ? cache : undefined;
};
