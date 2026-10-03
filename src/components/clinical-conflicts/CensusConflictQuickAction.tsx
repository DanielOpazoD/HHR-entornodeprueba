import { CensusConflictToolbarFallback } from '@/components/layout/date-strip/CensusToolbarLoadingActions';
import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { ClinicalConflictCenterControl } from '@/components/clinical-conflicts/ClinicalConflictCenterControl';

/** Admin-only entrypoint for HHR/Firestore version conflicts in the census date strip. */
export const CensusConflictQuickAction: React.FC = () => {
  const { role } = useAuth();
  const { record } = useDailyRecordData();

  if (role !== 'admin') return null;
  if (!record?.date) return <CensusConflictToolbarFallback />;

  return (
    <ClinicalConflictCenterControl
      date={record.date}
      scope="census"
      currentRecord={record}
      buttonTestId="conflict-versions-button"
      buttonLabel="Conflictos HHR"
      hideButtonLabel
      buttonVariant="quick-action"
      className="shrink-0 self-center"
    />
  );
};
