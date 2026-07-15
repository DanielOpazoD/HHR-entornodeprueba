import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { DiagnosisCodeBadge } from './DiagnosisCodeBadge';
import { Settings2, X } from 'lucide-react';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import type {
  DebouncedTextHandler,
  PatientInputChangeHandlers,
} from '@/features/census/components/patient-row/inputCellTypes';
import { resolveDeliveryRoutePopoverPosition } from '@/features/census/controllers/deliveryRoutePopoverController';
import {
  buildGinecobstetriciaTypePatch,
  isGinecobstetriciaSpecialty,
  isObstetricGinecobstetricia,
  resolveGinecobstetriciaBadgeClassName,
  resolveGinecobstetriciaBadgeTitle,
} from '@/shared/census/ginecobstetriciaClassification';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import type { GinecobstetriciaType } from '@/features/census/contracts/censusObstetricContracts';
import { ClinicalInitialBlockEditor } from './ClinicalInitialBlockEditor';
import { DeliveryRoutePopover } from './DeliveryRoutePopover';

interface ClinicalInitialBlockCellsProps {
  data: PatientData;
  readOnly?: boolean;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: PatientInputChangeHandlers['multiple'];
  onDeliveryRouteChange?: PatientInputChangeHandlers['deliveryRoute'];
}

interface ClinicalInitialBlockCellButtonProps {
  data: PatientData;
  label: string;
  value: string;
  placeholder: string;
  contentClassName?: string;
  contentSuffix?: React.ReactNode;
  triggerClassName?: string;
  readOnly?: boolean;
  onChange: DebouncedTextHandler;
  onMultipleUpdate?: PatientInputChangeHandlers['multiple'];
}

const clinicalBlockButtonClassName = clsx(
  'h-7 w-full rounded border border-slate-200 bg-white px-2 text-left text-[13px] transition-colors',
  'hover:border-medical-300 hover:bg-medical-50/40 focus:outline-none focus:ring-2 focus:ring-medical-500/20',
  'disabled:cursor-default disabled:bg-slate-50 disabled:text-slate-500 disabled:hover:border-slate-200'
);

const ClinicalInitialBlockCellButton: React.FC<ClinicalInitialBlockCellButtonProps> = ({
  data,
  label,
  value,
  placeholder,
  contentClassName,
  contentSuffix,
  triggerClassName,
  readOnly = false,
  onChange,
  onMultipleUpdate,
}) => (
  <ClinicalInitialBlockEditor
    data={data}
    disabled={readOnly}
    triggerAriaLabel={`Editar ${label}`}
    triggerTitle={`Editar ${label}`}
    triggerClassName={triggerClassName || clinicalBlockButtonClassName}
    triggerContent={
      <>
        <span
          className={clsx(
            'block truncate',
            contentClassName || (value ? 'text-slate-800' : 'text-slate-400 italic')
          )}
        >
          {value || placeholder}
        </span>
        {contentSuffix}
      </>
    }
    onChange={onChange}
    onMultipleUpdate={onMultipleUpdate}
  />
);

interface GinecobstetriciaSubtypeControlProps {
  data: PatientData;
  disabled: boolean;
  onMultipleUpdate?: PatientInputChangeHandlers['multiple'];
}

const GINECOB_SUBTYPE_POPOVER_WIDTH = 240;

const GinecobstetriciaSubtypeControl: React.FC<GinecobstetriciaSubtypeControlProps> = ({
  data,
  disabled,
  onMultipleUpdate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const closePopover = useCallback(() => {
    setIsOpen(false);
  }, []);

  const resolvePosition = useCallback(() => {
    if (!buttonRef.current) return null;

    return resolveDeliveryRoutePopoverPosition({
      buttonRect: buttonRef.current.getBoundingClientRect(),
      panelWidth: GINECOB_SUBTYPE_POPOVER_WIDTH,
      viewportWidth: defaultBrowserWindowRuntime.getViewportWidth(),
      offsetY: 8,
    });
  }, []);

  const { position, updatePosition } = usePortalPopoverRuntime({
    isOpen,
    anchorRef: buttonRef,
    popoverRef,
    initialPosition: { top: 0, left: 0 },
    resolvePosition,
    onClose: closePopover,
  });

  const togglePopover = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      updatePosition();
      setIsOpen(current => !current);
    },
    [disabled, updatePosition]
  );

  const handleSubtypeSelect = useCallback(
    (ginecobstetriciaType: GinecobstetriciaType) => {
      onMultipleUpdate?.(buildGinecobstetriciaTypePatch(ginecobstetriciaType));
      closePopover();
    },
    [closePopover, onMultipleUpdate]
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopover}
        disabled={disabled}
        className={clsx(
          'absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md border p-1 transition-colors',
          disabled && 'cursor-not-allowed opacity-50',
          resolveGinecobstetriciaBadgeClassName()
        )}
        title={resolveGinecobstetriciaBadgeTitle()}
        aria-label={resolveGinecobstetriciaBadgeTitle()}
      >
        <Settings2 size={11} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[10000]"
            style={{ top: position.top, left: position.left }}
            onClick={event => event.stopPropagation()}
          >
            <div className="w-60 rounded-xl border border-slate-200 bg-white shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2 rounded-t-xl">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Tipo de atención
                </p>
                <button
                  type="button"
                  onClick={closePopover}
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
                      onClick={() => handleSubtypeSelect(option)}
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
    </>
  );
};

export const ClinicalInitialBlockCells: React.FC<ClinicalInitialBlockCellsProps> = ({
  data,
  readOnly = false,
  onChange,
  onMultipleUpdate,
  onDeliveryRouteChange,
}) => {
  const isGinecobstetricia = isGinecobstetriciaSpecialty(data.specialty);
  const canShowDeliveryRoute =
    isGinecobstetricia && isObstetricGinecobstetricia(data.ginecobstetriciaType);
  const diagnosisRightPadding = data.cie10Code
    ? canShowDeliveryRoute
      ? 'pr-32'
      : isGinecobstetricia
        ? 'pr-28'
        : 'pr-16'
    : canShowDeliveryRoute
      ? 'pr-14'
      : isGinecobstetricia
        ? 'pr-8'
        : undefined;

  // Rediseño 2026: la Especialidad ya no es una columna — se muestra como texto junto a la fecha de
  // ingreso (PatientIdentityCell) y se sigue editando desde este editor de Diagnóstico. Los controles
  // obstétricos (subtipo Gineco + vía del parto) se mudan aquí, a la celda de Diagnóstico.
  return (
    <td className="py-0.5 px-1 border-r border-slate-200 min-w-[160px] relative">
      <ClinicalInitialBlockCellButton
        data={data}
        label="diagnóstico"
        value={data.pathology || ''}
        placeholder="Diagnóstico"
        contentClassName={clsx(
          data.pathology ? 'text-slate-800' : 'text-slate-400 italic',
          diagnosisRightPadding
        )}
        readOnly={readOnly}
        onChange={onChange}
        onMultipleUpdate={onMultipleUpdate}
      />
      <DiagnosisCodeBadge
        code={data.cie10Code}
        description={data.cie10Description || data.pathology}
        className={clsx(
          'absolute top-1/2 z-10 -translate-y-1/2',
          canShowDeliveryRoute ? 'right-16' : isGinecobstetricia ? 'right-9' : 'right-1'
        )}
      />
      {isGinecobstetricia && (
        <GinecobstetriciaSubtypeControl
          data={data}
          disabled={readOnly}
          onMultipleUpdate={onMultipleUpdate}
        />
      )}
      {canShowDeliveryRoute && onDeliveryRouteChange && (
        <div className="absolute right-9 top-1/2 z-10 -translate-y-1/2">
          <DeliveryRoutePopover
            deliveryRoute={data.deliveryRoute}
            deliveryDate={data.deliveryDate}
            deliveryCesareanLabor={data.deliveryCesareanLabor}
            onSave={onDeliveryRouteChange}
            disabled={readOnly}
          />
        </div>
      )}
    </td>
  );
};
