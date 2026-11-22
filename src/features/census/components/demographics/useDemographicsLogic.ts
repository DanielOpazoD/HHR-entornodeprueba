import { useState, useEffect, useMemo } from 'react';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import { useAuditContext } from '@/context/AuditContext';
import {
  DemographicSubset,
  LocalDemographicsState,
  Insurance,
  Origin,
  BiologicalSex,
} from './types';
import type { AdmissionOrigin } from '@/types/domain/patient';
import {
  buildLocalData,
  composeFullName,
  calculateFormattedAge,
  hasMeaningfulLocalDemographics,
  resolveRequiredDemographicsCompletion,
} from './utils';
import { normalizeNameSpacing } from '@/utils/legacyNameParts';
import type { PatientData } from '@/types/domain/patient';

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
  const [localData, setLocalData] = useState<LocalDemographicsState>(() =>
    buildLocalData(data, isClinicalCribPatient)
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && data.patientName) {
      logPatientView(bedId, data.patientName, data.rut, recordDate);
    }
  }, [isOpen, data.patientName, data.rut, bedId, recordDate, logPatientView]);

  const isProvisionalRnMode = isClinicalCribPatient && localData.identityStatus === 'provisional';

  const displayName = useMemo(() => {
    if (isProvisionalRnMode) {
      return normalizeNameSpacing(localData.provisionalName) || 'RN provisional';
    }
    return (
      composeFullName(localData.firstName, localData.lastName, localData.secondLastName) ||
      normalizeNameSpacing(data.patientName || '') ||
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
      const birthDateValidation = PatientInputSchema.shape.birthDate.safeParse(localData.birthDate);
      if (!birthDateValidation.success) {
        setError(birthDateValidation.error.issues[0]?.message ?? 'Fecha de nacimiento inválida.');
        return;
      }
    }

    const age = localData.birthDate ? calculateFormattedAge(localData.birthDate) : data.age;

    if (isProvisionalRnMode) {
      const provisionalName = normalizeNameSpacing(localData.provisionalName);
      const nameValidation = PatientInputSchema.shape.patientName.safeParse(provisionalName);
      if (!nameValidation.success) {
        setError(nameValidation.error.issues[0]?.message ?? 'Nombre inválido.');
        return;
      }

      onSave({
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

    const fullName = composeFullName(
      localData.firstName,
      localData.lastName,
      localData.secondLastName
    );
    if (fullName) {
      const nameValidation = PatientInputSchema.shape.patientName.safeParse(fullName);
      if (!nameValidation.success) {
        setError(nameValidation.error.issues[0]?.message ?? 'Nombre inválido.');
        return;
      }
    }

    onSave({
      identityStatus: 'official',
      firstName: normalizeNameSpacing(localData.firstName),
      lastName: normalizeNameSpacing(localData.lastName),
      secondLastName: normalizeNameSpacing(localData.secondLastName),
      patientName: fullName,
      rut: localData.rut.trim(),
      documentType: localData.documentType,
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
