import { useState, useEffect, useMemo } from 'react';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { useAuditContext } from '@/context/AuditContext';
import {
  DemographicSubset,
  LocalDemographicsState,
  Insurance,
  AdmissionOrigin,
  Origin,
  BiologicalSex,
} from './types';
import {
  buildLocalData,
  normalizeNamePart,
  composeFullName,
  calculateFormattedAge,
  hasMeaningfulLocalDemographics,
  resolveRequiredDemographicsCompletion,
} from './utils';
import type { PatientData } from '@/types/domain/patient';
import { isPatientIdentityField } from '@/shared/census/patientIdentityReview';

const IDENTITY_INPUTS = [
  'firstName',
  'lastName',
  'secondLastName',
  'provisionalName',
  'identityStatus',
  'rut',
  'documentType',
  'admissionDate',
  'admissionTime',
] as const satisfies readonly (keyof LocalDemographicsState)[];

const withoutIdentity = (fields: Partial<PatientData>): Partial<PatientData> =>
  Object.fromEntries(Object.entries(fields).filter(([field]) => !isPatientIdentityField(field)));

interface UseDemographicsLogicProps {
  data: DemographicSubset;
  isClinicalCribPatient: boolean;
  isOpen: boolean;
  bedId: string;
  recordDate: string;
  onSave: (updatedFields: Partial<PatientData>) => void;
  onClose: () => void;
  onEmptySave?: () => void;
  requiresCompleteDemographics?: boolean;
}

// El guardado demográfico es ESTRICTAMENTE estructural: nunca incluye campos
// de autoridad clínica (pathology/diagnóstico, especialidad, etc.). Incluir
// pathology mezclaba autoridades → la separación rechazaba TODO guardado
// demográfico (409 sistemático) y el auto-merge posterior podía perder el
// diagnóstico. El diagnóstico se edita solo en su campo del censo, por su
// canal clínico.
export const useDemographicsLogic = ({
  data,
  isClinicalCribPatient,
  isOpen,
  bedId,
  recordDate,
  onSave,
  onClose,
  onEmptySave,
  requiresCompleteDemographics = false,
}: UseDemographicsLogicProps) => {
  const { logPatientView } = useAuditContext();
  const [initialData] = useState(() => buildLocalData(data, isClinicalCribPatient));
  const [localData, setLocalData] = useState<LocalDemographicsState>(initialData);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && data.patientName) {
      logPatientView(bedId, data.patientName, data.rut, recordDate);
    }
  }, [isOpen, data.patientName, data.rut, bedId, recordDate, logPatientView]);

  const isProvisionalRnMode = isClinicalCribPatient && localData.identityStatus === 'provisional';

  const displayName = useMemo(() => {
    if (isProvisionalRnMode) {
      return normalizeNamePart(localData.provisionalName) || 'RN provisional';
    }
    return (
      composeFullName(localData.firstName, localData.lastName, localData.secondLastName) ||
      normalizeNamePart(data.patientName || '') ||
      'Paciente Nuevo'
    );
  }, [
    data.patientName,
    isProvisionalRnMode,
    localData.firstName,
    localData.lastName,
    localData.provisionalName,
    localData.secondLastName,
  ]);

  const displayRut = isProvisionalRnMode
    ? 'Sin RUT (RN provisional)'
    : localData.rut || 'RUT No especificado';

  const requiredCompletion = useMemo(
    () =>
      requiresCompleteDemographics
        ? resolveRequiredDemographicsCompletion(localData, isProvisionalRnMode)
        : { isComplete: true, missingFields: [] },
    [isProvisionalRnMode, localData, requiresCompleteDemographics]
  );

  const requiredCompletionMessage = requiredCompletion.missingFields.length
    ? `Faltan ${requiredCompletion.missingFields.length}`
    : null;

  // An identity under review is written only by an edit of it: saving what the form showed would
  // stand in for the review.
  const writesIdentity =
    !data.identityReview || IDENTITY_INPUTS.some(input => localData[input] !== initialData[input]);
  const save = (fields: Partial<PatientData>) =>
    onSave(writesIdentity ? fields : withoutIdentity(fields));

  const handleSave = () => {
    if (!requiredCompletion.isComplete) {
      setError(requiredCompletionMessage);
      return;
    }

    if (!hasMeaningfulLocalDemographics(localData)) {
      onEmptySave?.();
      onClose();
      return;
    }

    if (localData.birthDate) {
      const birthDateValidation = PatientInputSchema.pick({ birthDate: true }).safeParse({
        birthDate: localData.birthDate,
      });
      if (!birthDateValidation.success) {
        setError(birthDateValidation.error.issues[0].message);
        return;
      }
    }

    const age = localData.birthDate ? calculateFormattedAge(localData.birthDate) : data.age;

    if (isProvisionalRnMode) {
      const provisionalName = normalizeNamePart(localData.provisionalName);
      const nameValidation = PatientInputSchema.pick({ patientName: true }).safeParse({
        patientName: provisionalName,
      });
      if (!nameValidation.success) {
        setError(nameValidation.error.issues[0].message);
        return;
      }

      save({
        identityStatus: 'provisional',
        patientName: provisionalName,
        firstName: '',
        lastName: '',
        secondLastName: '',
        rut: '',
        documentType: 'RUT',
        birthDate: localData.birthDate,
        admissionDate: localData.admissionDate,
        admissionTime: localData.admissionTime,
        insurance: localData.insurance as Insurance,
        admissionOrigin: localData.admissionOrigin as AdmissionOrigin,
        admissionOriginDetails: localData.admissionOriginDetails,
        origin: localData.origin as Origin,
        isRapanui: localData.isRapanui,
        biologicalSex: localData.biologicalSex as BiologicalSex,
        age,
      });
      onClose();
      return;
    }

    const documentType = localData.documentType || undefined;
    if (!documentType && writesIdentity) {
      setError('Elige RUT o pasaporte: el tipo de documento guardado no se pudo leer.');
      return;
    }

    const fullName = composeFullName(
      localData.firstName,
      localData.lastName,
      localData.secondLastName
    );
    if (fullName) {
      const nameValidation = PatientInputSchema.pick({ patientName: true }).safeParse({
        patientName: fullName,
      });
      if (!nameValidation.success) {
        setError(nameValidation.error.issues[0].message);
        return;
      }
    }

    save({
      identityStatus: 'official',
      firstName: normalizeNamePart(localData.firstName),
      lastName: normalizeNamePart(localData.lastName),
      secondLastName: normalizeNamePart(localData.secondLastName),
      patientName: fullName,
      rut: localData.rut.trim(),
      documentType,
      birthDate: localData.birthDate,
      admissionDate: localData.admissionDate,
      admissionTime: localData.admissionTime,
      insurance: localData.insurance as Insurance,
      admissionOrigin: localData.admissionOrigin as AdmissionOrigin,
      admissionOriginDetails: localData.admissionOriginDetails,
      origin: localData.origin as Origin,
      isRapanui: localData.isRapanui,
      biologicalSex: localData.biologicalSex as BiologicalSex,
      age,
    });
    onClose();
  };

  return {
    localData,
    setLocalData,
    error,
    setError,
    isProvisionalRnMode,
    displayName,
    displayRut,
    handleSave,
    requiredCompletion,
    requiredCompletionMessage,
  };
};
