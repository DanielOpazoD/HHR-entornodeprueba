import React from 'react';
import { FlaskConical } from 'lucide-react';
import { LabResultsViewerModal } from './LabResultsViewerModal';
import { checkSyslabConnection } from '@/services/laboratory/syslabService';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';

interface LaboratoryQuickActionProps {
  patients: MedicalIndicationsPatientOption[];
}

export const LaboratoryQuickAction: React.FC<LaboratoryQuickActionProps> = ({ patients }) => {
  const [isLabOpen, setIsLabOpen] = React.useState(false);
  const [connectionStatus, setConnectionStatus] = React.useState<
    'checking' | 'available' | 'unavailable'
  >('checking');
  const [connectionMessage, setConnectionMessage] = React.useState('Verificando conexión Syslab');

  const labPatients = React.useMemo(
    () =>
      patients
        .filter(patient => patient.rut && patient.patientName)
        .map(patient => ({
          bedId: patient.bedId,
          label: patient.label,
          patientName: patient.patientName,
          rut: patient.rut,
          clinicalEpisodeId: patient.clinicalEpisodeId,
          birthDate: patient.birthDate,
          diagnosis: patient.diagnosis,
        })),
    [patients]
  );

  React.useEffect(() => {
    let active = true;

    if (labPatients.length === 0) {
      setConnectionStatus('unavailable');
      setConnectionMessage('No hay pacientes con RUT para consultar Syslab');
      return () => {
        active = false;
      };
    }

    setConnectionStatus('checking');
    setConnectionMessage('Verificando conexión Syslab');
    void checkSyslabConnection().then(result => {
      if (!active) {
        return;
      }
      setConnectionStatus(result.available ? 'available' : 'unavailable');
      setConnectionMessage(
        result.available
          ? 'Laboratorio / Exámenes Syslab'
          : `Syslab no disponible: ${result.message}`
      );
    });

    return () => {
      active = false;
    };
  }, [labPatients.length]);

  const isDisabled = labPatients.length === 0;
  const buttonTone =
    connectionStatus === 'unavailable' && labPatients.length > 0
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-700';

  return (
    <>
      <button
        onClick={() => {
          if (!isDisabled) setIsLabOpen(true);
        }}
        data-testid="lab-quick-action"
        disabled={isDisabled}
        className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} ${buttonTone} transition-colors disabled:cursor-default disabled:opacity-60`}
        title={connectionMessage}
        aria-disabled={isDisabled}
      >
        <FlaskConical size={13} />
        <span className="hidden sm:inline">Lab</span>
      </button>
      {labPatients.length > 0 && (
        <LabResultsViewerModal
          isOpen={isLabOpen}
          onClose={() => setIsLabOpen(false)}
          patients={labPatients}
        />
      )}
    </>
  );
};
