import React from 'react';
import { DeviceSelector } from '@/components/DeviceSelector';
import { BaseCellProps, DeviceHandlers } from './inputCellTypes';
import { History } from 'lucide-react';
import { DeviceHistoryModal } from './DeviceHistoryModal';
import { useDevicesCellController } from '@/features/census/components/patient-row/useDevicesCellController';
import { useRayenFillStatus } from '@/features/rayen-import';
import { PatientEmptyCell } from './PatientEmptyCell';
import { CellSyncIndicator } from './CellSyncIndicator';

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
  onDeviceBundleChange,
}) => {
  const {
    devices,
    deviceDetails,
    history,
    owner,
    isHistoryOpen,
    openHistory,
    closeHistory,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleDeviceConfigChange,
    handleDeviceRetireChange,
    handleHistoryModalSave,
  } = useDevicesCellController({
    data,
    onDevicesChange,
    onDeviceDetailsChange,
    onDeviceHistoryChange,
    onDeviceBundleChange,
  });
  const isFilling = useRayenFillStatus();

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 w-32 relative" />;
  }

  return (
    <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative group">
      {isFilling && <CellSyncIndicator />}
      <DeviceSelector
        devices={devices}
        deviceDetails={deviceDetails}
        onChange={handleDevicesChange}
        onDetailsChange={handleDeviceDetailsChange}
        onConfigChange={handleDeviceConfigChange}
        onRetireChange={handleDeviceRetireChange}
        currentDate={currentDateString}
        disabled={readOnly || false}
      />

      {!isEmpty && !readOnly && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            openHistory();
          }}
          className="absolute right-0 top-0 z-10 inline-flex size-7 items-center justify-center rounded-bl-lg bg-slate-100 text-slate-500 opacity-0 transition-all duration-200 hover:bg-slate-200 hover:text-slate-700 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-500 group-hover:opacity-100"
          title="Ver historial detallado de dispositivos"
          aria-label="Ver historial detallado de dispositivos"
        >
          <History size={14} strokeWidth={2.5} />
        </button>
      )}

      {isHistoryOpen && (
        <DeviceHistoryModal
          patientName={data.patientName}
          history={history}
          currentDevices={devices}
          deviceDetails={deviceDetails}
          owner={owner}
          onSave={handleHistoryModalSave}
          onClose={closeHistory}
        />
      )}
    </td>
  );
};
