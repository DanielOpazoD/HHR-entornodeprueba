import { useCallback, useState } from 'react';
import { DeviceDetails, DeviceInstance } from '@/types';
import {
  buildDeviceHistoryTimestamp,
  buildInitialDeviceHistory,
} from '@/features/census/controllers/deviceHistoryController';
import {
  removeDeviceHistoryRecord,
  updateDeviceHistoryRecord,
} from '@/features/census/controllers/deviceHistoryModalController';

interface UseDeviceHistoryEditorParams {
  history: DeviceInstance[];
  currentDevices: string[];
  deviceDetails: DeviceDetails;
  createId?: () => string;
  now?: Date;
}

export const useDeviceHistoryEditor = ({
  history,
  currentDevices,
  deviceDetails,
  createId = () => crypto.randomUUID(),
  now = new Date(),
}: UseDeviceHistoryEditorParams) => {
  const [localHistory, setLocalHistory] = useState<DeviceInstance[]>(() =>
    buildInitialDeviceHistory({
      history,
      currentDevices,
      deviceDetails,
      timestamp: buildDeviceHistoryTimestamp({ now }),
      createId,
    })
  );

  const deleteRecord = useCallback((id: string) => {
    setLocalHistory(prev => removeDeviceHistoryRecord(prev, id));
  }, []);

  const updateRecord = useCallback((id: string, updates: Partial<DeviceInstance>) => {
    setLocalHistory(prev => updateDeviceHistoryRecord({ history: prev, id, updates }));
  }, []);

  return {
    localHistory,
    deleteRecord,
    updateRecord,
  };
};
