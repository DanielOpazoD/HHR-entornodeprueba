import type { DeviceDetails, DeviceInstance } from '@/types';

interface DeviceHistoryTimestamp {
  date: string;
  time: string;
  nowMs: number;
}

interface BuildDeviceHistoryTimestampParams {
  now: Date;
}

interface SyncDeviceHistoryForSelectionParams {
  previousDevices: string[];
  nextDevices: string[];
  previousHistory: DeviceInstance[];
  deviceDetails: DeviceDetails;
  timestamp: DeviceHistoryTimestamp;
  createId: () => string;
}
interface DeviceHistorySyncResult {
  history: DeviceInstance[];
  changed: boolean;
}

interface SyncDeviceHistoryForDetailsParams {
  nextDetails: DeviceDetails;
  activeDevices: string[];
  previousHistory: DeviceInstance[];
  timestamp: DeviceHistoryTimestamp;
  createId: () => string;
}

interface BuildInitialDeviceHistoryParams {
  history: DeviceInstance[];
  currentDevices: string[];
  deviceDetails: DeviceDetails;
  timestamp: DeviceHistoryTimestamp;
  createId: () => string;
}

export const buildDeviceHistoryTimestamp = ({
  now,
}: BuildDeviceHistoryTimestampParams): DeviceHistoryTimestamp => ({
  date: now.toISOString().split('T')[0],
  time: now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
  nowMs: now.getTime(),
});

const sortDeviceHistory = (history: DeviceInstance[]): DeviceInstance[] =>
  [...history].sort((a, b) => {
    if (a.status === 'Active' && b.status !== 'Active') return -1;
    if (a.status !== 'Active' && b.status === 'Active') return 1;
    return new Date(b.installationDate).getTime() - new Date(a.installationDate).getTime();
  });

export const resolveActiveDeviceTypesFromHistory = (history: DeviceInstance[]): string[] =>
  Array.from(new Set(history.filter(item => item.status === 'Active').map(item => item.type)));

export const buildInitialDeviceHistory = ({
  history,
  currentDevices,
  deviceDetails,
  timestamp,
  createId,
}: BuildInitialDeviceHistoryParams): DeviceInstance[] => {
  const merged = [...history];

  currentDevices.forEach(device => {
    const hasActive = merged.some(item => item.type === device && item.status === 'Active');
    if (hasActive) {
      return;
    }

    const detail = deviceDetails[device];
    merged.push({
      id: createId(),
      type: device,
      status: 'Active',
      installationDate: detail?.installationDate || timestamp.date,
      installationTime: '00:00',
      location: '',
      createdAt: timestamp.nowMs,
      updatedAt: timestamp.nowMs,
    });
  });

  return sortDeviceHistory(merged);
};

export const syncDeviceHistoryForSelection = ({
  previousDevices,
  nextDevices,
  previousHistory,
  deviceDetails,
  timestamp,
  createId,
}: SyncDeviceHistoryForSelectionParams): DeviceHistorySyncResult => {
  const history = [...previousHistory];
  let changed = false;

  previousDevices.forEach(oldDevice => {
    if (nextDevices.includes(oldDevice)) {
      return;
    }

    const activeIdx = history.findIndex(
      item => item.type === oldDevice && item.status === 'Active'
    );
    if (activeIdx !== -1) {
      history[activeIdx] = {
        ...history[activeIdx],
        status: 'Removed',
        removalDate: timestamp.date,
        removalTime: timestamp.time,
        updatedAt: timestamp.nowMs,
      };
      changed = true;
      return;
    }

    const oldDetails = deviceDetails[oldDevice];
    history.push({
      id: createId(),
      type: oldDevice,
      status: 'Removed',
      removalDate: timestamp.date,
      removalTime: timestamp.time,
      installationDate: oldDetails?.installationDate || timestamp.date,
      installationTime: '00:00',
      location: oldDetails?.note || '',
      createdAt: timestamp.nowMs,
      updatedAt: timestamp.nowMs,
    });
    changed = true;
  });

  nextDevices.forEach(nextDevice => {
    if (previousDevices.includes(nextDevice)) {
      return;
    }

    const hasActive = history.some(item => item.type === nextDevice && item.status === 'Active');
    if (hasActive) {
      return;
    }

    history.push({
      id: createId(),
      type: nextDevice,
      status: 'Active',
      installationDate: timestamp.date,
      installationTime: timestamp.time,
      location: '',
      createdAt: timestamp.nowMs,
      updatedAt: timestamp.nowMs,
    });
    changed = true;
  });

  return { history, changed };
};

export const syncDeviceHistoryForDetails = ({
  nextDetails,
  activeDevices,
  previousHistory,
  timestamp,
  createId,
}: SyncDeviceHistoryForDetailsParams): DeviceHistorySyncResult => {
  const history = [...previousHistory];
  let changed = false;

  Object.entries(nextDetails).forEach(([deviceType, detail]) => {
    const activeIdx = history.findIndex(
      item => item.type === deviceType && item.status === 'Active'
    );

    if (activeIdx !== -1) {
      if (
        detail.installationDate &&
        history[activeIdx].installationDate !== detail.installationDate
      ) {
        history[activeIdx] = {
          ...history[activeIdx],
          installationDate: detail.installationDate,
          updatedAt: timestamp.nowMs,
        };
        changed = true;
      }
      return;
    }

    if (activeDevices.includes(deviceType)) {
      history.push({
        id: createId(),
        type: deviceType,
        status: 'Active',
        installationDate: detail.installationDate || timestamp.date,
        installationTime: timestamp.time,
        location: '',
        createdAt: timestamp.nowMs,
        updatedAt: timestamp.nowMs,
      });
      changed = true;
    }
  });

  return { history, changed };
};
