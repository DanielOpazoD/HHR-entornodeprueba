import React, { useMemo, useState } from 'react';
import { DeviceSelector } from '@/components/DeviceSelector';
import { BaseCellProps, DeviceHandlers } from './inputCellTypes';
import { History } from 'lucide-react';
import { DeviceHistoryModal } from './DeviceHistoryModal';
import { DeviceInstance } from '@/types';

interface DevicesCellProps extends BaseCellProps, DeviceHandlers {
    currentDateString: string;
}

export const DevicesCell: React.FC<DevicesCellProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    currentDateString,
    onDevicesChange,
    onDeviceDetailsChange,
    onDeviceHistoryChange
}) => {
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // Memoize to prevent unnecessary re-renders
    const memoizedDevices = useMemo(() => data.devices || [], [data.devices]);
    const memoizedDeviceDetails = useMemo(() => data.deviceDetails || {}, [data.deviceDetails]);
    const memoizedHistory = useMemo(() => (data.deviceInstanceHistory || []) as DeviceInstance[], [data.deviceInstanceHistory]);

    if (isEmpty && !isSubRow) {
        return (
            <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative">
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">
                    -
                </div>
            </td>
        );
    }


    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative group">
            <DeviceSelector
                devices={memoizedDevices}
                deviceDetails={memoizedDeviceDetails}
                onChange={(newDevices) => {
                    // 1. Update standard devices list
                    onDevicesChange(newDevices);

                    // 2. Auto-sync History
                    // Helper to get current Date/Time
                    const now = new Date();
                    const dateStr = now.toISOString().split('T')[0];
                    const timeStr = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

                    const currentHistory = [...memoizedHistory];
                    let historyChanged = false;

                    // A. Handle Removals (Present in OLD, missing in NEW)
                    memoizedDevices.forEach(oldDevice => {
                        if (!newDevices.includes(oldDevice)) {
                            // Find active instance in history
                            const activeIdx = currentHistory.findIndex(h => h.type === oldDevice && h.status === 'Active');
                            if (activeIdx !== -1) {
                                currentHistory[activeIdx] = {
                                    ...currentHistory[activeIdx],
                                    status: 'Removed',
                                    removalDate: dateStr,
                                    removalTime: timeStr,
                                    updatedAt: Date.now()
                                };
                                historyChanged = true;
                            } else {
                                // Retroactive Creation for legacy devices
                                // If removing a device that wasn't in history, create a 'Removed' entry for it immediately
                                const oldDetails = memoizedDeviceDetails[oldDevice];
                                currentHistory.push({
                                    id: crypto.randomUUID(),
                                    type: oldDevice,
                                    status: 'Removed',
                                    removalDate: dateStr,
                                    removalTime: timeStr,
                                    // Try to recover installation date/location from details before they are lost
                                    installationDate: oldDetails?.installationDate || dateStr,
                                    installationTime: '00:00', // Unknown installation time for legacy
                                    location: oldDetails?.note || '',
                                    createdAt: Date.now(),
                                    updatedAt: Date.now()
                                });
                                historyChanged = true;
                            }
                        }
                    });

                    // B. Handle Additions (Missing in OLD, present in NEW)
                    newDevices.forEach(newDevice => {
                        if (!memoizedDevices.includes(newDevice)) {
                            // Check if distinct active instance exists (unlikely if string list match, but safety check)
                            const hasActive = currentHistory.some(h => h.type === newDevice && h.status === 'Active');
                            if (!hasActive) {
                                currentHistory.push({
                                    id: crypto.randomUUID(),
                                    type: newDevice,
                                    status: 'Active',
                                    installationDate: dateStr,
                                    installationTime: timeStr,
                                    location: '', // User can edit details later in modal
                                    createdAt: Date.now(),
                                    updatedAt: Date.now()
                                });
                                historyChanged = true;
                            }
                        }
                    });

                    if (historyChanged) {
                        onDeviceHistoryChange(currentHistory);
                    }
                }}
                onDetailsChange={(newDetails) => {
                    // 1. Update standard details
                    onDeviceDetailsChange(newDetails);

                    // 2. Auto-sync History Dates/Notes
                    // If the user changed the date in DeviceDateConfigModal, we must update the Active history item
                    const currentHistory = [...memoizedHistory];
                    let historyChanged = false;

                    // Iterate over changed details
                    Object.entries(newDetails).forEach(([deviceType, info]) => {
                        // Find active instance for this device type
                        const activeIdx = currentHistory.findIndex(h => h.type === deviceType && h.status === 'Active');

                        if (activeIdx !== -1) {
                            // Update existing active item
                            if (info.installationDate && currentHistory[activeIdx].installationDate !== info.installationDate) {
                                currentHistory[activeIdx] = {
                                    ...currentHistory[activeIdx],
                                    installationDate: info.installationDate,
                                    updatedAt: Date.now()
                                };
                                historyChanged = true;
                            }
                        } else if (memoizedDevices.includes(deviceType)) {
                            // Edge case: Device is in list but no active history item found (shouldn't happen with list sync, but robustify)
                            // Create it now
                            const now = new Date();
                            currentHistory.push({
                                id: crypto.randomUUID(),
                                type: deviceType,
                                status: 'Active',
                                installationDate: info.installationDate || now.toISOString().split('T')[0],
                                installationTime: now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
                                location: '',
                                createdAt: Date.now(),
                                updatedAt: Date.now()
                            });
                            historyChanged = true;
                        }
                    });

                    if (historyChanged) {
                        onDeviceHistoryChange(currentHistory);
                    }
                }}
                currentDate={currentDateString}
                disabled={readOnly || false}
            />

            {!isEmpty && !readOnly && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowHistoryModal(true);
                    }}
                    className="absolute top-0 right-0 p-0.5 rounded-bl-md transition-all duration-200 z-10 bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-600"
                    title="Ver historial detallado de dispositivos"
                >
                    <History size={10} strokeWidth={3} />
                </button>
            )}

            {showHistoryModal && (
                <DeviceHistoryModal
                    patientName={data.patientName}
                    history={memoizedHistory}
                    currentDevices={memoizedDevices}
                    deviceDetails={memoizedDeviceDetails}
                    onSave={(newHistory) => {
                        onDeviceHistoryChange(newHistory);

                        // Strict sync: The devices list in the census should exactly match the 'Active' items in history
                        const activeTypes = Array.from(new Set(newHistory.filter(h => h.status === 'Active').map(h => h.type)));

                        // Sort activeTypes if needed (optional, keeping it simple for now)
                        onDevicesChange(activeTypes);
                    }}
                    onClose={() => setShowHistoryModal(false)}
                />
            )}
        </td>
    );
};

