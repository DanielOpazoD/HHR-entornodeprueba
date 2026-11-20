import React, { Suspense } from 'react';
import { FlaskConical, Lock } from 'lucide-react';
import { XRayIcon } from '@/components/ui/XRayIcon';
import type { CensusQuickActionPatient } from '@/shared/contracts/censusQuickActionPatient';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';
import type {
  DateStripRadiologyPatient,
  DateStripRadiologyViewer,
} from '@/components/layout/date-strip/dateStripRadiologyViewer';

const FEATURE_QUICK_ACTIONS_STARTUP_DELAY_MS = 1200;

interface DateStripQuickActionsProps {
  onOpenBedManager?: () => void;
  censusQuickActionPatients?: CensusQuickActionPatient[];
  renderFeatureQuickActions?: (patients: CensusQuickActionPatient[]) => React.ReactNode;
  radiologyViewer?: DateStripRadiologyViewer;
  hideClinicalQuickActions?: boolean;
  menuLayout?: boolean;
}

export const DateStripQuickActions: React.FC<DateStripQuickActionsProps> = ({
  onOpenBedManager,
  censusQuickActionPatients = [],
  renderFeatureQuickActions,
  radiologyViewer: RadiologyViewer,
  hideClinicalQuickActions = false,
  menuLayout = false,
}) => {
  const [isRadiologyOpen, setIsRadiologyOpen] = React.useState(false);
  const [canRenderFeatureQuickActions, setCanRenderFeatureQuickActions] = React.useState(false);

  const featureQuickActionsHidden = hideClinicalQuickActions || !renderFeatureQuickActions;
  if (
    useChangedOnRender([hideClinicalQuickActions, renderFeatureQuickActions]) &&
    featureQuickActionsHidden
  ) {
    setCanRenderFeatureQuickActions(false);
  }
  React.useEffect(() => {
    if (hideClinicalQuickActions || !renderFeatureQuickActions) return;

    const timeoutId = window.setTimeout(() => {
      setCanRenderFeatureQuickActions(true);
    }, FEATURE_QUICK_ACTIONS_STARTUP_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hideClinicalQuickActions, renderFeatureQuickActions]);

  const quickActionPatients = React.useMemo(
    () => censusQuickActionPatients.filter(p => p.rut && p.patientName),
    [censusQuickActionPatients]
  );

  const radiologyPatients = React.useMemo<DateStripRadiologyPatient[]>(
    () =>
      quickActionPatients.map(p => ({
        bedId: p.bedId,
        label: p.label,
        patientName: p.patientName,
        rut: p.rut,
        diagnosis: p.diagnosis,
      })),
    [quickActionPatients]
  );

  const renderPlaceholderAction = (label: string, Icon: React.ComponentType<{ size?: number }>) => (
    <button
      type="button"
      data-census-menu-action
      disabled
      aria-disabled="true"
      tabIndex={-1}
      className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-slate-400 opacity-70`}
      title={`${label} (cargando...)`}
    >
      <Icon size={13} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  return (
    <div
      className={
        menuLayout
          ? 'flex flex-col gap-0.5'
          : 'flex min-h-[30px] min-w-0 items-center justify-end gap-1 overflow-x-auto'
      }
    >
      {onOpenBedManager && (
        <button
          data-census-menu-action
          onClick={onOpenBedManager}
          className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100`}
          title="Bloqueo de camas"
        >
          <Lock size={13} />
          <span className="hidden sm:inline">Camas</span>
        </button>
      )}

      <div
        className={
          menuLayout ? 'flex flex-col gap-0.5' : 'flex min-w-0 items-center gap-1 overflow-x-auto'
        }
      >
        {!hideClinicalQuickActions &&
          (RadiologyViewer && radiologyPatients.length > 0 ? (
            <>
              <button
                data-census-menu-action
                onClick={() => setIsRadiologyOpen(true)}
                className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-700`}
                title="Radiología / Imagenología"
              >
                <XRayIcon size={13} />
                <span className="hidden sm:inline">MMRAD</span>
              </button>
              {isRadiologyOpen ? (
                <Suspense fallback={null}>
                  <RadiologyViewer
                    isOpen={isRadiologyOpen}
                    onClose={() => setIsRadiologyOpen(false)}
                    patients={radiologyPatients}
                  />
                </Suspense>
              ) : null}
            </>
          ) : (
            renderPlaceholderAction('MMRAD', XRayIcon)
          ))}

        {!hideClinicalQuickActions &&
          ((canRenderFeatureQuickActions && renderFeatureQuickActions
            ? renderFeatureQuickActions(quickActionPatients)
            : null) ??
            renderPlaceholderAction('Lab', FlaskConical))}
      </div>
    </div>
  );
};
