import type { DischargeVerification } from '../contracts/censusImportDiff';
import type { EgresoRecord } from '../contracts/egresoLookup';

const stateFromBoolean = (value: unknown): DischargeVerification['medicalEpicrisis'] =>
  value === true ? 'confirmed' : value === false ? 'not-detected' : 'unknown';

export const confirmHospitalDischarge = (
  existing?: DischargeVerification,
  egreso?: EgresoRecord
): DischargeVerification => ({
  medicalEpicrisis:
    egreso && typeof egreso.hasMedicalDischarge === 'boolean'
      ? stateFromBoolean(egreso.hasMedicalDischarge)
      : (existing?.medicalEpicrisis ?? 'unknown'),
  nursingEpicrisis:
    egreso &&
    (typeof egreso.hasNurseDischarge === 'boolean' ||
      typeof egreso.hasNursingDischarge === 'boolean')
      ? stateFromBoolean(egreso.hasNurseDischarge ?? egreso.hasNursingDischarge)
      : (existing?.nursingEpicrisis ?? 'unknown'),
  hospitalDischarge: 'confirmed',
});
