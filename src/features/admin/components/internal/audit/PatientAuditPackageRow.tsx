import React from 'react';
import {
  AlertTriangle,
  Bed,
  ChevronDown,
  ChevronRight,
  Copy,
  FileJson,
  History,
  MonitorCheck,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import clsx from 'clsx';

import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';
import { buildClinicalAuditTimelineV2GroupFromPackage } from '@/services/admin/clinicalAuditTimelineV2';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import {
  buildAuditPackageDisplayChanges,
  buildAuditPackageCopySummary,
  buildClinicalAuditPackageNarrative,
  displayTimestampParts,
  getAuditPackageActorSummary,
  getRawAuditPackageEventsJson,
  isAuditPackageViewAction,
} from './patientAuditPackageRowUtils';
import {
  AuditPackageExpandedChanges,
  AuditPackageVisibleChanges,
} from './AuditPackageChangeSummary';
import {
  auditPackageSyncBadgeClassName,
  PatientAuditPackageEventList,
} from './PatientAuditPackageEventList';

interface PatientAuditPackageRowProps {
  auditPackage: ClinicalAuditPatientPackage;
  isExpanded: boolean;
  onToggle: () => void;
  compactView?: boolean;
}

export const PatientAuditPackageRow: React.FC<PatientAuditPackageRowProps> = ({
  auditPackage,
  isExpanded,
  onToggle,
  compactView,
}) => {
  const [showIncludedEvents, setShowIncludedEvents] = React.useState(false);
  const [showTechnicalJson, setShowTechnicalJson] = React.useState(false);
  const startedAt = displayTimestampParts(auditPackage.startedAt);
  const endedAt = displayTimestampParts(auditPackage.endedAt);
  const hasTimeRange = startedAt.time && endedAt.time && startedAt.time !== endedAt.time;
  const displayChanges = buildAuditPackageDisplayChanges(auditPackage);
  const visibleChanges = displayChanges.slice(0, compactView ? 2 : 4);
  const hiddenChangeCount = Math.max(0, displayChanges.length - visibleChanges.length);
  const integratedChangeCount = Math.max(0, auditPackage.changes.length - displayChanges.length);
  const rawEventsJson = getRawAuditPackageEventsJson(auditPackage);
  const timelineGroup = React.useMemo(
    () => buildClinicalAuditTimelineV2GroupFromPackage(auditPackage),
    [auditPackage]
  );
  const detailsId = `patient-audit-package-${auditPackage.id}`;
  const includedEventsId = `${detailsId}-included-events`;
  const technicalJsonId = `${detailsId}-technical-json`;
  const clinicalNarrative = buildClinicalAuditPackageNarrative(auditPackage);
  const viewEvents = auditPackage.rawLogs.filter(log => isAuditPackageViewAction(log.action));
  const clinicalEvents = auditPackage.rawLogs.filter(log => !isAuditPackageViewAction(log.action));

  const handleExpandKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onToggle();
  };

  const handleCopySummary = () => {
    void writeClipboardText(buildAuditPackageCopySummary(auditPackage)).catch(() => undefined);
  };

  return (
    <>
      <tr
        className={clsx(
          'group transition-all hover:bg-slate-50/90',
          isExpanded ? 'bg-sky-50/30' : ''
        )}
      >
        <td className="px-5 py-3 align-top">
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={detailsId}
            aria-label={`${isExpanded ? 'Cerrar' : 'Abrir'} detalle de auditoría de ${
              auditPackage.patientName
            }`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-white hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-sky-500/15"
            onClick={event => {
              event.stopPropagation();
              onToggle();
            }}
            onKeyDown={handleExpandKeyDown}
          >
            {isExpanded ? (
              <ChevronDown size={18} className="text-sky-600" />
            ) : (
              <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500" />
            )}
          </button>
        </td>

        <td className="px-3 py-3 align-top whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-bold text-slate-900">{auditPackage.recordDate}</span>
            <span className="text-[10px] font-mono text-slate-500">
              {hasTimeRange ? `${startedAt.time}-${endedAt.time}` : endedAt.time}
            </span>
          </div>
        </td>

        <td className="px-3 py-3 align-top min-w-[220px]">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  'inline-flex h-7 w-7 items-center justify-center rounded-lg border text-[10px] font-black',
                  auditPackage.flags.risk
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
                )}
              >
                {auditPackage.patientName.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900">
                  {auditPackage.patientName}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                  {auditPackage.patientRut && <span>{auditPackage.patientRut}</span>}
                  {auditPackage.primaryBedLabel && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-semibold text-slate-600">
                      <Bed size={10} />
                      {auditPackage.primaryBedLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {auditPackage.modules.slice(0, compactView ? 3 : 5).map(moduleName => (
                <span
                  key={moduleName}
                  className="rounded-md border border-sky-100 bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700"
                >
                  {moduleName}
                </span>
              ))}
              {auditPackage.flags.risk && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  <AlertTriangle size={10} />
                  Riesgo
                </span>
              )}
            </div>
          </div>
        </td>

        <td className="px-3 py-3 align-top min-w-[300px]">
          <p className="mb-2 max-w-[520px] text-xs font-semibold leading-snug text-slate-800">
            {clinicalNarrative}
          </p>
          {visibleChanges.length > 0 ? (
            <AuditPackageVisibleChanges
              changes={visibleChanges}
              hiddenChangeCount={hiddenChangeCount}
              integratedChangeCount={integratedChangeCount}
              totalChangeCount={auditPackage.changes.length}
            />
          ) : (
            <p className="max-w-[420px] text-xs font-medium text-slate-700">
              {auditPackage.summary}
            </p>
          )}
        </td>

        {!compactView && (
          <td className="px-3 py-3 align-top">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <UserRound size={13} className="text-slate-400" />
                <span
                  className="max-w-[180px] truncate"
                  title={getAuditPackageActorSummary(auditPackage)}
                >
                  {getAuditPackageActorSummary(auditPackage)}
                </span>
              </div>
              {auditPackage.ipAddresses[0] && (
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                  <MonitorCheck size={12} className="text-slate-400" />
                  <span>IP {auditPackage.ipAddresses[0]}</span>
                </div>
              )}
            </div>
          </td>
        )}

        {!compactView && (
          <td className="px-3 py-3 align-top">
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600">
                <ShieldCheck size={12} />
                {auditPackage.eventCount} eventos
              </span>
              {timelineGroup.syncStates.slice(0, 2).map(state => (
                <span
                  key={state}
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold',
                    auditPackageSyncBadgeClassName(state)
                  )}
                >
                  {timelineGroup.syncStateSummary.includes('+')
                    ? timelineGroup.events.find(event => event.mutationState === state)
                        ?.mutationStateLabel
                    : timelineGroup.syncStateSummary}
                </span>
              ))}
              <span className="text-[10px] text-slate-400">
                {auditPackage.actions
                  .map(action => AUDIT_ACTION_LABELS[action] || action)
                  .slice(0, 2)
                  .join(' · ')}
              </span>
            </div>
          </td>
        )}
      </tr>

      <tr id={detailsId} hidden={!isExpanded} className="bg-slate-50/70">
        {isExpanded && (
          <td colSpan={compactView ? 4 : 6} className="border-l-4 border-sky-500/40 px-10 py-4">
            <div className="space-y-3">
              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <History size={14} className="text-sky-600" />
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                      Cambios relevantes integrados
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-slate-400">
                    {auditPackage.eventCount} eventos · {getAuditPackageActorSummary(auditPackage)}
                  </span>
                </div>
                <AuditPackageExpandedChanges
                  changes={displayChanges}
                  summary={auditPackage.summary}
                />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileJson size={14} className="text-slate-400" />
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Evidencia técnica
                    </h4>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopySummary}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-500/10"
                    >
                      <Copy size={12} />
                      Copiar resumen
                    </button>
                    <button
                      type="button"
                      aria-expanded={showIncludedEvents}
                      aria-controls={includedEventsId}
                      onClick={() => setShowIncludedEvents(value => !value)}
                      className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700 transition hover:bg-sky-100 focus:outline-none focus:ring-4 focus:ring-sky-500/10"
                    >
                      {showIncludedEvents ? 'Ocultar' : 'Ver'} eventos incluidos
                    </button>
                    <button
                      type="button"
                      aria-expanded={showTechnicalJson}
                      aria-controls={technicalJsonId}
                      onClick={() => setShowTechnicalJson(value => !value)}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-500/10"
                    >
                      {showTechnicalJson ? 'Ocultar' : 'Ver'} payload técnico
                    </button>
                  </div>
                </div>

                <div
                  id={includedEventsId}
                  hidden={!showIncludedEvents}
                  className="space-y-3 border-t border-slate-100 p-3"
                >
                  {showIncludedEvents && (
                    <>
                      <div className="rounded-lg border border-slate-100 bg-white">
                        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                          <History size={14} className="text-sky-600" />
                          <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                            Eventos clínicos y administrativos
                          </h5>
                        </div>
                        {clinicalEvents.length > 0 ? (
                          <PatientAuditPackageEventList
                            logs={clinicalEvents}
                            timelineGroup={timelineGroup}
                          />
                        ) : (
                          <p className="px-3 py-2 text-xs text-slate-500">
                            No hay eventos de edición en este paquete.
                          </p>
                        )}
                      </div>

                      {viewEvents.length > 0 && (
                        <div className="rounded-lg border border-blue-100 bg-blue-50/30">
                          <div className="border-b border-blue-100 px-3 py-2">
                            <h5 className="text-[10px] font-black uppercase tracking-widest text-blue-700">
                              Visualizaciones registradas
                            </h5>
                          </div>
                          <PatientAuditPackageEventList
                            logs={viewEvents}
                            timelineGroup={timelineGroup}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div
                  id={technicalJsonId}
                  hidden={!showTechnicalJson}
                  className="border-t border-slate-100 p-3"
                >
                  {showTechnicalJson && (
                    <div className="rounded-lg border border-slate-200 bg-white">
                      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                        <FileJson size={14} className="text-slate-400" />
                        <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                          Detalle técnico avanzado
                        </h5>
                      </div>
                      <pre className="max-h-[360px] overflow-auto p-3 text-[10px] text-slate-500">
                        {rawEventsJson}
                      </pre>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </td>
        )}
      </tr>
    </>
  );
};
