import { useLayoutEffect, useRef, useState } from 'react';
import { normalizeDicomPatientId, type DicomCapture } from '@/services/radiology/dicomTypes';
import { validateClinicalFormAnnexes } from '../../../services/clinicalFormAnnexes';

/** Captures belong to one reviewed patient/episode and never enter persistent preferences. */
export const useClinicalFormAnnexes = (context: string, patientId: string) => {
  const [stored, setStored] = useState<{ context: string; images: DicomCapture[] }>({
    context,
    images: [],
  });
  const imagesRef = useRef(stored);
  const latest = useRef(context);
  const images = stored.context === context ? stored.images : [];
  if (stored.context !== context) setStored({ context, images: [] });
  useLayoutEffect(() => {
    imagesRef.current = stored;
    latest.current = context;
  }, [context, stored]);
  const change = (update: (current: DicomCapture[]) => DicomCapture[]) => {
    if (latest.current !== context) return;
    const current = imagesRef.current;
    const next = update(current.context === context ? current.images : []);
    validateClinicalFormAnnexes(next, patientId);
    imagesRef.current = { context, images: next };
    setStored(imagesRef.current);
  };
  return {
    images,
    add: (image: DicomCapture) => {
      if (
        latest.current !== context ||
        normalizeDicomPatientId(image.patientId) !== normalizeDicomPatientId(patientId)
      )
        return;
      // Validate before entering a React updater so errors remain actionable in the viewer.
      validateClinicalFormAnnexes([...images, image], patientId);
      change(current => [...current, image]);
    },
    remove: (id: string) => change(current => current.filter(image => image.id !== id)),
    caption: (id: string, caption: string) =>
      change(current => current.map(image => (image.id === id ? { ...image, caption } : image))),
    move: (id: string, delta: number) =>
      change(current => {
        const next = [...current];
        const index = next.findIndex(image => image.id === id);
        const to = index + delta;
        if (index >= 0 && to >= 0 && to < next.length)
          [next[index], next[to]] = [next[to], next[index]];
        return next;
      }),
  };
};
