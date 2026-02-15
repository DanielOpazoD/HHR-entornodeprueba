import { DeviceInstance } from '@/types';

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
  history.map(item => (item.id === id ? { ...item, ...updates, updatedAt } : item));
