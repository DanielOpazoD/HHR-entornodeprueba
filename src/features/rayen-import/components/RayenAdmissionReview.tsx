import type {
  CensusImportDiff,
  CmaAdmissionDisposition,
  CmaAdmissionResolution,
} from '../contracts/censusImportDiff';
import { cmaAdmissionReviewKey } from '../domain/cmaAdmissionReview';
import { Section } from './RayenImportDiffReviewParts';

interface RayenAdmissionReviewProps {
  admissions: CensusImportDiff['admissions'];
  cmaAdmissionResolutions: CmaAdmissionResolution[];
  onCmaAdmissionResolutionsChange: (resolutions: CmaAdmissionResolution[]) => void;
}

export const RayenAdmissionReview = ({
  admissions,
  cmaAdmissionResolutions,
  onCmaAdmissionResolutionsChange,
}: RayenAdmissionReviewProps) => {
  const cmaAdmissions = admissions.filter(entry => entry.isCma);
  const selectedDisposition = (admissionKey: string): CmaAdmissionDisposition | undefined =>
    cmaAdmissionResolutions.find(resolution => resolution.admissionKey === admissionKey)
      ?.disposition;
  const selectDisposition = (admissionKey: string, disposition: CmaAdmissionDisposition): void => {
    onCmaAdmissionResolutionsChange([
      ...cmaAdmissionResolutions.filter(resolution => resolution.admissionKey !== admissionKey),
      { admissionKey, disposition },
    ]);
  };

  return (
    <>
      <Section title="Ingresos" count={admissions.length}>
        {admissions.map(entry => (
          <li key={`adm-${entry.bedId}`}>
            <div>
              <span className="font-semibold">{entry.bedId}</span> — {entry.patient.patientName}
              {entry.isCma && <span className="ml-1 text-teal-600">(procedencia CMA)</span>}
            </div>
            {entry.patient.clinicalCrib?.patientName && (
              <div className="ml-4 text-gray-600">
                ↳ Cuna RN — {entry.patient.clinicalCrib.patientName}
              </div>
            )}
          </li>
        ))}
      </Section>

      {cmaAdmissions.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h4 className="mb-1 text-sm font-semibold text-amber-900">
            Revisar ingresos provenientes de CMA ({cmaAdmissions.length})
          </h4>
          <p className="mb-2 text-xs leading-relaxed text-amber-800">
            Eloísa usa CMA como ubicación administrativa. Confirma que cada paciente ocupa realmente
            la cama física indicada antes de incorporarlo al censo HHR.
          </p>
          <ul className="space-y-3 text-sm text-amber-950">
            {cmaAdmissions.map(entry => {
              const admissionKey = cmaAdmissionReviewKey(entry);
              const radioName = `cma-admission-${admissionKey}`;
              return (
                <li key={admissionKey} className="rounded border border-amber-200 bg-white/60 p-2">
                  <div className="mb-2">
                    <span className="font-semibold">{entry.bedId}</span> —{' '}
                    {entry.patient.patientName}
                  </div>
                  <label className="mb-1 flex items-start gap-2">
                    <input
                      type="radio"
                      name={radioName}
                      checked={selectedDisposition(admissionKey) === 'admit'}
                      onChange={() => selectDisposition(admissionKey, 'admit')}
                      className="mt-0.5 h-4 w-4"
                    />
                    Incorporar al censo en la cama {entry.bedId}
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={radioName}
                      checked={selectedDisposition(admissionKey) === 'defer'}
                      onChange={() => selectDisposition(admissionKey, 'defer')}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      No incorporar por ahora
                      <span className="block text-xs font-normal text-amber-700">
                        Se volverá a proponer mientras continúe presente en Eloísa.
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
};
