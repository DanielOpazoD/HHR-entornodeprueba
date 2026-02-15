import { useCallback, useMemo, useState } from 'react';
import { DeviceDetails, DeviceInstance, PatientData } from '@/types';
import {
  buildDetailsChangeResult,
  buildModalSaveResult,
  buildSelectionChangeResult,
} from '@/features/census/controllers/devicesCellController';
import { DateProvider, systemDateProvider } from '@/features/census/controllers/dateProvider';

interface UseDevicesCellControllerParams {
  data: PatientData;
  onDevicesChange: (devices: string[]) => void;
  onDeviceDetailsChange: (details: DeviceDetails) => void;
  onDeviceHistoryChange: (history: DeviceInstance[]) => void;
  dateProvider?: DateProvider;
}

export const useDevicesCellController = ({
  data,
  onDevicesChange,
  onDeviceDetailsChange,
  onDeviceHistoryChange,
  dateProvider = systemDateProvider,
}: UseDevicesCellControllerParams) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const devices = useMemo(() => data.devices || [], [data.devices]);
  const deviceDetails = useMemo(() => data.deviceDetails || {}, [data.deviceDetails]);
  const history = useMemo(
    () => (data.deviceInstanceHistory || []) as DeviceInstance[],
    [data.deviceInstanceHistory]
  );

  const openHistory = useCallback(() => setIsHistoryOpen(true), []);
  const closeHistory = useCallback(() => setIsHistoryOpen(false), []);

  const handleDevicesChange = useCallback(
    (nextDevices: string[]) => {
      const result = buildSelectionChangeResult({
        previousDevices: devices,
        nextDevices,
        previousHistory: history,
        deviceDetails,
        dateProvider,
      });

      onDevicesChange(result.nextDevices ?? nextDevices);
      if (result.nextHistory) {
        onDeviceHistoryChange(result.nextHistory);
      }
    },
    [dateProvider, deviceDetails, devices, history, onDeviceHistoryChange, onDevicesChange]
  );

  const handleDeviceDetailsChange = useCallback(
    (nextDetails: DeviceDetails) => {
      const result = buildDetailsChangeResult({
        nextDetails,
        activeDevices: devices,
        previousHistory: history,
        dateProvider,
      });

      onDeviceDetailsChange(result.nextDetails ?? nextDetails);
      if (result.nextHistory) {
        onDeviceHistoryChange(result.nextHistory);
      }
    },
    [dateProvider, devices, history, onDeviceDetailsChange, onDeviceHistoryChange]
  );

  const handleHistoryModalSave = useCallback(
    (nextHistory: DeviceInstance[]) => {
      const result = buildModalSaveResult(nextHistory);
      onDeviceHistoryChange(result.nextHistory);
      onDevicesChange(result.nextDevices);
    },
    [onDeviceHistoryChange, onDevicesChange]
  );

  return {
    devices,
    deviceDetails,
    history,
    isHistoryOpen,
    openHistory,
    closeHistory,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleHistoryModalSave,
  };
};
