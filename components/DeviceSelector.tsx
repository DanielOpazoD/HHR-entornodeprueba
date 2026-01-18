/**
 * DeviceSelector Component
 * Main component for selecting and managing patient devices.
 * 
 * This component ORCHESTRATES sub-components:
 * - DeviceBadge: Individual device badge display
 * - DeviceMenu: Dropdown menu for device selection
 * - VVPSelector: VVP count selection (used within DeviceMenu)
 * - DeviceDateConfigModal: Modal for device date configuration
 */

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { VVP_DEVICE_KEYS } from '../constants';
import { DeviceDetails, DeviceInfo } from '../types';
import {
    DeviceDateConfigModal,
    DeviceBadge,
    DeviceMenu,
    TRACKED_DEVICES,
    TrackedDevice
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

const areArraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => val === b[idx]);
};

// ============================================================================
// Types
// ============================================================================

interface DeviceSelectorProps {
    devices: string[];
    deviceDetails?: DeviceDetails;
    onChange: (newDevices: string[]) => void;
    onDetailsChange?: (details: DeviceDetails) => void;
    disabled?: boolean;
    currentDate?: string;
}

// ============================================================================
// Component
// ============================================================================

export const DeviceSelector: React.FC<DeviceSelectorProps> = ({
    devices = [],
    deviceDetails = {},
    onChange,
    onDetailsChange,
    disabled,
    currentDate
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [editingDevice, setEditingDevice] = useState<string | null>(null); // Now supports any device
    const anchorRef = useRef<HTMLDivElement>(null);
    const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    // Stable refs for callbacks to prevent effect re-runs
    const onChangeRef = useRef(onChange);
    const onDetailsChangeRef = useRef(onDetailsChange);

    useEffect(() => {
        onChangeRef.current = onChange;
        onDetailsChangeRef.current = onDetailsChange;
    }, [onChange, onDetailsChange]);

    // ========================================================================
    // Normalize legacy VVP representations
    // We use useMemo to normalize for internal UI operations but do NOT 
    // attempt to update the parent state. This prevents render loops and 
    // hook count mismatches when switching between dates quickly.
    // ========================================================================
    const normalizedDevices = useMemo(() => normalizeDevices(devices), [devices]);

    // ========================================================================
    // VVP State
    // ========================================================================
    const vvpCount = VVP_DEVICE_KEYS.filter(key => normalizedDevices.includes(key)).length;
    const vvpDevices = VVP_DEVICE_KEYS.filter(key => normalizedDevices.includes(key));

    // ========================================================================
    // Event Handlers
    // ========================================================================

    const setVVPCount = useCallback((count: number) => {
        const clampedCount = Math.max(0, Math.min(3, count));
        const newDevices = normalizedDevices.filter(d => !isAnyVvp(d));
        const vvpsToAdd = VVP_DEVICE_KEYS.slice(0, clampedCount);
        onChange([...newDevices, ...vvpsToAdd]);


        if (onDetailsChange) {
            const updatedDetails = { ...deviceDetails };
            VVP_DEVICE_KEYS.slice(clampedCount).forEach(key => {
                delete updatedDetails[key];
            });
            onDetailsChange(updatedDetails);
        }
    }, [normalizedDevices, deviceDetails, onChange, onDetailsChange]);

    const toggleDevice = useCallback((device: string) => {
        if (normalizedDevices.includes(device)) {
            onChange(normalizedDevices.filter(d => d !== device));
            // Clear details if tracked device is removed
            if (TRACKED_DEVICES.includes(device as TrackedDevice) && onDetailsChange) {
                const newDetails = { ...deviceDetails };
                delete newDetails[device as TrackedDevice];
                onDetailsChange(newDetails);
            }
        } else {
            onChange([...normalizedDevices, device]);
        }
    }, [normalizedDevices, deviceDetails, onChange, onDetailsChange]);

    const addCustomDevice = useCallback((device: string) => {
        if (!normalizedDevices.includes(device)) {
            onChange([...normalizedDevices, device]);
        }
    }, [normalizedDevices, onChange]);

    const removeDevice = useCallback((device: string) => {
        onChange(normalizedDevices.filter(d => d !== device));
    }, [normalizedDevices, onChange]);

    const handleDeviceConfigSave = useCallback((info: DeviceInfo) => {
        if (editingDevice && onDetailsChangeRef.current) {
            onDetailsChangeRef.current({
                ...deviceDetails,
                [editingDevice]: info
            });
        }
    }, [editingDevice, deviceDetails]);

    // ========================================================================
    // Menu Position
    // ========================================================================

    const updateMenuPosition = useCallback(() => {
        if (!anchorRef.current) return;
        const rect = anchorRef.current.getBoundingClientRect();
        const width = 260;
        const left = Math.min(rect.left, window.innerWidth - width - 12);
        setMenuPosition({
            top: rect.bottom + 6,
            left
        });
    }, []);

    useEffect(() => {
        if (!showMenu) return;

        updateMenuPosition();

        const handle = () => updateMenuPosition();
        window.addEventListener('resize', handle);
        window.addEventListener('scroll', handle, true);

        return () => {
            window.removeEventListener('resize', handle);
            window.removeEventListener('scroll', handle, true);
        };
    }, [showMenu, updateMenuPosition]);

    // ========================================================================
    // Render
    // ========================================================================

    // When disabled, show badges in read-only mode (no interaction)
    if (disabled) {
        return (
            <div className="flex flex-wrap gap-1 min-h-[26px] items-center justify-start p-1 rounded border border-transparent">
                {devices.length === 0 && (
                    <span className="text-slate-300 text-xs">-</span>
                )}
                {devices.map((dev, i) => (
                    <DeviceBadge
                        key={i}
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
            {/* Device Badges Display */}
            <div
                ref={anchorRef}
                className="flex flex-wrap gap-1 min-h-[26px] cursor-pointer items-center justify-start p-1 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors relative"
                onClick={() => setShowMenu(!showMenu)}
                title="Haga clic para gestionar dispositivos"
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
                    />
                ))}
            </div>

            {/* Dropdown Menu */}
            {showMenu && (
                <DeviceMenu
                    devices={devices}
                    deviceDetails={deviceDetails}
                    vvpCount={vvpCount}
                    vvpDevices={vvpDevices}
                    menuPosition={menuPosition}
                    onClose={() => setShowMenu(false)}
                    onSetVVPCount={setVVPCount}
                    onToggleDevice={toggleDevice}
                    onAddCustomDevice={addCustomDevice}
                    onRemoveDevice={removeDevice}
                    onConfigureDevice={setEditingDevice}
                />
            )}

            {/* Device Configuration Modal */}
            {editingDevice && (
                <DeviceDateConfigModal
                    device={editingDevice}
                    deviceInfo={deviceDetails[editingDevice] || {}}
                    currentDate={currentDate}
                    onSave={handleDeviceConfigSave}
                    onClose={() => setEditingDevice(null)}
                />
            )}
        </>
    );
};

