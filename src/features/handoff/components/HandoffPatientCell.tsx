import React, { useState } from 'react';
import { Baby, Camera } from 'lucide-react';
import type { PatientData } from '@/domain/handoff/patientContracts';
import { buildClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';
import {
  WoundCareModal,
  WoundCareErrorBoundary,
  useWoundCarePhotoCount,
} from '@/features/wound-care/public';

interface HandoffPatientCellProps {
  patient: PatientData;
  isSubRow?: boolean;
}

export const HandoffPatientCell: React.FC<HandoffPatientCellProps> = ({ patient, isSubRow }) => {
  const [showWoundCare, setShowWoundCare] = useState(false);

  const hasValidEpisode = Boolean(patient.rut?.trim()) && Boolean(patient.admissionDate?.trim());
  const episodeKey = hasValidEpisode
    ? buildClinicalEpisodeKey(patient.rut, patient.admissionDate)
    : '';
  const photoCount = useWoundCarePhotoCount(hasValidEpisode && !isSubRow ? episodeKey : undefined);
  const hasPhotos = photoCount > 0;

  return (
    <td className="p-2 border-r border-slate-200/60 min-w-[150px] align-middle print:min-w-0 print:w-auto print:text-[10px] print:p-1">
      <div className="font-medium text-slate-800 flex flex-col gap-0.5 leading-snug print:leading-none">
        <div className="flex items-center gap-1 flex-wrap">
          {isSubRow && <Baby size={14} className="text-pink-400 print:hidden" />}
          {isSubRow && (
            <span className="hidden print:inline text-[8px] text-pink-600 font-bold">(RN)</span>
          )}
          <span className="font-bold text-slate-900">{patient.patientName}</span>
          {hasValidEpisode && !isSubRow && (
            <button
              type="button"
              onClick={() => setShowWoundCare(true)}
              className={`transition-colors print:hidden ${
                hasPhotos ? 'text-sky-500 hover:text-sky-600' : 'text-slate-300 hover:text-sky-500'
              }`}
              title={
                hasPhotos
                  ? `Registro clínico audiovisual (${photoCount} foto${photoCount > 1 ? 's' : ''})`
                  : 'Registro clínico audiovisual'
              }
            >
              <Camera size={14} />
            </button>
          )}
        </div>
        <div className="font-mono text-[10px] text-slate-500 leading-none mt-1">{patient.rut}</div>
        {patient.age && (
          <div className="text-slate-400 font-normal text-[10px] print:text-[8px] mt-0.5">
            ({patient.age})
          </div>
        )}
      </div>

      {showWoundCare && hasValidEpisode && (
        <WoundCareErrorBoundary patientName={patient.patientName}>
          <WoundCareModal
            isOpen
            onClose={() => setShowWoundCare(false)}
            patientName={patient.patientName}
            patientRut={patient.rut}
            episodeContext={{
              episodeKey,
              patientRut: patient.rut,
              patientName: patient.patientName,
            }}
          />
        </WoundCareErrorBoundary>
      )}
    </td>
  );
};
