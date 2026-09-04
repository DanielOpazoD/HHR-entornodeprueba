import React from 'react';
import { ExternalLink, RefreshCw, Wrench } from 'lucide-react';
import { requestRayenConnectionRepair } from '../bridge/connectionRepairChannel';
import { requestGestionCamasConnect } from '../bridge/gestionCamasConnectChannel';
import { deriveRayenRecoveryAction } from '../bridge/rayenRecoveryAction';
import type { RayenSourceHealth } from '../bridge/extensionHealthBridge';
import type {
  RayenExtensionConnectionState,
  RayenExtensionHealthState,
} from '../hooks/useRayenExtensionHealth';

/**
 * Columna «Eloísa» de la barra del censo: semáforo de conexión + popover con
 * el detalle por fuente (identidad de Ficha Médico, vigencia y verificación de
 * Gestión de Camas, versión y frescura del reporte) y acciones directas —
 * una única acción contextual (conexión dirigida, reparación limpia o reintento).
 * El resultado llega por respuesta correlacionada y por el push de salud. El reporte se
 * mantiene fresco por el latido de la extensión (~1/min), así que los tiempos
 * relativos se recalculan con un tic local de 30 s.
 */

const RELATIVE_TICK_MS = 30_000;

const relativeAgo = (iso: string | number | undefined | null, now: number): string | null => {
  if (iso === undefined || iso === null) return null;
  const stamp = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(stamp)) return null;
  const seconds = Math.max(0, Math.round((now - stamp) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
};

const remainingLabel = (source: RayenSourceHealth | undefined, now: number): string | null => {
  // Con vencimiento absoluto, la vigencia se recalcula con el tic local (el
  // reporte empujado puede tener hasta 60 s); si no, vale lo que informó.
  const seconds =
    typeof source?.expiresAt === 'number' && Number.isFinite(source.expiresAt)
      ? (source.expiresAt - now) / 1000
      : source?.remainingSeconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const minutes = Math.max(0, Math.ceil(seconds / 60));
  if (minutes <= 0) return 'vencida';
  // Sesiones largas (Ficha Médico dura 24 h) se leen mejor en horas.
  return minutes >= 120 ? `vence en ~${Math.round(minutes / 60)} h` : `vence en ~${minutes} min`;
};

const sourceDotClass = (status: RayenSourceHealth['status'] | undefined): string =>
  status === 'ready' ? 'bg-emerald-500' : status === 'stale' ? 'bg-amber-500' : 'bg-slate-300';

export const rayenSourceStateLabel = (
  connection: RayenExtensionConnectionState,
  fichaMedicoReady: boolean,
  working: boolean,
  blockedBy?: RayenExtensionHealthState['blockedBy']
): string =>
  working || connection === 'checking'
    ? 'Comprobando'
    : connection === 'ready'
      ? 'Conectada'
      : connection === 'degraded'
        ? 'Conexión parcial'
        : connection === 'incompatible'
          ? 'Actualizar extensión'
          : connection === 'blocked'
            ? // Quién bloquea manda (una Ficha Médico «lista» pero por vencer no es GC).
              (blockedBy ?? (fichaMedicoReady ? 'gestionCamas' : 'fichaMedico')) === 'gestionCamas'
              ? 'Conectar Gestión de Camas'
              : 'Revisar Ficha Médico'
            : 'Extensión sin respuesta';

interface SourceRowProps {
  label: string;
  source: RayenSourceHealth | undefined;
  detail: string | null;
}

const SourceRow: React.FC<SourceRowProps> = ({ label, source, detail }) => (
  <div className="flex items-start gap-2">
    <span
      className={`mt-1 size-1.5 shrink-0 rounded-full ${sourceDotClass(source?.status)}`}
      aria-hidden="true"
    />
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-slate-700">{label}</p>
      <p className="text-[11px] leading-snug text-slate-500">{source?.message ?? 'Sin datos.'}</p>
      {detail && <p className="text-[10px] font-medium tabular-nums text-slate-400">{detail}</p>}
    </div>
  </div>
);

interface RayenConnectionMonitorProps {
  extension: RayenExtensionHealthState & {
    refresh: (options?: { timeoutMs?: number }) => Promise<RayenExtensionHealthState>;
  };
  working: boolean;
  lastSyncLine: string;
  /** Estado del popover, controlado por la barra (otros flujos pueden abrirlo). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const RayenConnectionMonitor: React.FC<RayenConnectionMonitorProps> = ({
  extension,
  working,
  lastSyncLine,
  open,
  onOpenChange,
}) => {
  const [busy, setBusy] = React.useState<'refresh' | 'connect' | 'repair' | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const containerRef = React.useRef<HTMLDivElement>(null);
  const autoRefreshEpochRef = React.useRef(0);
  const refreshExtension = extension.refresh;

  React.useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), RELATIVE_TICK_MS);
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      clearInterval(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    const refreshEpoch = ++autoRefreshEpochRef.current;
    // El detalle siempre se abre con evidencia fresca; el latido sigue siendo
    // la vía normal y este chequeo no queda expuesto como paso obligatorio.
    setBusy('refresh');
    void refreshExtension()
      .then(() => setNow(Date.now()))
      .catch(() => undefined)
      .finally(() => {
        if (autoRefreshEpochRef.current === refreshEpoch) {
          setBusy(current => (current === 'refresh' ? null : current));
        }
      });
    return () => {
      if (autoRefreshEpochRef.current === refreshEpoch) autoRefreshEpochRef.current += 1;
    };
  }, [refreshExtension, open]);

  const report = extension.report;
  const fichaMedicoReady = report?.fichaMedico.status === 'ready';
  const gestionCamas = report?.gestionCamas;
  const recoveryAction = deriveRayenRecoveryAction({
    connection: extension.connection,
    report,
    working,
  });

  React.useEffect(() => {
    if (report?.fichaMedico.status === 'ready' && report.gestionCamas.status === 'ready') {
      setActionError(null);
    }
  }, [report]);
  const stateLabel = rayenSourceStateLabel(
    extension.connection,
    fichaMedicoReady,
    working,
    extension.blockedBy
  );
  const attention = !working && extension.connection !== 'ready';

  const handleRefresh = async (): Promise<void> => {
    setBusy('refresh');
    setActionError(null);
    try {
      await refreshExtension();
      setNow(Date.now());
    } finally {
      setBusy(null);
    }
  };

  const handleConnectGestionCamas = async (): Promise<void> => {
    setBusy('connect');
    setActionError(null);
    try {
      const result = await requestGestionCamasConnect({
        renew: recoveryAction.renewGestionCamas === true,
      });
      // El éxito real (sesión capturada y verificada) llega por el push
      // gc-captured del latido; aquí solo reportamos si la ventana no abrió.
      if (!result.ok) setActionError(result.error ?? 'No se pudo abrir Gestión de Camas.');
    } finally {
      setBusy(null);
    }
  };

  const handleRepair = async (): Promise<void> => {
    setBusy('repair');
    setActionError(null);
    try {
      const result = await requestRayenConnectionRepair();
      if (!result.ok) {
        setActionError(
          result.requiresLogin
            ? 'Completa el inicio de sesión en las pestañas nuevas de Eloísa.'
            : (result.error ?? result.message ?? 'La conexión todavía no pudo verificarse.')
        );
      }
      await refreshExtension({ timeoutMs: 12_000 });
      setNow(Date.now());
    } finally {
      setBusy(null);
    }
  };

  const fichaIdentity = report?.fichaMedico.identity;
  const fichaDetailParts = [
    fichaIdentity?.fullName
      ? `${fichaIdentity.fullName}${fichaIdentity.role ? ` · ${fichaIdentity.role}` : ''}`
      : null,
    remainingLabel(report?.fichaMedico, now),
  ].filter((part): part is string => Boolean(part));
  const fichaDetail = fichaDetailParts.length > 0 ? fichaDetailParts.join(' · ') : null;
  const gestionDetailParts = [
    remainingLabel(gestionCamas, now),
    gestionCamas?.lastVerifiedAt != null
      ? `verificada ${relativeAgo(gestionCamas.lastVerifiedAt, now) ?? ''}`.trim()
      : null,
  ].filter((part): part is string => Boolean(part));
  const reportAgo = relativeAgo(report?.checkedAt ?? null, now);

  return (
    <div ref={containerRef} className="relative flex min-w-[210px] items-center gap-2">
      <span
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border ${
          working || extension.connection === 'checking'
            ? 'border-teal-200 bg-teal-100 text-teal-700'
            : extension.connection === 'ready'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
        }`}
      >
        <img
          src="/images/logos/rayen-mark.png"
          alt=""
          className="size-7 object-contain"
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          aria-controls="rayen-connection-monitor"
          title={extension.message}
          data-testid="rayen-connection-monitor-trigger"
          className="flex items-center gap-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          <p className="text-[13px] font-bold leading-tight text-slate-800">Eloísa</p>
          <span
            className={`size-1.5 rounded-full ${
              working || extension.connection === 'checking'
                ? 'animate-pulse bg-teal-500'
                : extension.connection === 'ready'
                  ? 'bg-emerald-500'
                  : 'bg-amber-500'
            }`}
            aria-hidden="true"
          />
          <span
            className={`truncate text-[11px] font-medium ${
              attention ? 'text-amber-700' : 'text-slate-500'
            }`}
          >
            {stateLabel}
          </span>
        </button>
        {attention && (
          <span className="sr-only" role="status">
            {extension.message}
          </span>
        )}
        <p className="mt-0.5 truncate text-[10px] font-medium tabular-nums text-slate-500">
          {lastSyncLine}
        </p>
        {open && (
          <div
            id="rayen-connection-monitor"
            data-testid="rayen-connection-monitor"
            className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-80 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Conexiones Eloísa
              </p>
              <span className="text-[10px] font-medium tabular-nums text-slate-400">
                {report
                  ? `v${report.version}${reportAgo ? ` · estado ${reportAgo}` : ''}`
                  : 'sin reporte'}
              </span>
            </div>
            <div className="space-y-2">
              <SourceRow label="Ficha Médico" source={report?.fichaMedico} detail={fichaDetail} />
              <SourceRow
                label="Gestión de Camas"
                source={gestionCamas}
                detail={gestionDetailParts.length > 0 ? gestionDetailParts.join(' · ') : null}
              />
            </div>
            {actionError && (
              <p className="mt-2 text-[11px] leading-snug text-amber-700" role="alert">
                {actionError}
              </p>
            )}
            {recoveryAction.kind !== 'none' && (
              <div className="mt-3 flex items-center justify-end">
                {recoveryAction.kind === 'refresh' && (
                  <button
                    type="button"
                    onClick={() => void handleRefresh()}
                    disabled={busy !== null}
                    data-testid="rayen-monitor-refresh"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 disabled:cursor-progress disabled:opacity-60"
                  >
                    <RefreshCw size={11} className={busy === 'refresh' ? 'animate-spin' : ''} />
                    {recoveryAction.label}
                  </button>
                )}
                {recoveryAction.kind === 'connect-gc' && (
                  <button
                    type="button"
                    onClick={() => void handleConnectGestionCamas()}
                    disabled={busy !== null}
                    data-testid="rayen-monitor-connect-gc"
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-progress disabled:opacity-60"
                  >
                    <ExternalLink size={11} />
                    {recoveryAction.label}
                  </button>
                )}
                {recoveryAction.kind === 'repair' && (
                  <button
                    type="button"
                    onClick={() => void handleRepair()}
                    disabled={busy !== null}
                    data-testid="rayen-monitor-repair"
                    className="inline-flex items-center gap-1 rounded-lg bg-teal-700 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-teal-800 disabled:cursor-progress disabled:opacity-60"
                  >
                    <Wrench size={11} />
                    {recoveryAction.label}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
