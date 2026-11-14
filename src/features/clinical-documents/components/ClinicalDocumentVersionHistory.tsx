/**
 * ClinicalDocumentVersionHistory
 *
 * Popover that shows the version timeline of a clinical document.
 * Each entry displays version number, timestamp, author, and
 * save reason (autosave, manual, signature, etc.).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Save,
  Clock,
  PenLine,
  FileSignature,
  ShieldCheck,
  Wrench,
  Eye,
  Sparkles,
  History,
} from 'lucide-react';
import { buttonClassName } from '@/components/ui/base/buttonStyles';
import {
  PANEL_HEADER_CLASS,
  PANEL_ICON_CLASS,
  PANEL_TITLE_CLASS,
} from '@/components/ui/base/panelStyles';
import { getClinicalDocumentVersionChangedSectionSnapshots } from '@/domain/clinical-documents/versionHistory';
import { stripClinicalDocumentHtml } from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import type {
  ClinicalDocumentVersionMeta,
  ClinicalDocumentVersionSectionSnapshot,
} from '@/domain/clinical-documents/entities';
import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';

interface ClinicalDocumentVersionHistoryProps {
  versions: ClinicalDocumentVersionMeta[];
  currentVersion: number;
  onClose: () => void;
  canRestoreSection?: boolean;
  onRestoreSection?: (
    section: Pick<ClinicalDocumentVersionSectionSnapshot, 'sectionId' | 'title' | 'content'>
  ) => void;
}

const formatDateTime = (iso: string): string => {
  const stamp = readClinicalTimestamp(iso);
  if (!stamp) return iso;
  const [year, month, day] = stamp.iso.split('-');
  return `${day}/${month}/${year} ${stamp.hhmm}`;
};

const reasonConfig: Record<
  string,
  { label: string; icon: React.FC<{ size: number; className?: string }>; badgeClass: string }
> = {
  autosave: { label: 'Autoguardado', icon: Clock, badgeClass: 'bg-slate-100 text-slate-500' },
  manual: { label: 'Manual', icon: Save, badgeClass: 'bg-blue-50 text-blue-600' },
  signature: {
    label: 'Firmado',
    icon: FileSignature,
    badgeClass: 'bg-emerald-50 text-emerald-600',
  },
  unsign: { label: 'Firma revocada', icon: ShieldCheck, badgeClass: 'bg-amber-50 text-amber-600' },
  admin_fix: { label: 'Admin', icon: Wrench, badgeClass: 'bg-red-50 text-red-600' },
  ai_import: {
    label: 'Importación IA',
    icon: Sparkles,
    badgeClass: 'bg-fuchsia-50 text-fuchsia-600',
  },
};

const getReasonConfig = (reason: string) =>
  reasonConfig[reason] || {
    label: reason,
    icon: PenLine,
    badgeClass: 'bg-slate-100 text-slate-500',
  };

export const ClinicalDocumentVersionHistory: React.FC<ClinicalDocumentVersionHistoryProps> = ({
  versions,
  currentVersion,
  onClose,
  canRestoreSection = false,
  onRestoreSection,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [expandedSectionKey, setExpandedSectionKey] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const versionByNumber = new Map(versions.map(version => [version.version, version]));

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="fixed inset-0 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={ref}
        className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md max-h-[70vh] flex flex-col animate-scale-in"
      >
        {/* Header */}
        <div className={`${PANEL_HEADER_CLASS} border-slate-100 px-4`}>
          <h3 className={`${PANEL_TITLE_CLASS} flex items-center gap-2`}>
            <span className={`${PANEL_ICON_CLASS} text-medical-700`} aria-hidden="true">
              <History />
            </span>
            <span className="min-w-0 break-words">
              Historial de versiones
              <span className="ml-1.5 text-xs font-normal text-slate-500">v{currentVersion}</span>
            </span>
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className={buttonClassName('ghost', 'icon', 'ml-auto shrink-0')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {sorted.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-4">Sin historial de versiones</p>
          )}
          <div className="relative border-l-2 border-slate-200 ml-2">
            {sorted.map(v => {
              const config = getReasonConfig(v.reason);
              const Icon = config.icon;
              const isCurrent = v.version === currentVersion;
              const previousVersion = versionByNumber.get(v.version - 1);
              const hasComparablePreviousVersion = Boolean(
                previousVersion?.sectionSnapshots?.length
              );
              const changedSnapshots = hasComparablePreviousVersion
                ? getClinicalDocumentVersionChangedSectionSnapshots(v)
                : [];
              const hasSectionSnapshots = Boolean(v.sectionSnapshots?.length);

              return (
                <div key={v.version} className="relative pl-5 pb-4 last:pb-0">
                  {/* Dot */}
                  <div
                    className={`absolute left-[-5px] top-1 w-2 h-2 rounded-full ${
                      isCurrent ? 'bg-medical-500 ring-2 ring-medical-200' : 'bg-slate-300'
                    }`}
                  />
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-xs text-slate-500 font-mono">v{v.version}</span>
                      <span className="text-xs text-slate-500 ml-2">
                        {formatDateTime(v.savedAt)}
                      </span>
                      <p className="text-xs text-slate-700 mt-0.5">{v.savedBy.displayName}</p>
                    </div>
                    <span
                      className={`flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${config.badgeClass}`}
                    >
                      <Icon size={12} />
                      {config.label}
                    </span>
                  </div>
                  {changedSnapshots.length > 0 && (
                    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                      <p className="text-xs font-semibold text-slate-600">Cambios</p>
                      <div className="mt-1 space-y-1">
                        {changedSnapshots.map(section => {
                          const sectionKey = `${v.version}-${section.sectionId}`;
                          const isExpanded = expandedSectionKey === sectionKey;

                          return (
                            <div key={section.sectionId} className="rounded-md bg-white p-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                                  {section.title}
                                </span>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedSectionKey(current =>
                                        current === sectionKey ? null : sectionKey
                                      )
                                    }
                                    className={buttonClassName('ghost', 'xs')}
                                    aria-label={`Ver anterior ${section.title}`}
                                  >
                                    <Eye size={12} aria-hidden="true" />
                                    Ver
                                  </button>
                                  {canRestoreSection && onRestoreSection && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onRestoreSection({
                                          sectionId: section.sectionId,
                                          title: section.title,
                                          content: section.content,
                                        })
                                      }
                                      className={buttonClassName('outline', 'xs')}
                                      aria-label={`Restaurar ${section.title}`}
                                    >
                                      Restaurar
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isExpanded && (
                                <div className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-1.5 text-xs leading-relaxed text-slate-600">
                                  {stripClinicalDocumentHtml(section.content) ||
                                    'Sección sin contenido en esta versión.'}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!hasSectionSnapshots && (
                    <p className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-1.5 text-xs leading-relaxed text-slate-500">
                      Versión sin detalle por sección. La comparación estará disponible desde los
                      próximos guardados.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
