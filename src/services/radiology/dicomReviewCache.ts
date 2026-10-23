import { normalizeDicomPatientId } from './dicomTypes';
import type { DicomStudy, DicomSeries, DicomInstance } from './dicomTypes';

/** Originals only. Owned by one patient review, never a module singleton or persistent store. */
export const createDicomReviewCache = (patientId: string, budget = 256 * 1024 * 1024) => {
  const patient = normalizeDicomPatientId(patientId);
  const entries = new Map<string, Uint8Array>();
  let size = 0;
  let disposed = false;
  const key = (study: DicomStudy, series: DicomSeries, instance: DicomInstance) => {
    if (disposed || !patient || normalizeDicomPatientId(study.patientId) !== patient)
      throw new Error('La caché no corresponde a la revisión del paciente.');
    return JSON.stringify([study.uid, series.uid, instance.uid]);
  };
  return {
    patient,
    active: () => !disposed,
    remaining: () => Math.max(0, budget - size),
    get: (study: DicomStudy, series: DicomSeries, instance: DicomInstance) => {
      const id = key(study, series, instance);
      const value = entries.get(id);
      if (value) {
        entries.delete(id);
        entries.set(id, value);
      }
      return value;
    },
    remove: (study: DicomStudy, series: DicomSeries, instance: DicomInstance) => {
      if (disposed) return;
      const id = key(study, series, instance);
      const value = entries.get(id);
      if (value) size -= value.byteLength;
      entries.delete(id);
    },
    // The caller must validate the original's identity before inserting it.
    put: (
      study: DicomStudy,
      series: DicomSeries,
      instance: DicomInstance,
      value: Uint8Array,
      evict = true
    ) => {
      const id = key(study, series, instance);
      if (entries.has(id) || value.byteLength > budget) return;
      if (!evict && size + value.byteLength > budget) return;
      while (size + value.byteLength > budget && entries.size) {
        const oldest = entries.keys().next().value!;
        size -= entries.get(oldest)!.byteLength;
        entries.delete(oldest);
      }
      entries.set(id, value);
      size += value.byteLength;
    },
    dispose: () => {
      disposed = true;
      entries.clear();
      size = 0;
    },
  };
};
export type DicomReviewCache = ReturnType<typeof createDicomReviewCache>;
