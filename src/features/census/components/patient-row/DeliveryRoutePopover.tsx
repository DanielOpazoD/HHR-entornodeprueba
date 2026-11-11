import type { CesareanLabor, DeliveryRoute } from '@/types/domain/patient';

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
  resolveDeliveryRouteIconColor,
  resolveDeliveryRouteTitle,
} from '@/features/census/controllers/deliveryRoutePopoverController';
import { useDeliveryRoutePopoverController } from '@/features/census/components/patient-row/useDeliveryRoutePopoverController';
import { DeliveryRoutePopoverPanel } from '@/features/census/components/patient-row/DeliveryRoutePopoverPanel';

interface DeliveryRoutePopoverProps {
  deliveryRoute?: DeliveryRoute;
  deliveryDate?: string;
  deliveryCesareanLabor?: CesareanLabor;
  onSave: (
    route: DeliveryRoute | undefined,
    date: string | undefined,
    cesareanLabor: CesareanLabor | undefined
  ) => void;
  disabled?: boolean;
}

export const DeliveryRoutePopover: React.FC<DeliveryRoutePopoverProps> = ({
  deliveryRoute,
  deliveryDate,
  deliveryCesareanLabor,
  onSave,
  disabled = false,
}) => {
  const POPOVER_WIDTH = 224;
  const {
    isOpen,
    popoverRef,
    buttonRef,
    popoverPos,
    selectedDate,
    selectedRoute,
    canSave,
    routeButtonModels,
    cesareanLaborButtonModels,
    hasPersistedData,
    setSelectedRoute,
    setSelectedDate,
    setSelectedCesareanLabor,
    saveAndClose,
    clearAndClose,
    closePopover,
    togglePopover,
  } = useDeliveryRoutePopoverController({
    deliveryRoute,
    deliveryDate,
    deliveryCesareanLabor,
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
        title={resolveDeliveryRouteTitle(deliveryRoute, deliveryDate, deliveryCesareanLabor)}
      >
        <HeartPulse size={14} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[10000]"
            style={{
              top: popoverPos.top,
              left: popoverPos.left,
            }}
            onClick={e => e.stopPropagation()}
          >
            <DeliveryRoutePopoverPanel
              selectedRoute={selectedRoute}
              selectedDate={selectedDate}
              canSave={canSave}
              hasPersistedData={hasPersistedData}
              routeButtonModels={routeButtonModels}
              cesareanLaborButtonModels={cesareanLaborButtonModels}
              onClose={closePopover}
              onRouteSelect={setSelectedRoute}
              onCesareanLaborSelect={setSelectedCesareanLabor}
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
