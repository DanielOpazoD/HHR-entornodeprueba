import { BEDS } from '@/constants/beds';
import { isClinicalFormRut } from './clinicalFormIdentity';
import type { PatientData } from '@/shared/contracts/patientDomainContracts';
import type { MedifSourceRecord } from '../medifPatientPrefill';
import { formAgeAt, parseFormDate } from './clinicalFormDates';
import type {
  ClinicalFormPatientOption,
  ClinicalFormProvenance,
  ClinicalFormValues,
} from './clinicalFormTypes';

const trim = (value: string | undefined): string => value?.trim() ?? '';

/** Project only the authorized census fields used by forms. Never write to the census. */
export const buildClinicalFormPatientOptions = (
  record: MedifSourceRecord | null
): ClinicalFormPatientOption[] => {
  if (!record || !parseFormDate(record.date)) return [];
  const options: ClinicalFormPatientOption[] = [];
  const activeExtras = new Set(record.activeExtraBeds ?? []);
  const add = (
    patient: PatientData,
    bedId: string,
    bedLabel: string,
    location: 'bed' | 'clinicalCrib'
  ) => {
    if (patient.isBlocked || !trim(patient.patientName)) return;
    const values: ClinicalFormValues = {};
    const provenance: Record<string, ClinicalFormProvenance> = {};
    const root = `beds.${bedId}${location === 'clinicalCrib' ? '.clinicalCrib' : ''}`;
    const put = (id: string, value: string | undefined, path: string, transformation = 'copy') => {
      const text = trim(value);
      if (!text) return;
      values[id] = text;
      provenance[id] = {
        source: 'hhr',
        sourcePath: `${root}.${path}`,
        recordDate: record.date,
        sourceLastUpdated: record.lastUpdated ?? '',
        transformation,
      };
    };
    const direct: Array<[string, string | undefined, string]> = [
      ['paciente_documento_tipo', patient.documentType, 'documentType'],
      ['paciente_identidad_estado', patient.identityStatus, 'identityStatus'],
      ['paciente_nombre_completo', patient.patientName, 'patientName'],
      ['paciente_nombres', patient.firstName, 'firstName'],
      ['paciente_apellido_paterno', patient.lastName, 'lastName'],
      ['paciente_apellido_materno', patient.secondLastName, 'secondLastName'],
      ['paciente_sexo_biologico', patient.biologicalSex, 'biologicalSex'],
      ['ingreso_hora', patient.admissionTime, 'admissionTime'],
      ['ingreso_origen', patient.admissionOrigin, 'admissionOrigin'],
      ['diagnostico_texto', patient.pathology, 'pathology'],
      ['diagnostico_cie10_codigo', patient.cie10Code, 'cie10Code'],
      ['diagnostico_cie10_descripcion', patient.cie10Description, 'cie10Description'],
      ['diagnostico_observaciones', patient.diagnosisComments, 'diagnosisComments'],
      ['paciente_especialidad', patient.specialty, 'specialty'],
      ['medico_tratante_id', patient.treatingPhysicianId, 'treatingPhysicianId'],
      ['medico_tratante_nombre', patient.treatingPhysicianName, 'treatingPhysicianName'],
      ['episodio_id', patient.clinicalEpisodeId, 'clinicalEpisodeId'],
      ['cama_nombre', bedLabel, 'bedName'],
    ];
    direct.forEach(([id, value, path]) => put(id, value, path));
    // A provisional identity and a maternal RUT are never a newborn's own document.
    if (patient.identityStatus !== 'provisional' && patient.documentType) {
      put('paciente_documento_numero', patient.rut, 'rut');
      if (patient.documentType === 'RUT' && isClinicalFormRut(trim(patient.rut))) {
        put('paciente_rut', patient.rut, 'rut', 'verifiedRut');
      }
    }
    if (parseFormDate(trim(patient.birthDate)))
      put('paciente_fecha_nacimiento', patient.birthDate, 'birthDate');
    if (parseFormDate(patient.admissionDate))
      put('ingreso_fecha', patient.admissionDate, 'admissionDate');
    put(
      'paciente_edad_texto',
      trim(patient.age) || formAgeAt(trim(patient.birthDate), record.date),
      trim(patient.age) ? 'age' : 'birthDate',
      trim(patient.age) ? 'copy' : `calendarAgeAt:${record.date}`
    );
    values.cama_id = bedId;
    values.cama_ubicacion = location;
    values.censo_fecha = record.date;
    values.censo_actualizado_en = record.lastUpdated ?? '';
    const episodeId = trim(patient.clinicalEpisodeId);
    const identity = JSON.stringify([
      patient.patientName,
      patient.rut,
      patient.documentType,
      patient.identityStatus,
      patient.admissionDate,
    ]);
    options.push({
      key: JSON.stringify([record.date, bedId, location, episodeId, identity]),
      label: `${bedLabel}${location === 'clinicalCrib' ? ' · Cuna clínica' : ''} — ${trim(patient.patientName)}`,
      values,
      provenance,
      context: {
        recordDate: record.date,
        bedId,
        location,
        episodeId,
        identity,
        sourceLastUpdated: record.lastUpdated ?? '',
      },
    });
  };
  for (const bed of BEDS) {
    if (bed.id.startsWith('CMA_') || (bed.isExtra && !activeExtras.has(bed.id))) continue;
    const patient = record.beds[bed.id];
    if (!patient || patient.isBlocked) continue;
    const label = trim(patient.bedName) || bed.name;
    add(patient, bed.id, label, 'bed');
    if (patient.clinicalCrib) add(patient.clinicalCrib, bed.id, label, 'clinicalCrib');
  }
  return options;
};

export const isEmptyFormValue = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && !value.trim());

/** Refresh proposals only on empty fields, including preserving explicit false and zero text. */
export const mergeEmptyFormValues = (current: ClinicalFormValues, proposed: ClinicalFormValues) => {
  const values = { ...current };
  for (const [id, value] of Object.entries(proposed)) {
    if (isEmptyFormValue(values[id])) values[id] = value;
  }
  return values;
};
