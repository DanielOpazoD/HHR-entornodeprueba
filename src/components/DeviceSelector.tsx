/**
 * DeviceSelector Component
 * Main component for selecting and managing patient devices.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { DeviceDetails, DeviceInfo } from '@/types';
import { useLatestRef } from '@/hooks/useLatestRef';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import {
  DeviceDateConfigModal,
  DeviceBadge,
  DeviceMenu,
  DeviceRetireModal,
} from './device-selector';
import {
  resolveDeviceMenuPosition,
  type DeviceMenuPosition,
} from '@/components/device-selector/deviceMenuPositionController';
import {
  normalizeSelectedDevices,
  resolveDeviceToggleOutcome,
  resolveVvpDevices,
} from '@/components/device-selector/deviceSelectorController';
import {
  buildDeviceConfigMutation,
  buildRetireDeviceMutation,
  resolveRetiringDeviceLabel,
} from '@/components/device-selector/deviceSelectorMutationController';

interface DeviceSelectorProps {
  devices: string[];
  deviceDetails?: DeviceDetails;
  onChange: (newDevices: string[]) => void;
  onDetailsChange?: (details: DeviceDetails) => void;
  disabled?: boolean;
  currentDate?: string;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  devices = [],
  deviceDetails = {},
  onChange,
  onDetailsChange,
  disabled,
  currentDate,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [pendingAddition, setPendingAddition] = useState<string | null>(null);
  const [retiringDevice, setRetiringDevice] = useState<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useLatestRef(onChange);
  const onDetailsChangeRef = useLatestRef(onDetailsChange);

  // ========================================================================
  // Logic
  // ========================================================================
  const normalizedDevices = useMemo(() => normalizeSelectedDevices(devices), [devices]);
  const vvpDevices = useMemo(() => resolveVvpDevices(normalizedDevices), [normalizedDevices]);
  const vvpCount = vvpDevices.length;

  // ========================================================================
  // Event Handlers
  // ========================================================================

  const handleRetireDevice = useCallback(
    (data: { removalDate: string; note: string }) => {
      if (!retiringDevice) {
        return;
      }

      const mutation = buildRetireDeviceMutation({
        retiringDevice,
        normalizedDevices,
        deviceDetails,
        removalDate: data.removalDate,
        note: data.note,
      });

      if (onDetailsChangeRef.current) {
        onDetailsChangeRef.current(mutation.nextDetails);
      }
      if (onChangeRef.current) {
        onChangeRef.current(mutation.nextDevices);
      }

      setRetiringDevice(null);
    },
    [retiringDevice, deviceDetails, normalizedDevices]
  );

  const toggleDevice = useCallback(
    (device: string) => {
      const outcome = resolveDeviceToggleOutcome({
        requestedDevice: device,
        normalizedDevices,
      });

      if (outcome.kind === 'pendingAddition') {
        setPendingAddition(outcome.device);
      }
      if (outcome.kind === 'retire') {
        setRetiringDevice(outcome.device);
      }
    },
    [normalizedDevices]
  );

  const addCustomDevice = useCallback(
    (device: string) => {
      if (!normalizedDevices.includes(device)) {
        setPendingAddition(device);
      }
    },
    [normalizedDevices]
  );

  const removeDevice = useCallback((device: string) => {
    setRetiringDevice(device);
  }, []);

  const handleDeviceConfigSave = useCallback(
    (info: DeviceInfo) => {
      const mutation = buildDeviceConfigMutation({
        pendingAddition,
        editingDevice,
        normalizedDevices,
        deviceDetails,
        info,
      });

      if (!mutation.operatedDevice) {
        return;
      }

      if (mutation.nextDevices && onChangeRef.current) {
        onChangeRef.current(mutation.nextDevices);
      }

      if (mutation.nextDetails && onDetailsChangeRef.current) {
        onDetailsChangeRef.current(mutation.nextDetails);
      }

      setPendingAddition(null);
      setEditingDevice(null);
    },
    [editingDevice, pendingAddition, deviceDetails, normalizedDevices]
  );

  // ========================================================================
  // Menu Position
  // ========================================================================

  const closeMenu = useCallback(() => {
    setShowMenu(false);
  }, []);

  const resolveMenuPosition = useCallback((): DeviceMenuPosition | null => {
    if (!anchorRef.current) return null;
    return resolveDeviceMenuPosition({
      anchorRect: anchorRef.current.getBoundingClientRect(),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  }, []);

  const { position: menuPosition, updatePosition: updateMenuPosition } = usePortalPopoverRuntime({
    isOpen: showMenu,
    anchorRef,
    popoverRef: menuRef,
    initialPosition: { top: 0, left: 0, placement: 'bottom' as const },
    resolvePosition: resolveMenuPosition,
    onClose: closeMenu,
  });

  // ========================================================================
  // Render
  // ========================================================================

  if (disabled) {
    return (
      <div className="flex flex-wrap gap-1 min-h-[26px] items-center justify-start p-1 rounded border border-transparent">
        {normalizedDevices.length === 0 && <span className="text-slate-300 text-xs">-</span>}
        {normalizedDevices.map(dev => (
          <DeviceBadge
            key={dev}
            device={dev}
            deviceDetails={deviceDetails}
            currentDate={currentDate}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <div
        ref={anchorRef}
        className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer items-center justify-start p-1 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors relative"
        onClick={() => {
          if (!showMenu) {
            updateMenuPosition();
          }
          setShowMenu(previous => !previous);
        }}
      >
        {normalizedDevices.length === 0 && (
          <span className="text-slate-300 mx-auto flex items-center justify-center w-full opacity-50">
            <Plus size={14} />
          </span>
        )}
        {normalizedDevices.map(dev => (
          <DeviceBadge
            key={dev}
            device={dev}
            deviceDetails={deviceDetails}
            currentDate={currentDate}
            onRemove={removeDevice}
          />
        ))}
      </div>

      {showMenu && (
        <DeviceMenu
          devices={normalizedDevices}
          deviceDetails={deviceDetails}
          vvpCount={vvpCount}
          vvpDevices={vvpDevices}
          menuPosition={menuPosition}
          menuRef={menuRef}
          onClose={closeMenu}
          onToggleDevice={toggleDevice}
          onAddCustomDevice={addCustomDevice}
          onRemoveDevice={removeDevice}
          onConfigureDevice={setEditingDevice}
        />
      )}

      {(editingDevice || pendingAddition) && (
        <DeviceDateConfigModal
          device={editingDevice || pendingAddition || ''}
          deviceInfo={pendingAddition ? {} : deviceDetails[editingDevice || ''] || {}}
          currentDate={currentDate}
          onSave={handleDeviceConfigSave}
          onClose={() => {
            setEditingDevice(null);
            setPendingAddition(null);
          }}
        />
      )}

      {retiringDevice && (
        <DeviceRetireModal
          deviceLabel={resolveRetiringDeviceLabel(retiringDevice)}
          installationDate={deviceDetails[retiringDevice]?.installationDate}
          currentDate={currentDate}
          onConfirm={handleRetireDevice}
          onClose={() => setRetiringDevice(null)}
        />
      )}
    </>
  );
};
