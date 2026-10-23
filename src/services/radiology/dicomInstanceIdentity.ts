import type { DataSet } from 'dicom-parser';
import {
  normalizeDicomPatientId,
  type DicomStudy,
  type DicomSeries,
  type DicomInstance,
} from './dicomTypes';

/** Portal patient IDs are internal. Only the original's PatientID supplies the document. */
export const validateDicomInstanceIdentity = (
  data: DataSet,
  study: DicomStudy,
  series: DicomSeries,
  instance: DicomInstance
): void => {
  if (
    data.string('x0020000d') !== study.uid ||
    data.string('x0020000e') !== series.uid ||
    data.string('x00080018') !== instance.uid ||
    !study.patientId ||
    normalizeDicomPatientId(data.string('x00100020') || '') !==
      normalizeDicomPatientId(study.patientId)
  )
    throw new Error('Un original DICOM no corresponde al paciente o al estudio seleccionado.');
};
