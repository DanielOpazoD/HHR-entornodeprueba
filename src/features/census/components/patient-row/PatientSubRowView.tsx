import React from 'react';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { PatientInputCells } from './PatientInputCells';
import { shouldShowSubRowDemographicsButton } from '@/features/census/controllers/patientRowSubViewController';
import type { PatientSubRowViewProps } from '@/features/census/components/patient-row/patientRowContracts';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { PatientActionMenu } from '@/features/census/components/patient-row/PatientActionMenu';
import { LoaderCircle } from 'lucide-react';

export const PatientSubRowView: React.FC<PatientSubRowViewProps> = ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  diagnosisMode,
  accessProfile = 'default',
  style,
  onOpenDemographics,
  onOpenHistory,
  onRemoveClinicalCrib,
  onChange,
  isPendingClear = false,
}) => {
  const showDemographicsButton = shouldShowSubRowDemographicsButton({
    readOnly,
    specialistAccess: isSpecialistCensusAccessProfile(accessProfile),
  });

  return (
    <tr
      className={`${isPendingClear ? 'bg-amber-50/70 opacity-75' : 'bg-white hover:bg-white'} transition-colors border-b border-slate-200 text-[13px] leading-tight`}
      style={style}
      data-testid="patient-row"
      data-clear-pending={isPendingClear || undefined}
      aria-busy={isPendingClear}
    >
      <td className="p-0 text-right border-r border-slate-200 align-middle group/crib-config">
        <div className="flex justify-center items-center h-full gap-1">
          {isPendingClear ? (
            <span
              className="inline-flex items-center justify-center text-amber-700"
              role="status"
              title="Confirmando limpieza…"
              aria-label="Confirmando limpieza de la cuna"
            >
              <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
            </span>
          ) : showDemographicsButton ? (
            <PatientActionMenu
              isBlocked={false}
              readOnly={readOnly}
              clinicalEditingDisabled={clinicalEditingDisabled}
              accessProfile={accessProfile}
              hasPatientIdentity={true}
              showCmaAction={false}
              allowedActions={['clear']}
              onAction={action => {
                if (action === 'clear') void onRemoveClinicalCrib();
              }}
              onViewDemographics={onOpenDemographics}
              onViewHistory={onOpenHistory}
            />
          ) : null}
        </div>
      </td>
      <td className="p-0 border-r border-slate-200 text-center w-16">
        <MedicalBadge variant="purple" className="w-10 justify-center mx-auto">
          CUNA
        </MedicalBadge>
      </td>
      <PatientInputCells
        data={data}
        currentDateString={currentDateString}
        isSubRow={true}
        diagnosisMode={diagnosisMode}
        onChange={onChange}
        onDemo={onOpenDemographics}
        readOnly={readOnly}
        clinicalEditingDisabled={clinicalEditingDisabled}
        clinicalFieldLocks={clinicalFieldLocks}
        accessProfile={accessProfile}
      />
    </tr>
  );
};
