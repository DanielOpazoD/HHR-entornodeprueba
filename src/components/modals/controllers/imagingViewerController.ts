import type { PatientData } from '@/types/domain/patient';
import type { DocumentOption } from '../imaging/types';
import {
  splitPatientName,
  calculateAge,
  formatDateToCL as formatDate,
} from '@/utils/clinicalUtils';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

interface ImagingViewerOverlay {
  text: string;
  left: string;
  top: string;
  className?: string;
}

export interface ImagingViewerDocumentModel {
  imageSrc: string;
  aspectRatio: string;
  overlays: ImagingViewerOverlay[];
}

const getTodayFormatted = (): string => formatDateDDMMYYYY(getTodayISO());

export const buildImagingViewerDocumentModel = (
  selectedDoc: DocumentOption,
  patient: PatientData,
  requestingPhysician: string
): ImagingViewerDocumentModel => {
  const [nombres, primerApellido, segundoApellido] = splitPatientName(patient.patientName);
  const ageStr = calculateAge(patient.birthDate);
  const birthStr = formatDate(patient.birthDate);
  const todayStr = getTodayFormatted();
  const diagValue = patient.pathology || patient.cie10Description || '';

  if (selectedDoc === 'encuesta') {
    return {
      imageSrc: '/docs/encuesta_imagenologia.png',
      aspectRatio: '612 / 792',
      overlays: [
        { text: nombres, left: '16.27%', top: '17.12%' },
        { text: primerApellido, left: '27.20%', top: '17.12%' },
        { text: segundoApellido, left: '41.74%', top: '17.12%' },
        { text: patient.rut || '', left: '69.14%', top: '17.12%' },
        { text: ageStr, left: '58.67%', top: '17.12%' },
        { text: birthStr, left: '26.95%', top: '24.52%' },
        {
          text: diagValue,
          left: '18.35%',
          top: '37.24%',
          className: 'font-medium whitespace-nowrap',
        },
        {
          text: requestingPhysician,
          left: '66.83%',
          top: '20.80%',
          className: 'font-bold',
        },
      ],
    };
  }

  if (selectedDoc === 'consentimiento') {
    return {
      imageSrc: '/docs/consentimiento.png',
      aspectRatio: '612 / 842',
      overlays: [
        { text: nombres, left: '31.65%', top: '21.7%', className: 'sm:text-[10px]' },
        { text: primerApellido, left: '48.67%', top: '21.7%', className: 'sm:text-[10px]' },
        { text: segundoApellido, left: '62.72%', top: '21.7%', className: 'sm:text-[10px]' },
        { text: patient.rut || '', left: '21.99%', top: '24.4%', className: 'sm:text-[10px]' },
        { text: ageStr, left: '52.79%', top: '24.4%', className: 'sm:text-[10px]' },
        {
          text: diagValue,
          left: '23.98%',
          top: '27.92%',
          className: 'sm:text-[10px] font-medium whitespace-nowrap',
        },
        { text: todayStr, left: '69.81%', top: '16.76%', className: 'sm:text-[10px]' },
        {
          text: requestingPhysician,
          left: '24.45%',
          top: '80.07%',
          className: 'sm:text-[10px] font-bold',
        },
      ],
    };
  }

  return {
    imageSrc: '/docs/solicitud_imagenologia.png',
    aspectRatio: '612 / 936',
    overlays: [
      { text: nombres, left: '19.21%', top: '16.87%' },
      { text: primerApellido, left: '32.86%', top: '16.87%' },
      { text: segundoApellido, left: '45.01%', top: '16.87%' },
      { text: patient.rut || '', left: '9.88%', top: '18.38%' },
      { text: ageStr, left: '37.54%', top: '18.38%' },
      { text: birthStr, left: '77.28%', top: '18.38%' },
      {
        text: diagValue,
        left: '21.51%',
        top: '20.24%',
        className: 'font-medium whitespace-nowrap',
      },
      { text: todayStr, left: '22.72%', top: '14.71%' },
      {
        text: requestingPhysician,
        left: '51.47%',
        top: '85.61%',
        className: 'font-bold',
      },
    ],
  };
};
