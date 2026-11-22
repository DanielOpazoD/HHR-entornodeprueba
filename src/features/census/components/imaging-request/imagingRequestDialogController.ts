import { ClipboardList, FileText, ShieldCheck } from 'lucide-react';
import type { PatientData } from '@/types/domain/patient';
import type { CustomMark } from '@/features/census/components/imaging-request/imagingRequestPdfService';
import type { ActiveTextMark, DocumentOption, DocumentTypeOption } from './types';

interface ImagingDialogShellModel {
  title: string;
  subtitle?: string;
  patientName: string;
  patientRut?: string;
  patientPathology?: string;
}

interface ImagingPrintService {
  printImagingRequestForm: (
    patient: PatientData,
    requestingPhysician?: string,
    marks?: CustomMark[]
  ) => Promise<void>;
  printImagingEncuestaForm: (
    patient: PatientData,
    requestingPhysician?: string,
    marks?: CustomMark[]
  ) => Promise<void>;
  printConsentimientoForm: (
    patient: PatientData,
    requestingPhysician?: string,
    marks?: CustomMark[]
  ) => Promise<void>;
}

interface ImagingCanvasPoint {
  x: number;
  y: number;
}

interface ImagingCanvasIntent {
  nextMark?: CustomMark;
  nextActiveText: ActiveTextMark | null;
}

export const IMAGING_DOCUMENT_OPTIONS: DocumentTypeOption[] = [
  {
    id: 'solicitud',
    title: 'Formulario Solicitud',
    subtitle: 'Con autocompletado y marcado interactivo',
    icon: FileText,
    disabled: false,
  },
  {
    id: 'encuesta',
    title: 'Encuesta Medio Contraste',
    subtitle: 'Con autocompletado y marcado interactivo',
    icon: ClipboardList,
    disabled: false,
  },
  {
    id: 'consentimiento',
    title: 'Consentimiento Informado',
    subtitle: 'Documento legal para procedimientos',
    icon: ShieldCheck,
    disabled: false,
  },
];

export const buildImagingDialogShellModel = (patient: PatientData): ImagingDialogShellModel => ({
  title: 'Solicitud de Imágenes',
  subtitle: patient.patientName || undefined,
  patientName: patient.patientName,
  patientRut: patient.rut,
  patientPathology: patient.pathology,
});

export const buildImagingClosedState = () => ({
  marks: [] as CustomMark[],
  isPrinting: false,
  toolMode: 'cross' as const,
  activeText: null as ActiveTextMark | null,
});

export const resolveImagingCanvasIntent = (
  selectedDoc: DocumentOption,
  toolMode: 'cross' | 'text',
  point: ImagingCanvasPoint
): ImagingCanvasIntent => {
  if (!['solicitud', 'encuesta', 'consentimiento'].includes(selectedDoc)) {
    return { nextActiveText: null };
  }

  if (toolMode === 'cross') {
    return {
      nextMark: { x: point.x, y: point.y },
      nextActiveText: null,
    };
  }

  return {
    nextActiveText: { x: point.x, y: point.y, text: '' },
  };
};

export const runImagingPrintAction = async (
  printService: ImagingPrintService,
  selectedDoc: DocumentOption,
  patient: PatientData,
  requestingPhysician: string,
  marks: CustomMark[]
): Promise<void> => {
  if (selectedDoc === 'solicitud') {
    await printService.printImagingRequestForm(patient, requestingPhysician, marks);
    return;
  }

  if (selectedDoc === 'encuesta') {
    await printService.printImagingEncuestaForm(patient, requestingPhysician, marks);
    return;
  }

  await printService.printConsentimientoForm(patient, requestingPhysician, marks);
};
