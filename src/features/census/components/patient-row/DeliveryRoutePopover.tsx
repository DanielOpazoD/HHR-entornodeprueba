/**
 * DeliveryRoutePopover - Registro de Vía del Parto
 * Shows a subtle icon next to diagnosis for Ginecobstetricia patients
 * that opens a popover to record delivery route (Vaginal/Cesárea) and date.
 * Uses React Portal to escape ANY parent clipping and transform constraints.
 */

import React from 'react';
import { createPortal } from 'react-dom';
import { HeartPulse } from 'lucide-react';
import clsx from 'clsx';
import {
  type DeliveryRoute,
  resolveDeliveryRouteIconColor,
  resolveDeliveryRouteTitle,
} from '@/features/census/controllers/deliveryRoutePopoverController';
import { useDeliveryRoutePopoverController } from '@/features/census/components/patient-row/useDeliveryRoutePopoverController';
import { DeliveryRoutePopoverPanel } from '@/features/census/components/patient-row/DeliveryRoutePopoverPanel';

interface DeliveryRoutePopoverProps {
  deliveryRoute?: DeliveryRoute;
  deliveryDate?: string;
  onSave: (route: DeliveryRoute | undefined, date: string | undefined) => void;
  disabled?: boolean;
}

export const DeliveryRoutePopover: React.FC<DeliveryRoutePopoverProps> = ({
  deliveryRoute,
  deliveryDate,
  onSave,
  disabled = false,
}) => {
  const POPOVER_WIDTH = 208;
  const {
    isOpen,
    popoverRef,
    buttonRef,
    popoverPos,
    selectedRoute,
    selectedDate,
    canSave,
    routeButtonModels,
    hasPersistedData,
    setSelectedRoute,
    setSelectedDate,
    saveAndClose,
    clearAndClose,
    closePopover,
    togglePopover,
  } = useDeliveryRoutePopoverController({
    deliveryRoute,
    deliveryDate,
    onSave,
    disabled,
    panelWidth: POPOVER_WIDTH,
  });

  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        ref={buttonRef}
        onClick={togglePopover}
        disabled={disabled}
        className={clsx(
          'p-0.5 rounded transition-all duration-200',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-100',
          resolveDeliveryRouteIconColor(hasPersistedData, deliveryRoute)
        )}
        title={resolveDeliveryRouteTitle(deliveryRoute, deliveryDate)}
      >
        <HeartPulse size={14} />
      </button>

      {/* Popover - Compacted size and fonts */}
      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              top: popoverPos.top,
              left: popoverPos.left,
              position: 'fixed',
            }}
            onClick={e => e.stopPropagation()}
          >
            <DeliveryRoutePopoverPanel
              selectedDate={selectedDate}
              canSave={canSave}
              hasPersistedData={hasPersistedData}
              routeButtonModels={routeButtonModels}
              onClose={closePopover}
              onRouteSelect={setSelectedRoute}
              onDateChange={setSelectedDate}
              onClear={() => clearAndClose(closePopover)}
              onSave={() => saveAndClose(closePopover)}
            />
          </div>,
          document.body
        )}
    </div>
  );
};
