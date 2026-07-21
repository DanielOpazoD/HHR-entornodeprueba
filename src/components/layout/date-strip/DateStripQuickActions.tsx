import React, { Suspense, lazy } from 'react';
import { FlaskConical, Lock, Radio } from 'lucide-react';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { DATE_STRIP_QUICK_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';

const FEATURE_QUICK_ACTIONS_STARTUP_DELAY_MS = 1200;

const LazyRadiologyViewerModal = lazy(() =>
  import('@/components/modals/RadiologyViewerModal').then(module => ({
    default: module.RadiologyViewerModal,
  }))
);

interface DateStripQuickActionsProps {
  onOpenBedManager?: () => void;
  medicalIndicationsPatients?: MedicalIndicationsPatientOption[];
  renderFeatureQuickActions?: (patients: MedicalIndicationsPatientOption[]) => React.ReactNode;
  hideClinicalQuickActions?: boolean;
}

export const DateStripQuickActions: React.FC<DateStripQuickActionsProps> = ({
  onOpenBedManager,
  medicalIndicationsPatients = [],
  renderFeatureQuickActions,
  hideClinicalQuickActions = false,
}) => {
  const [isRadiologyOpen, setIsRadiologyOpen] = React.useState(false);
  const [canRenderFeatureQuickActions, setCanRenderFeatureQuickActions] = React.useState(false);

  React.useEffect(() => {
    if (hideClinicalQuickActions || !renderFeatureQuickActions) {
      setCanRenderFeatureQuickActions(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCanRenderFeatureQuickActions(true);
    }, FEATURE_QUICK_ACTIONS_STARTUP_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hideClinicalQuickActions, renderFeatureQuickActions]);

  const quickActionPatients = React.useMemo(
    () => medicalIndicationsPatients.filter(p => p.rut && p.patientName),
    [medicalIndicationsPatients]
  );

  const radiologyPatients = React.useMemo(
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
    <div className="flex min-h-[30px] min-w-0 items-center justify-end gap-1 overflow-x-auto">
      {onOpenBedManager && (
        <button
          onClick={onOpenBedManager}
          className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100`}
          title="Bloqueo de camas"
        >
          <Lock size={13} />
          <span className="hidden sm:inline">Camas</span>
        </button>
      )}

      <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {!hideClinicalQuickActions &&
          (radiologyPatients.length > 0 ? (
            <>
              <button
                onClick={() => setIsRadiologyOpen(true)}
                className={`${DATE_STRIP_QUICK_ACTION_BASE_CLASS} border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-700`}
                title="Radiología / Imagenología"
              >
                <Radio size={13} />
                <span className="hidden sm:inline">MMRAD</span>
              </button>
              {isRadiologyOpen ? (
                <Suspense fallback={null}>
                  <LazyRadiologyViewerModal
                    isOpen={isRadiologyOpen}
                    onClose={() => setIsRadiologyOpen(false)}
                    patients={radiologyPatients}
                  />
                </Suspense>
              ) : null}
            </>
          ) : (
            renderPlaceholderAction('MMRAD', Radio)
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
