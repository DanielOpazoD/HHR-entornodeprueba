import { parseDicom } from 'dicom-parser';
import { describe, expect, it } from 'vitest';
import { validateDicomInstanceIdentity } from '@/services/radiology/dicomInstanceIdentity';
import type { DicomStudy, DicomSeries } from '@/services/radiology/dicomTypes';
import {
  syntheticDicom,
  SYNTHETIC_STUDY_UID,
  SYNTHETIC_SERIES_UID,
  syntheticSopUid,
} from '../../fixtures/syntheticDicom';

const instance = { uid: syntheticSopUid(0), number: 1, frames: 1, ticket: 'synthetic' };
const series: DicomSeries = {
  uid: SYNTHETIC_SERIES_UID,
  number: 1,
  description: '',
  modality: 'CT',
  rows: 64,
  columns: 64,
  instances: [instance],
};
const study: DicomStudy = {
  uid: SYNTHETIC_STUDY_UID,
  patientId: '11.111.111-1',
  date: '20261016',
  series: [series],
};
describe('identity from original DICOM files', () => {
  it('accepts the matching original document, regardless of a portal internal ID', () => {
    const data = parseDicom(syntheticDicom(0));
    expect(() => validateDicomInstanceIdentity(data, study, series, instance)).not.toThrow();
  });
  it.each(['patient', 'study', 'series', 'instance', 'missing'] as const)(
    'blocks %s mismatches before decoding or rendering',
    field => {
      const data = parseDicom(
        syntheticDicom(
          0,
          24,
          field === 'patient' ? '222222222' : field === 'missing' ? '' : '111111111'
        )
      );
      expect(() =>
        validateDicomInstanceIdentity(
          data,
          field === 'study' ? { ...study, uid: '1.2.3' } : study,
          field === 'series' ? { ...series, uid: '1.2.3' } : series,
          field === 'instance' ? { ...instance, uid: '1.2.3' } : instance
        )
      ).toThrow('no corresponde');
    }
  );
});
