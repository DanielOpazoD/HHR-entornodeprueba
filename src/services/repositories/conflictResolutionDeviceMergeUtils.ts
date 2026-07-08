import { ConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';

export type DeviceDetailsLike = Record<string, { removalDate?: unknown } | undefined>;
export type DeviceHistoryLike = Array<
  | {
      type?: unknown;
      status?: unknown;
      removalDate?: unknown;
    }
  | undefined
>;

const normalizeDeviceList = (devices: string[] = []): string[] =>
  Array.from(new Set(devices.filter(Boolean).map(String)));

const resolveLocallyRetiredDevices = (
  devices: string[],
  localDeviceDetails: DeviceDetailsLike | undefined,
  localDeviceHistory: DeviceHistoryLike | undefined
): Set<string> => {
  const retired = new Set<string>();
  devices.forEach(device => {
    const removalDate = localDeviceDetails?.[device]?.removalDate;
    if (String(removalDate || '').trim()) {
      retired.add(device);
    }

    const historyForDevice = (localDeviceHistory || []).filter(item => item?.type === device);
    const hasActiveHistory = historyForDevice.some(item => item?.status === 'Active');
    const hasRemovedHistory = historyForDevice.some(
      item => item?.status === 'Removed' && String(item?.removalDate || '').trim()
    );
    if (hasRemovedHistory && !hasActiveHistory) {
      retired.add(device);
    }
  });
  return retired;
};

export const mergePatientDevices = (
  remote: string[] = [],
  local: string[] = [],
  localDeviceDetails: DeviceDetailsLike | undefined,
  localDeviceHistory: DeviceHistoryLike | undefined,
  preferLocal: boolean,
  traceContext?: ConflictResolutionTraceContext,
  path = '',
  isExplicitlyChangedDeviceList = false
): string[] => {
  const localDevices = normalizeDeviceList(local);

  if (isExplicitlyChangedDeviceList) {
    traceContext?.add({
      path,
      strategy: 'copy_local_value',
      winner: 'local',
      reason: 'explicit_local_active_devices',
    });
    return localDevices;
  }

  const remoteDevices = normalizeDeviceList(remote);
  const retiredDevices = resolveLocallyRetiredDevices(
    [...remoteDevices, ...localDevices],
    localDeviceDetails,
    localDeviceHistory
  );
  const activeRemoteDevices = remoteDevices.filter(device => !retiredDevices.has(device));
  const activeLocalDevices = localDevices.filter(device => !retiredDevices.has(device));

  traceContext?.add({
    path,
    strategy: 'copy_preferred_active_devices',
    winner: preferLocal ? 'local' : 'remote',
    reason: retiredDevices.size
      ? 'device_active_snapshot_preserve_local_retire'
      : preferLocal
        ? 'active_devices_prefer_local_snapshot'
        : 'active_devices_prefer_remote_snapshot',
  });

  return preferLocal ? activeLocalDevices : activeRemoteDevices;
};
