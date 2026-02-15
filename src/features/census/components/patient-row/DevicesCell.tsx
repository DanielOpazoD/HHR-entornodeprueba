import React from 'react';
import { DeviceSelector } from '@/components/DeviceSelector';
import { BaseCellProps, DeviceHandlers } from './inputCellTypes';
import { History } from 'lucide-react';
import { DeviceHistoryModal } from './DeviceHistoryModal';
import { useDevicesCellController } from '@/features/census/components/patient-row/useDevicesCellController';
import { PatientEmptyCell } from './PatientEmptyCell';

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
  const {
    devices,
    deviceDetails,
    history,
    isHistoryOpen,
    openHistory,
    closeHistory,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleHistoryModalSave,
  } = useDevicesCellController({
    data,
    onDevicesChange,
    onDeviceDetailsChange,
    onDeviceHistoryChange,
  });

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 w-32 relative" />;
  }

  return (
    <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative group">
      <DeviceSelector
        devices={devices}
        deviceDetails={deviceDetails}
        onChange={handleDevicesChange}
        onDetailsChange={handleDeviceDetailsChange}
        currentDate={currentDateString}
        disabled={readOnly || false}
      />

      {!isEmpty && !readOnly && (
        <button
          onClick={e => {
            e.stopPropagation();
            openHistory();
          }}
          className="absolute top-0 right-0 p-0.5 rounded-bl-md transition-all duration-200 z-10 bg-slate-100 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-600"
          title="Ver historial detallado de dispositivos"
        >
          <History size={10} strokeWidth={3} />
        </button>
      )}

      {isHistoryOpen && (
        <DeviceHistoryModal
          patientName={data.patientName}
          history={history}
          currentDevices={devices}
          deviceDetails={deviceDetails}
          onSave={handleHistoryModalSave}
          onClose={closeHistory}
        />
      )}
    </td>
  );
};
