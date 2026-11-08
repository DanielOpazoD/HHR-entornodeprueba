/**
 * The «+N» that closes a device list after its first three badges, so every census row keeps at
 * most the height of three lines. It opens a small card with all the patient's devices; editing
 * stays where it was, in the device menu.
 */

import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DeviceDetails } from '@/types/domain/devices';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import { DeviceBadge } from './DeviceBadge';
import { resolveDeviceMenuPosition, type DeviceMenuPosition } from './deviceMenuPositionController';

const CARD_WIDTH = 176;
const CARD_MAX_HEIGHT = 240;

interface DeviceOverflowButtonProps {
  devices: string[];
  hiddenCount: number;
  deviceDetails: DeviceDetails;
  currentDate?: string;
}

export const DeviceOverflowButton: React.FC<DeviceOverflowButtonProps> = ({
  devices,
  hiddenCount,
  deviceDetails,
  currentDate,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  const resolvePosition = useCallback((): DeviceMenuPosition | null => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return null;
    return resolveDeviceMenuPosition({
      anchorRect: anchor,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      menuWidth: CARD_WIDTH,
      menuMaxHeight: CARD_MAX_HEIGHT,
      offset: 4,
    });
  }, []);
  const { position, updatePosition } = usePortalPopoverRuntime<DeviceMenuPosition>({
    isOpen,
    anchorRef: buttonRef,
    popoverRef: cardRef,
    initialPosition: { top: 0, left: 0, placement: 'bottom' },
    resolvePosition,
    onClose: close,
  });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Ver los ${devices.length} dispositivos`}
        title={`${hiddenCount} dispositivo${hiddenCount === 1 ? '' : 's'} más`}
        data-testid="device-overflow"
        onClick={event => {
          event.stopPropagation();
          if (!isOpen) updatePosition();
          setIsOpen(open => !open);
        }}
        className="absolute bottom-0.5 right-0 z-[1] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-slate-600 px-1 text-[9px] font-bold leading-none text-white shadow-sm ring-2 ring-white transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600 print:hidden"
      >
        +{hiddenCount}
      </button>
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label="Dispositivos del paciente"
            data-testid="device-overflow-card"
            onClick={event => event.stopPropagation()}
            className="fixed z-50 flex flex-col items-start gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
            style={{
              top: position.top,
              left: position.left,
              width: CARD_WIDTH,
              maxHeight: CARD_MAX_HEIGHT,
              transform: position.placement === 'top' ? 'translateY(-100%)' : undefined,
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Dispositivos ({devices.length})
            </p>
            <div className="flex flex-col items-start gap-1 overflow-y-auto">
              {devices.map(device => (
                <DeviceBadge
                  key={device}
                  device={device}
                  deviceDetails={deviceDetails}
                  currentDate={currentDate}
                />
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
