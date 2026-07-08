import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';

interface DeviceHistoryTimestamp {
  date: string;
  time: string;
  nowMs: number;
}

export interface DeviceHistoryOwner {
  clinicalEpisodeId?: string;
  patientRut?: string;
  patientName?: string;
}

interface DeviceHistoryOwnerSource extends DeviceHistoryOwner {
  rut?: string;
  bedId?: string;
}

interface BuildDeviceHistoryTimestampParams {
  now: Date;
}

interface SyncDeviceHistoryForSelectionParams {
  previousDevices: string[];
  nextDevices: string[];
  previousHistory: DeviceInstance[];
  deviceDetails: DeviceDetails;
  owner?: DeviceHistoryOwner;
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
  owner?: DeviceHistoryOwner;
  timestamp: DeviceHistoryTimestamp;
  createId: () => string;
}

interface BuildInitialDeviceHistoryParams {
  history: DeviceInstance[];
  currentDevices: string[];
  deviceDetails: DeviceDetails;
  owner?: DeviceHistoryOwner;
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

const normalizeIdentity = (value?: string): string => (value || '').trim().toLowerCase();

export const resolveDeviceHistoryOwner = ({
  clinicalEpisodeId,
  patientRut,
  rut,
  patientName,
}: DeviceHistoryOwnerSource): DeviceHistoryOwner => ({
  clinicalEpisodeId: clinicalEpisodeId || undefined,
  patientRut: patientRut || rut || undefined,
  patientName: patientName || undefined,
});

const hasDeviceHistoryOwner = (owner?: DeviceHistoryOwner): boolean =>
  Boolean(owner?.clinicalEpisodeId || owner?.patientRut);

export const matchesDeviceHistoryOwner = (
  item: DeviceInstance,
  owner?: DeviceHistoryOwner
): boolean => {
  if (!hasDeviceHistoryOwner(owner)) {
    return true;
  }

  if (item.clinicalEpisodeId && owner?.clinicalEpisodeId) {
    return normalizeIdentity(item.clinicalEpisodeId) === normalizeIdentity(owner.clinicalEpisodeId);
  }

  if (item.patientRut && owner?.patientRut) {
    return normalizeIdentity(item.patientRut) === normalizeIdentity(owner.patientRut);
  }

  return false;
};

const isCurrentUnownedDeviceHistory = ({
  item,
  currentDevices,
  deviceDetails,
}: {
  item: DeviceInstance;
  currentDevices: string[];
  deviceDetails: DeviceDetails;
}): boolean =>
  !item.clinicalEpisodeId &&
  !item.patientRut &&
  item.status === 'Active' &&
  (currentDevices.includes(item.type) || Boolean(deviceDetails[item.type]));

const filterDeviceHistoryForOwner = ({
  history,
  currentDevices,
  deviceDetails,
  owner,
}: {
  history: DeviceInstance[];
  currentDevices: string[];
  deviceDetails: DeviceDetails;
  owner?: DeviceHistoryOwner;
}): DeviceInstance[] => {
  if (!hasDeviceHistoryOwner(owner)) {
    return history;
  }

  return history.filter(
    item =>
      matchesDeviceHistoryOwner(item, owner) ||
      isCurrentUnownedDeviceHistory({ item, currentDevices, deviceDetails })
  );
};

const withDeviceHistoryOwner = (
  item: DeviceInstance,
  owner?: DeviceHistoryOwner
): DeviceInstance => {
  if (!hasDeviceHistoryOwner(owner)) {
    return item;
  }

  return {
    ...item,
    clinicalEpisodeId: item.clinicalEpisodeId || owner?.clinicalEpisodeId,
    patientRut: item.patientRut || owner?.patientRut,
    patientName: item.patientName || owner?.patientName,
  };
};

const needsDeviceHistoryOwnerStamp = (item: DeviceInstance, owner?: DeviceHistoryOwner): boolean =>
  hasDeviceHistoryOwner(owner) &&
  ((!item.clinicalEpisodeId && Boolean(owner?.clinicalEpisodeId)) ||
    (!item.patientRut && Boolean(owner?.patientRut)) ||
    (!item.patientName && Boolean(owner?.patientName)));

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
  owner,
  timestamp,
  createId,
}: BuildInitialDeviceHistoryParams): DeviceInstance[] => {
  const merged = filterDeviceHistoryForOwner({
    history,
    currentDevices,
    deviceDetails,
    owner,
  }).map(item => withDeviceHistoryOwner(item, owner));

  currentDevices.forEach(device => {
    const hasActive = merged.some(item => item.type === device && item.status === 'Active');
    if (hasActive) {
      return;
    }

    const detail = deviceDetails[device];
    merged.push({
      id: createId(),
      type: device,
      ...owner,
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
  owner,
  timestamp,
  createId,
}: SyncDeviceHistoryForSelectionParams): DeviceHistorySyncResult => {
  const filteredHistory = filterDeviceHistoryForOwner({
    history: previousHistory,
    currentDevices: nextDevices,
    deviceDetails,
    owner,
  });
  const history = filteredHistory.map(item => withDeviceHistoryOwner(item, owner));
  let changed =
    filteredHistory.length !== previousHistory.length ||
    filteredHistory.some(item => needsDeviceHistoryOwnerStamp(item, owner));

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
      ...owner,
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
      ...owner,
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
  owner,
  timestamp,
  createId,
}: SyncDeviceHistoryForDetailsParams): DeviceHistorySyncResult => {
  const filteredHistory = filterDeviceHistoryForOwner({
    history: previousHistory,
    currentDevices: activeDevices,
    deviceDetails: nextDetails,
    owner,
  });
  const history = filteredHistory.map(item => withDeviceHistoryOwner(item, owner));
  let changed =
    filteredHistory.length !== previousHistory.length ||
    filteredHistory.some(item => needsDeviceHistoryOwnerStamp(item, owner));

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
        ...owner,
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
