/**
 * DeviceSelector Component
 * Main component for selecting and managing patient devices.
 */

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { VVP_DEVICE_KEYS } from '@/constants';
import { DeviceDetails, DeviceInfo } from '@/types';
import {
    DeviceDateConfigModal,
    DeviceBadge,
    DeviceMenu,
    DeviceRetireModal
} from './device-selector';

// ============================================================================
// Helpers
// ============================================================================

const isAnyVvp = (device: string) => device === 'VVP' || device === '2 VVP' || device.startsWith('VVP#');

const normalizeDevices = (devices: string[]): string[] => {
    const existingVvpCount = devices.filter(d => d.startsWith('VVP#')).length;
    const legacyVvpCount = (devices.includes('2 VVP') ? 2 : 0) + (devices.includes('VVP') ? 1 : 0);
    const finalCount = Math.min(3, Math.max(existingVvpCount, legacyVvpCount));
    const nonVvpDevices = devices.filter(d => !isAnyVvp(d));
    return [...nonVvpDevices, ...VVP_DEVICE_KEYS.slice(0, finalCount)];
};

// ============================================================================
// Component
// ============================================================================

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
    currentDate
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [editingDevice, setEditingDevice] = useState<string | null>(null);
    const [pendingAddition, setPendingAddition] = useState<string | null>(null);
    const [retiringDevice, setRetiringDevice] = useState<string | null>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; placement?: 'top' | 'bottom' }>({ top: 0, left: 0, placement: 'bottom' });

    // Stable refs for callbacks to prevent effect re-runs
    const onChangeRef = useRef(onChange);
    const onDetailsChangeRef = useRef(onDetailsChange);

    useEffect(() => {
        onChangeRef.current = onChange;
        onDetailsChangeRef.current = onDetailsChange;
    }, [onChange, onDetailsChange]);

    // ========================================================================
    // Logic
    // ========================================================================
    const normalizedDevices = useMemo(() => normalizeDevices(devices), [devices]);

    const vvpCount = useMemo(() =>
        VVP_DEVICE_KEYS.filter(key => normalizedDevices.includes(key)).length,
        [normalizedDevices]);

    const vvpDevices = useMemo(() =>
        VVP_DEVICE_KEYS.filter(key => normalizedDevices.includes(key)),
        [normalizedDevices]);

    // ========================================================================
    // Event Handlers
    // ========================================================================

    const handleRetireDevice = useCallback((data: { removalDate: string; note: string }) => {
        if (!retiringDevice) return;

        const updatedDetails = { ...deviceDetails };
        updatedDetails[retiringDevice] = {
            ...updatedDetails[retiringDevice],
            removalDate: data.removalDate,
            note: `${updatedDetails[retiringDevice]?.note || ''}\n[Retiro] ${data.note}`.trim()
        };

        if (onDetailsChangeRef.current) {
            onDetailsChangeRef.current(updatedDetails);
        }

        // Remove from active list
        if (onChangeRef.current) {
            onChangeRef.current(normalizedDevices.filter(d => d !== retiringDevice));
        }
        setRetiringDevice(null);
    }, [retiringDevice, deviceDetails, normalizedDevices]);

    const toggleDevice = useCallback((device: string) => {
        // Special handling for adding VVP instances
        if (device === 'VVP') {
            const nextKey = VVP_DEVICE_KEYS.find(key => !normalizedDevices.includes(key));
            if (nextKey) {
                setPendingAddition(nextKey);
            }
            return;
        }

        if (normalizedDevices.includes(device)) {
            setRetiringDevice(device);
        } else {
            setPendingAddition(device);
        }
    }, [normalizedDevices]);

    const addCustomDevice = useCallback((device: string) => {
        if (!normalizedDevices.includes(device)) {
            setPendingAddition(device);
        }
    }, [normalizedDevices]);

    const removeDevice = useCallback((device: string) => {
        setRetiringDevice(device);
    }, []);

    const handleDeviceConfigSave = useCallback((info: DeviceInfo) => {
        const deviceToOperate = pendingAddition || editingDevice;
        if (!deviceToOperate) return;

        // If it was a pending addition, add it to the devices list
        if (pendingAddition && onChangeRef.current) {
            onChangeRef.current([...normalizedDevices, pendingAddition]);
        }

        // Ensure removalDate is cleared when adding or configuring an active device
        const sanitizedInfo = { ...info };
        delete sanitizedInfo.removalDate;

        if (onDetailsChangeRef.current) {
            onDetailsChangeRef.current({
                ...deviceDetails,
                [deviceToOperate]: sanitizedInfo
            });
        }

        setPendingAddition(null);
        setEditingDevice(null);
    }, [editingDevice, pendingAddition, deviceDetails, normalizedDevices]);

    // ========================================================================
    // Menu Position
    // ========================================================================

    const updateMenuPosition = useCallback(() => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const menuWidth = 360;
        const menuMaxHeight = 400; // Estimated maximum height
        const margin = 8;

        let left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
        left = Math.max(12, left); // Don't go off the left edge either

        // Intelligent vertical positioning
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldShowAbove = spaceBelow < menuMaxHeight && rect.top > spaceBelow;

        let top;
        if (shouldShowAbove) {
            top = rect.top - margin;
        } else {
            top = rect.bottom + margin;
        }

        setMenuPosition({
            top,
            left,
            placement: shouldShowAbove ? 'top' : 'bottom'
        });
    }, []);

    useEffect(() => {
        if (!showMenu) return;
        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        return () => window.removeEventListener('resize', updateMenuPosition);
    }, [showMenu, updateMenuPosition]);

    // ========================================================================
    // Render
    // ========================================================================

    if (disabled) {
        return (
            <div className="flex flex-wrap gap-1 min-h-[26px] items-center justify-start p-1 rounded border border-transparent">
                {devices.length === 0 && <span className="text-slate-300 text-xs">-</span>}
                {devices.map((dev, i) => (
                    <DeviceBadge key={i} device={dev} deviceDetails={deviceDetails} currentDate={currentDate} />
                ))}
            </div>
        );
    }

    return (
        <>
            <div
                ref={anchorRef}
                className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer items-center justify-start p-1 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors relative"
                onClick={() => setShowMenu(!showMenu)}
            >
                {devices.length === 0 && (
                    <span className="text-slate-300 mx-auto flex items-center justify-center w-full opacity-50">
                        <Plus size={14} />
                    </span>
                )}
                {devices.map((dev, i) => (
                    <DeviceBadge
                        key={i}
                        device={dev}
                        deviceDetails={deviceDetails}
                        currentDate={currentDate}
                        onRemove={removeDevice}
                    />
                ))}
            </div>

            {showMenu && (
                <DeviceMenu
                    devices={devices}
                    deviceDetails={deviceDetails}
                    vvpCount={vvpCount}
                    vvpDevices={vvpDevices}
                    menuPosition={menuPosition}
                    onClose={() => setShowMenu(false)}
                    onToggleDevice={toggleDevice}
                    onAddCustomDevice={addCustomDevice}
                    onRemoveDevice={removeDevice}
                    onConfigureDevice={setEditingDevice}
                />
            )}

            {(editingDevice || pendingAddition) && (
                <DeviceDateConfigModal
                    device={editingDevice || pendingAddition || ''}
                    deviceInfo={pendingAddition ? {} : (deviceDetails[editingDevice || ''] || {})}
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
                    deviceLabel={retiringDevice.startsWith('VVP#') ? `VVP #${retiringDevice.split('#')[1]}` : retiringDevice}
                    installationDate={deviceDetails[retiringDevice]?.installationDate}
                    currentDate={currentDate}
                    onConfirm={handleRetireDevice}
                    onClose={() => setRetiringDevice(null)}
                />
            )}
        </>
    );
};
