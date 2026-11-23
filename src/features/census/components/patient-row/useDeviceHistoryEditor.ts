import { useCallback, useState } from 'react';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import {
  buildDeviceHistoryTimestamp,
  buildInitialDeviceHistory,
  type DeviceHistoryOwner,
} from '@/features/census/controllers/deviceHistoryController';

export const removeDeviceHistoryRecord = (
  history: DeviceInstance[],
  id: string
): DeviceInstance[] => history.filter(item => item.id !== id);

export const updateDeviceHistoryRecord = ({
  history,
  id,
  updates,
  updatedAt = Date.now(),
}: {
  history: DeviceInstance[];
  id: string;
  updates: Partial<DeviceInstance>;
  updatedAt?: number;
}): DeviceInstance[] =>
  history.map(item =>
    item.id === id
      ? {
          ...item,
          ...updates,
          source: 'manual',
          ...(updates.status === 'Removed' || updates.removalDate || updates.removalTime
            ? { removalSource: 'manual' as const }
            : {}),
          updatedAt,
        }
      : item
  );

interface UseDeviceHistoryEditorParams {
  history: DeviceInstance[];
  currentDevices: string[];
  deviceDetails: DeviceDetails;
  owner?: DeviceHistoryOwner;
  createId?: () => string;
  now?: Date;
}

export const useDeviceHistoryEditor = ({
  history,
  currentDevices,
  deviceDetails,
  owner,
  createId = () => crypto.randomUUID(),
  now = new Date(),
}: UseDeviceHistoryEditorParams) => {
  const [localHistory, setLocalHistory] = useState<DeviceInstance[]>(() =>
    buildInitialDeviceHistory({
      history,
      currentDevices,
      deviceDetails,
      owner,
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
