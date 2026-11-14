import { CensusConflictMenuFallback } from '@/components/layout/date-strip/CensusToolbarLoadingActions';
import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { ClinicalConflictCenterControl } from '@/components/clinical-conflicts/ClinicalConflictCenterControl';

/** Admin-only entrypoint for HHR/Firestore version conflicts in the census options menu. */
export const CensusConflictQuickAction: React.FC = () => {
  const { role } = useAuth();
  const { record } = useDailyRecordData();

  if (role !== 'admin') return null;
  if (!record?.date) return <CensusConflictMenuFallback />;

  return (
    <ClinicalConflictCenterControl
      date={record.date}
      scope="census"
      currentRecord={record}
      buttonTestId="conflict-versions-button"
      buttonLabel="Conflictos HHR"
      buttonVariant="menu"
    />
  );
};
