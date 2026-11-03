import type { DicomMeasurement } from './dicomMeasurementStore';
import { dicomMeasurementSummary } from './dicomMeasurementText';

const planes = { axial: 'axial', coronal: 'coronal', sagittal: 'sagital' } as const;

/** «serie 3, corte 87» or «serie 3, MPR coronal oblicuo, corte 40». */
export const dicomMeasurementPlace = (item: DicomMeasurement) =>
  [
    `serie ${item.seriesNumber}`,
    item.view === 'original'
      ? undefined
      : `MPR ${planes[item.view]}${item.oblique ? ' oblicuo' : ''}`,
    `corte ${item.slice + 1}`,
  ]
    .filter(Boolean)
    .join(', ');

export const dicomMeasurementLabel = (item: DicomMeasurement) =>
  dicomMeasurementSummary(item.kind, item.value, item.modality);

/**
 * Plain Spanish text for the clinical note, one line per slice:
 * «TC tórax, serie 3, corte 87: distancia 12,4 mm; ROI 35 UH (DE 8), área 1,2 cm²».
 * Only the exam name, series and slice numbers and the values: no patient identifiers.
 */
export const dicomMeasurementsText = (items: readonly DicomMeasurement[], exam: string) => {
  const groups = new Map<string, { place: string; values: string[] }>();
  for (const item of items) {
    const place = dicomMeasurementPlace(item);
    const key = `${item.seriesUid}|${place}`;
    const group = groups.get(key) ?? { place, values: [] };
    group.values.push(dicomMeasurementLabel(item));
    groups.set(key, group);
  }
  const title = exam.trim();
  return [...groups.values()]
    .map(group => `${title ? `${title}, ` : ''}${group.place}: ${group.values.join('; ')}`)
    .join('\n');
};
