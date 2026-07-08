/**
 * clinicalDocumentIeehPrintController
 *
 * Builds the data needed to print the IEEH (Informe Estadístico de
 * Egreso Hospitalario) from an epicrisis document.
 *
 * Discharge date follows the epicrisis "Fecha de alta" field (finf),
 * falling back to the epicrisis source date (sourceDailyRecordDate).
 * Discharge time is intentionally left blank — the nurse fills it
 * when physically discharging the patient from the census.
 */

import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import type { DischargeFormData } from '@/services/pdf/ieehPdfContracts';
import { normalizeCalendarDate } from '@/utils/clinicalDateUtils';

// ---------------------------------------------------------------------------
// Doctor name parsing
// ---------------------------------------------------------------------------

export interface ParsedDoctorName {
  apellido1: string;
  apellido2: string;
  nombre: string;
}

/**
 * Splits a doctor's full name string into surname and name parts.
 *
 * Expected format: "Apellido1 Apellido2 Nombre(s)"
 *  - 1 part  → apellido1 only
 *  - 2 parts → apellido1 + nombre (no second surname)
 *  - 3+ parts → apellido1 + apellido2 + remaining as nombre
 *
 * @param fullName - Doctor's full name as stored in `doc.medico`.
 */
export const parseDoctorName = (fullName: string): ParsedDoctorName => {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length === 0 || (parts.length === 1 && !parts[0])) {
    return { apellido1: '', apellido2: '', nombre: '' };
  }
  if (parts.length === 1) {
    return { apellido1: parts[0], apellido2: '', nombre: '' };
  }
  if (parts.length === 2) {
    return { apellido1: parts[0], apellido2: '', nombre: parts[1] };
  }
  return {
    apellido1: parts[0],
    apellido2: parts[1],
    nombre: parts.slice(2).join(' '),
  };
};

const parseNameFirstDoctorName = (fullName: string): ParsedDoctorName => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { apellido1: '', apellido2: '', nombre: '' };
  }
  if (parts.length === 1) {
    return { apellido1: '', apellido2: '', nombre: parts[0] };
  }
  if (parts.length === 2) {
    return { apellido1: parts[1], apellido2: '', nombre: parts[0] };
  }

  return {
    apellido1: parts.at(-2) ?? '',
    apellido2: parts.at(-1) ?? '',
    nombre: parts.slice(0, -2).join(' '),
  };
};

const resolveIeehDoctorName = (doc: ClinicalDocumentRecord): ParsedDoctorName => {
  if (typeof doc.ieehDraft?.tratanteNombreCompleto === 'string') {
    return parseNameFirstDoctorName(doc.ieehDraft.tratanteNombreCompleto);
  }

  return parseDoctorName(doc.medico);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Patient snapshot extracted from the clinical document's patientFields
 * and record metadata. Covers every field that `fillIEEHForm()` reads.
 */
export interface IeehPatientSnapshot {
  patientName: string;
  rut: string;
  documentType?: string;
  admissionDate?: string;
  admissionTime?: string;
  birthDate?: string;
  biologicalSex?: string;
  insurance?: string;
  isRapanui?: boolean;
  admissionOrigin?: string;
  specialty?: string;
}

// ---------------------------------------------------------------------------
// Builder — patient
// ---------------------------------------------------------------------------

/**
 * Extracts patient demographic data from clinical document fields.
 * Maps every field used by `fillIEEHForm()` in the IEEH PDF service.
 *
 * @param doc - The epicrisis document with patientFields populated.
 * @returns Patient snapshot for IEEH PDF generation.
 */
/**
 * @param doc - The epicrisis document with patientFields populated.
 * @param workspacePatient - Optional workspace patient data (has birthDate, etc.)
 * @returns Patient snapshot for IEEH PDF generation.
 */
export const buildIeehPatientFromEpicrisis = (
  doc: ClinicalDocumentRecord,
  workspacePatient?: { birthDate?: string }
): IeehPatientSnapshot => {
  const fieldValue = (id: string): string => doc.patientFields.find(f => f.id === id)?.value ?? '';
  const firstFieldValue = (...ids: string[]): string => {
    for (const id of ids) {
      const value = fieldValue(id).trim();
      if (value) return value;
    }
    return '';
  };

  const isRapanuiRaw = fieldValue('isRapanui');

  return {
    patientName: firstFieldValue('nombre', 'patientName') || doc.patientName,
    rut: firstFieldValue('rut', 'patientRut') || doc.patientRut,
    documentType: fieldValue('documentType') || 'RUT',
    admissionDate: firstFieldValue('fing', 'admissionDate') || doc.admissionDate,
    admissionTime: fieldValue('admissionTime'),
    birthDate: firstFieldValue('fecnac', 'birthDate') || workspacePatient?.birthDate,
    biologicalSex: fieldValue('sex') || fieldValue('biologicalSex'),
    insurance: fieldValue('insurance'),
    isRapanui: isRapanuiRaw === 'true' || isRapanuiRaw === 'Sí',
    admissionOrigin: fieldValue('admissionOrigin'),
    specialty:
      typeof doc.ieehDraft?.tratanteEspecialidad === 'string'
        ? doc.ieehDraft.tratanteEspecialidad.trim()
        : doc.especialidad,
  };
};

const resolveIeehDischargeDateFromEpicrisis = (doc: ClinicalDocumentRecord): string | undefined => {
  const fieldValue = (id: string): string => doc.patientFields.find(f => f.id === id)?.value ?? '';
  return (
    normalizeCalendarDate(fieldValue('finf')) || normalizeCalendarDate(doc.sourceDailyRecordDate)
  );
};

// ---------------------------------------------------------------------------
// Builder — discharge
// ---------------------------------------------------------------------------

/**
 * Builds the discharge form data from the epicrisis IEEH draft.
 *
 * - Discharge **date** = the visible "Fecha de alta" field, falling back
 *   to the epicrisis source date.
 * - Discharge **time** = blank (to be filled by hand).
 * - Days of stay are calculated automatically by the PDF service from
 *   admissionDate and dischargeDate.
 *
 * @param doc - The epicrisis with ieehDraft populated.
 * @returns DischargeFormData ready for `fillIEEHForm()`.
 */
export const buildIeehDischargeFromEpicrisis = (doc: ClinicalDocumentRecord): DischargeFormData => {
  const draft = doc.ieehDraft;
  if (!draft) return {};

  const doctorName = resolveIeehDoctorName(doc);

  return {
    diagnosticoPrincipal: draft.diagnosticoPrincipal,
    cie10Code: draft.cie10Code,
    condicionEgreso: draft.condicionEgreso,
    intervencionQuirurgica: draft.intervencionQuirurgica,
    intervencionQuirurgDescrip: draft.intervencionQuirurgDescrip,
    intervencionCodigo: draft.intervencionCodigo,
    procedimiento: draft.procedimiento,
    procedimientoDescrip: draft.procedimientoDescrip,
    procedimientoCodigo: draft.procedimientoCodigo,
    tratanteApellido1: doctorName.apellido1,
    tratanteApellido2: doctorName.apellido2,
    tratanteNombre: doctorName.nombre,
    tratanteRut: draft.tratanteRut,
    // Discharge date follows the visible "Fecha de alta" field when it was configured.
    dischargeDate: resolveIeehDischargeDateFromEpicrisis(doc),
    // Discharge time left blank — nurse fills it at physical discharge
    // dischargeTime: undefined,
  };
};
