import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { FlaskConical } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { useCensusToolbarMenuTarget } from '@/shared/ui/CensusToolbarMenuTargetContext';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';
import { lazyWithRetry } from '@/utils/lazyWithRetry';
import type { CensusLabPatient } from '@/features/laboratory/census-inbox';

const Inbox = lazyWithRetry(() =>
  import('@/features/laboratory/census-inbox').then(module => ({
    default: module.CensusLaboratoryInbox,
  }))
);

export const CensusLaboratoryMenuEntry = ({
  patients,
  excluded,
  censusDate,
}: {
  patients: CensusLabPatient[];
  excluded: number;
  censusDate: string;
}) => {
  const target = useCensusToolbarMenuTarget();
  const { currentUser } = useAuth();
  const epoch = useSessionEpoch();
  const scope = `${currentUser?.uid}:${currentUser?.role}:${epoch}:${censusDate}`;
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <>
      {target &&
        createPortal(
          <button
            type="button"
            data-census-menu-action
            data-testid="census-laboratory-menu-entry"
            className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100`}
            onClick={() => setOpened(scope)}
          >
            <FlaskConical size={13} aria-hidden="true" />
            <span>Resultados nuevos</span>
          </button>,
          target
        )}
      {opened === scope && (
        <Suspense
          fallback={
            <p role="status">
              Abriendo resultados del censo…{' '}
              <button onClick={() => setOpened(null)}>Cancelar apertura</button>
            </p>
          }
        >
          <Inbox
            patients={patients}
            excluded={excluded}
            censusDate={censusDate}
            onClose={() => setOpened(null)}
          />
        </Suspense>
      )}
    </>
  );
};
