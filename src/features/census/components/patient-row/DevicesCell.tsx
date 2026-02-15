import React, { useMemo, useState } from 'react';
import { DeviceSelector } from '@/components/DeviceSelector';
import { BaseCellProps, DeviceHandlers } from './inputCellTypes';
import { History } from 'lucide-react';
import { DeviceHistoryModal } from './DeviceHistoryModal';
import { DeviceInstance } from '@/types';
import {
  buildDeviceHistoryTimestamp,
  resolveActiveDeviceTypesFromHistory,
  syncDeviceHistoryForDetails,
  syncDeviceHistoryForSelection,
} from '@/features/census/controllers/deviceHistoryController';

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
  onDeviceHistoryChange,
}) => {
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Memoize to prevent unnecessary re-renders
  const memoizedDevices = useMemo(() => data.devices || [], [data.devices]);
  const memoizedDeviceDetails = useMemo(() => data.deviceDetails || {}, [data.deviceDetails]);
  const memoizedHistory = useMemo(
    () => (data.deviceInstanceHistory || []) as DeviceInstance[],
    [data.deviceInstanceHistory]
  );
  const createId = () => crypto.randomUUID();

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
        onChange={newDevices => {
          onDevicesChange(newDevices);
          const selectionSync = syncDeviceHistoryForSelection({
            previousDevices: memoizedDevices,
            nextDevices: newDevices,
            previousHistory: memoizedHistory,
            deviceDetails: memoizedDeviceDetails,
            timestamp: buildDeviceHistoryTimestamp({ now: new Date() }),
            createId,
          });

          if (selectionSync.changed) {
            onDeviceHistoryChange(selectionSync.history);
          }
        }}
        onDetailsChange={newDetails => {
          onDeviceDetailsChange(newDetails);
          const detailsSync = syncDeviceHistoryForDetails({
            nextDetails: newDetails,
            activeDevices: memoizedDevices,
            previousHistory: memoizedHistory,
            timestamp: buildDeviceHistoryTimestamp({ now: new Date() }),
            createId,
          });

          if (detailsSync.changed) {
            onDeviceHistoryChange(detailsSync.history);
          }
        }}
        currentDate={currentDateString}
        disabled={readOnly || false}
      />

      {!isEmpty && !readOnly && (
        <button
          onClick={e => {
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
          onSave={newHistory => {
            onDeviceHistoryChange(newHistory);
            const activeTypes = resolveActiveDeviceTypesFromHistory(newHistory);
            onDevicesChange(activeTypes);
          }}
          onClose={() => setShowHistoryModal(false)}
        />
      )}
    </td>
  );
};
