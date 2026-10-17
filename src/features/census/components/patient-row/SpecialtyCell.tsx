import { buildPatientRowSaveScopeKey } from '@/features/census/controllers/patientRowInputController';
/**
 * SpecialtyCell - Wrapper component for the patient's specialty
 *
 * Allows users to select one specialty for statistics, including a free-text
 * specialty through "Otro".
 */

import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Settings2, X } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { BaseCellProps, EventTextHandler, PatientRowSaveResult } from './inputCellTypes';
import { useSpecialtyCellModel } from '@/features/census/components/patient-row/useSpecialtyCellModel';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { resolveDeliveryRoutePopoverPosition } from '@/features/census/controllers/deliveryRoutePopoverController';
import {
  buildGinecobstetriciaTypePatch,
  buildPrimarySpecialtyPatch,
  isGinecobstetriciaSpecialty,
  resolveGinecobstetriciaBadgeClassName,
  resolveGinecobstetriciaBadgeTitle,
} from '@/shared/census/ginecobstetriciaClassification';
import type { GinecobstetriciaType } from '@/features/census/contracts/censusObstetricContracts';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import { usePatientRowSaveState } from './usePatientRowSaveState';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { useClinicalFieldFreshnessPause } from './useClinicalFieldFreshnessPause';

interface SpecialtyCellProps extends BaseCellProps {
  onChange: EventTextHandler;
  currentDateString?: string;
  onMultipleUpdate?: (fields: Partial<PatientData>) => PatientRowSaveResult;
}

export const SpecialtyCell: React.FC<SpecialtyCellProps> = ({
  data,
  currentDateString,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
  readOnlyReason,
  clinicalPause,
  onMultipleUpdate,
}) => {
  const episodeMode = useFeatureFlag('SPECIALTY_EPISODE_ASSIGNMENT');
  const saveState = usePatientRowSaveState(
    buildPatientRowSaveScopeKey(currentDateString, data, data.bedId, isSubRow)
  );
  const freshnessPause = useClinicalFieldFreshnessPause(clinicalPause);
  const GINECOB_WIDTH = 240;
  const { state, primaryLabel } = useSpecialtyCellModel({ data });
  const { isPrimaryOther } = state;
  const isGinecobstetricia = isGinecobstetriciaSpecialty(data.specialty);
  const [isSubtypeOpen, setIsSubtypeOpen] = useState(false);
  const subtypeButtonRef = useRef<HTMLButtonElement>(null);
  const subtypePopoverRef = useRef<HTMLDivElement>(null);
  const isSubtypePopoverVisible = isSubtypeOpen && isGinecobstetricia;

  const closeSubtypePopover = useCallback(() => {
    setIsSubtypeOpen(false);
  }, []);

  const resolveSubtypePopoverPosition = useCallback(() => {
    if (!subtypeButtonRef.current) {
      return null;
    }

    return resolveDeliveryRoutePopoverPosition({
      buttonRect: subtypeButtonRef.current.getBoundingClientRect(),
      panelWidth: GINECOB_WIDTH,
      viewportWidth: defaultBrowserWindowRuntime.getViewportWidth(),
      offsetY: 8,
    });
  }, []);

  const { position: subtypePopoverPos, updatePosition: updateSubtypePosition } =
    usePortalPopoverRuntime({
      isOpen: isSubtypePopoverVisible,
      anchorRef: subtypeButtonRef,
      popoverRef: subtypePopoverRef,
      initialPosition: { top: 0, left: 0 },
      resolvePosition: resolveSubtypePopoverPosition,
      onClose: closeSubtypePopover,
    });

  const applyPrimarySpecialtyChange = useCallback(
    async (nextSpecialty: string) => {
      if (readOnly) return;
      const normalizedSpecialty = nextSpecialty.trim();
      const confirmed = await saveState.save(() =>
        onMultipleUpdate?.(
          episodeMode
            ? { specialty: normalizedSpecialty as PatientData['specialty'] }
            : {
                ...buildPrimarySpecialtyPatch(normalizedSpecialty),
                secondarySpecialty: undefined,
              }
        )
      );
      if (!confirmed) return;

      if (isGinecobstetriciaSpecialty(normalizedSpecialty)) {
        setIsSubtypeOpen(true);
        window.requestAnimationFrame(() => {
          updateSubtypePosition();
        });
        return;
      }

      setIsSubtypeOpen(false);
    },
    [readOnly, saveState, episodeMode, onMultipleUpdate, updateSubtypePosition]
  );

  const handlePrimarySpecialtySelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      applyPrimarySpecialtyChange(event.target.value);
    },
    [applyPrimarySpecialtyChange]
  );

  const handlePrimarySpecialtyTextChange = useCallback(
    (value: string) => {
      applyPrimarySpecialtyChange(value);
    },
    [applyPrimarySpecialtyChange]
  );

  const toggleSubtypePopover = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      updateSubtypePosition();
      setIsSubtypeOpen(current => !current);
    },
    [updateSubtypePosition]
  );

  const handleSubtypeSelect = useCallback(
    async (ginecobstetriciaType: GinecobstetriciaType) => {
      if (readOnly) return;
      if (
        await saveState.save(() =>
          onMultipleUpdate?.(buildGinecobstetriciaTypePatch(ginecobstetriciaType))
        )
      )
        closeSubtypePopover();
    },
    [closeSubtypePopover, readOnly, saveState, onMultipleUpdate]
  );

  if (isEmpty && !isSubRow) {
    return (
      <td className="py-0.5 px-1 border-r border-slate-200 w-28 text-center">
        <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-[11px] italic">
          -
        </div>
      </td>
    );
  }

  return (
    <td
      className="py-0.5 px-1 border-r border-slate-200 w-28 relative group/spec bg-white/50"
      title={readOnlyReason}
      onMouseDownCapture={freshnessPause.acknowledge}
      onFocusCapture={freshnessPause.acknowledge}
    >
      {/* Main Outer Box - Matches "encuadre" of other columns */}
      <div
        className={clsx(
          'flex items-center w-full px-1 h-7 border rounded transition-all duration-200 bg-white',
          'border-slate-200 group-hover/spec:border-medical-300',
          'gap-0.5',
          freshnessPause.pauseClassName
        )}
      >
        {/* Primary Specialty Container */}
        <div className="relative flex-1 flex items-center h-full min-w-0">
          {!episodeMode && (isPrimaryOther || data.specialty === 'Otro') ? (
            <div className="relative flex-1 h-full flex items-center">
              <DebouncedInput
                type="text"
                className="w-full p-0 h-5 border-none bg-transparent focus:ring-0 text-[11px] font-medium"
                value={data.specialty === 'Otro' ? '' : data.specialty || ''}
                onChange={handlePrimarySpecialtyTextChange}
                placeholder="Esp"
                disabled={readOnly || saveState.isSaving}
                title={readOnlyReason}
              />
            </div>
          ) : (
            <div className="relative flex-1 min-w-0 h-full flex items-center">
              <select
                className={clsx(
                  'w-full p-0 h-5 border-none bg-transparent focus:ring-0 text-[11px] font-medium cursor-pointer appearance-none',
                  data.specialty ? 'text-transparent' : 'text-slate-400 italic',
                  isGinecobstetricia && 'pr-12'
                )}
                value={data.specialty || ''}
                onChange={handlePrimarySpecialtySelectChange}
                disabled={readOnly || saveState.isSaving}
                title={readOnlyReason}
              >
                <option value="" className="text-slate-700">
                  -- Esp --
                </option>
                {SPECIALTY_OPTIONS.map(opt => (
                  <option key={opt} value={opt} className="text-slate-700 font-normal">
                    {opt}
                  </option>
                ))}
              </select>

              {/* Visual Label (Primary) */}
              {data.specialty && (
                <div className="absolute inset-0 flex items-center pointer-events-none bg-transparent overflow-hidden">
                  <span
                    className={clsx(
                      'text-[11px] font-medium truncate',
                      isGinecobstetricia && 'pr-12',
                      'text-slate-700'
                    )}
                  >
                    {primaryLabel || data.specialty}
                  </span>
                </div>
              )}
            </div>
          )}

          {isGinecobstetricia && !readOnly && (
            <button
              ref={subtypeButtonRef}
              type="button"
              onClick={toggleSubtypePopover}
              disabled={saveState.isSaving}
              className={clsx(
                'absolute right-0.5 top-1/2 -translate-y-1/2 rounded-md border p-1 transition-colors z-10',
                resolveGinecobstetriciaBadgeClassName()
              )}
              title={resolveGinecobstetriciaBadgeTitle()}
              aria-label={resolveGinecobstetriciaBadgeTitle()}
            >
              <Settings2 size={11} />
            </button>
          )}
        </div>
      </div>

      {saveState.isSaving && (
        <span role="status" className="text-[10px] text-slate-500">
          Guardando especialidad…
        </span>
      )}
      {saveState.failed && (
        <span role="alert" className="text-[10px] text-red-700">
          No se pudo confirmar el cambio. Revisa el dato e inténtalo de nuevo.
        </span>
      )}
      {isSubtypePopoverVisible &&
        createPortal(
          <div
            ref={subtypePopoverRef}
            className="fixed z-[10000]"
            style={{
              top: subtypePopoverPos.top,
              left: subtypePopoverPos.left,
            }}
          >
            <div className="w-60 rounded-xl border border-slate-200 bg-white shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2 rounded-t-xl">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Tipo de atención
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSubtypePopover}
                  className="rounded p-0.5 text-slate-400 transition-colors hover:text-slate-600"
                  title="Cerrar"
                >
                  <X size={12} />
                </button>
              </div>

              <div className="space-y-3 p-3">
                <div className="grid grid-cols-2 gap-2">
                  {(['Obstétrica', 'Ginecológica'] as const).map(option => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => void handleSubtypeSelect(option)}
                      disabled={saveState.isSaving}
                      className={clsx(
                        'rounded-lg border px-2 py-2 text-[11px] font-bold transition-all',
                        data.ginecobstetriciaType === option
                          ? option === 'Obstétrica'
                            ? 'border-pink-200 bg-pink-50 text-pink-700 shadow-sm'
                            : 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm'
                          : 'border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200'
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      {freshnessPause.hint}
    </td>
  );
};
