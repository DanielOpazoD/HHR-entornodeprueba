/**
 * DeviceSelector Component
 * Main component for selecting and managing patient devices.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import type { DeviceDetails, DeviceInfo } from '@/types/domain/devices';
import { useLatestRef } from '@/hooks/useLatestRef';
import { usePortalPopoverRuntime } from '@/hooks/usePortalPopoverRuntime';
import { DeviceDateConfigModal } from './device-selector/DeviceDateConfigModal';
import { DeviceBadge } from './device-selector/DeviceBadge';
import { DeviceMenu } from './device-selector/DeviceMenu';
import { DeviceRetireModal } from './device-selector/DeviceRetireModal';
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
  onConfigChange?: (
    newDevices: string[] | null,
    details: DeviceDetails,
    options?: { renamedDevice?: { from: string; to: string } | null }
  ) => void;
  onRetireChange?: (newDevices: string[], details: DeviceDetails) => void;
  disabled?: boolean;
  currentDate?: string;
}

interface DeviceDraftState {
  devices: string[];
  details: DeviceDetails;
  externalSnapshot: string;
}

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
  devices = [],
  deviceDetails = {},
  onChange,
  onDetailsChange,
  onConfigChange,
  onRetireChange,
  disabled,
  currentDate,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [pendingAddition, setPendingAddition] = useState<string | null>(null);
  const [retiringDevice, setRetiringDevice] = useState<string | null>(null);
  const externalSnapshot = JSON.stringify({ devices, deviceDetails });
  const [draftState, setDraftState] = useState<DeviceDraftState>(() => ({
    devices,
    details: deviceDetails,
    externalSnapshot,
  }));
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useLatestRef(onChange);
  const onDetailsChangeRef = useLatestRef(onDetailsChange);
  const onConfigChangeRef = useLatestRef(onConfigChange);
  const onRetireChangeRef = useLatestRef(onRetireChange);

  // ========================================================================
  // Logic
  // ========================================================================
  const isEditingDevices = showMenu || Boolean(editingDevice || pendingAddition || retiringDevice);
  const draftSnapshot = JSON.stringify({
    devices: draftState.devices,
    deviceDetails: draftState.details,
  });

  if (
    draftState.externalSnapshot !== externalSnapshot ||
    (!isEditingDevices && draftSnapshot !== externalSnapshot)
  ) {
    setDraftState({
      devices,
      details: deviceDetails,
      externalSnapshot,
    });
  }

  const draftDevices =
    draftState.externalSnapshot === externalSnapshot ? draftState.devices : devices;
  const draftDetails =
    draftState.externalSnapshot === externalSnapshot ? draftState.details : deviceDetails;
  const normalizedDevices = useMemo(() => normalizeSelectedDevices(draftDevices), [draftDevices]);
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
        deviceDetails: draftDetails,
        removalDate: data.removalDate,
        note: data.note,
      });

      setDraftState(previous => ({
        ...previous,
        devices: mutation.nextDevices,
        details: mutation.nextDetails,
      }));

      if (onRetireChangeRef.current) {
        onRetireChangeRef.current(mutation.nextDevices, mutation.nextDetails);
      } else {
        if (onDetailsChangeRef.current) {
          onDetailsChangeRef.current(mutation.nextDetails);
        }
        if (onChangeRef.current) {
          onChangeRef.current(mutation.nextDevices);
        }
      }

      setRetiringDevice(null);
    },
    [
      retiringDevice,
      draftDetails,
      normalizedDevices,
      onChangeRef,
      onDetailsChangeRef,
      onRetireChangeRef,
      setDraftState,
      setRetiringDevice,
    ]
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
    [normalizedDevices, setPendingAddition, setRetiringDevice]
  );

  const addCustomDevice = useCallback(
    (device: string) => {
      if (!normalizedDevices.includes(device)) {
        setPendingAddition(device);
      }
    },
    [normalizedDevices, setPendingAddition]
  );

  const removeDevice = useCallback(
    (device: string) => {
      setRetiringDevice(device);
    },
    [setRetiringDevice]
  );

  const handleDeviceConfigSave = useCallback(
    (info: DeviceInfo, nextDeviceName?: string) => {
      const mutation = buildDeviceConfigMutation({
        pendingAddition,
        editingDevice,
        nextDeviceName,
        normalizedDevices,
        deviceDetails: draftDetails,
        info,
      });

      if (!mutation.operatedDevice) {
        return;
      }

      const nextDevices = mutation.nextDevices;
      if (nextDevices) {
        setDraftState(previous => ({
          ...previous,
          devices: nextDevices,
          details: mutation.nextDetails ?? previous.details,
        }));
      }
      if (mutation.nextDetails && !mutation.nextDevices) {
        setDraftState(previous => ({
          ...previous,
          details: mutation.nextDetails ?? previous.details,
        }));
      }

      if (mutation.nextDetails && onConfigChangeRef.current) {
        if (mutation.renamedDevice) {
          onConfigChangeRef.current(mutation.nextDevices, mutation.nextDetails, {
            renamedDevice: mutation.renamedDevice,
          });
        } else {
          onConfigChangeRef.current(mutation.nextDevices, mutation.nextDetails);
        }
      } else {
        if (mutation.nextDevices && onChangeRef.current) {
          onChangeRef.current(mutation.nextDevices);
        }

        if (mutation.nextDetails && onDetailsChangeRef.current) {
          onDetailsChangeRef.current(mutation.nextDetails);
        }
      }

      setPendingAddition(null);
      setEditingDevice(null);
    },
    [
      editingDevice,
      pendingAddition,
      draftDetails,
      normalizedDevices,
      onChangeRef,
      onConfigChangeRef,
      onDetailsChangeRef,
      setDraftState,
      setEditingDevice,
      setPendingAddition,
    ]
  );

  // ========================================================================
  // Menu Position
  // ========================================================================

  const closeMenu = useCallback(() => {
    setShowMenu(false);
  }, [setShowMenu]);

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
            deviceDetails={draftDetails}
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
            deviceDetails={draftDetails}
            currentDate={currentDate}
            onRemove={removeDevice}
          />
        ))}
      </div>

      {showMenu && typeof document !== 'undefined'
        ? createPortal(
            <DeviceMenu
              devices={normalizedDevices}
              deviceDetails={draftDetails}
              vvpCount={vvpCount}
              vvpDevices={vvpDevices}
              menuPosition={menuPosition}
              menuRef={menuRef}
              onClose={closeMenu}
              onToggleDevice={toggleDevice}
              onAddCustomDevice={addCustomDevice}
              onRemoveDevice={removeDevice}
              onConfigureDevice={setEditingDevice}
            />,
            document.body
          )
        : null}

      {(editingDevice || pendingAddition) && (
        <DeviceDateConfigModal
          device={editingDevice || pendingAddition || ''}
          deviceInfo={pendingAddition ? {} : draftDetails[editingDevice || ''] || {}}
          currentDate={currentDate}
          reservedDeviceNames={normalizedDevices.filter(device => device !== editingDevice)}
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
          installationDate={draftDetails[retiringDevice]?.installationDate}
          currentDate={currentDate}
          onConfirm={handleRetireDevice}
          onClose={() => setRetiringDevice(null)}
        />
      )}
    </>
  );
};
