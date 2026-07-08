import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import { VVP_DEVICE_KEYS } from '@/constants/clinicalDeviceConstants';
import {
  buildDeviceHistoryTimestamp,
  matchesDeviceHistoryOwner,
  type DeviceHistoryOwner,
  resolveActiveDeviceTypesFromHistory,
  syncDeviceHistoryForDetails,
  syncDeviceHistoryForSelection,
} from '@/features/census/controllers/deviceHistoryController';
import { DateProvider, systemDateProvider } from '@/features/census/controllers/dateProvider';

interface BuildSelectionChangeResultParams {
  previousDevices: string[];
  nextDevices: string[];
  previousHistory: DeviceInstance[];
  deviceDetails: DeviceDetails;
  owner?: DeviceHistoryOwner;
  dateProvider?: DateProvider;
  createId?: () => string;
}

interface BuildDetailsChangeResultParams {
  activeDevices: string[];
  nextDetails: DeviceDetails;
  previousHistory: DeviceInstance[];
  owner?: DeviceHistoryOwner;
  dateProvider?: DateProvider;
  createId?: () => string;
}

interface BuildDeviceBundleChangeResultParams {
  previousDevices: string[];
  nextDevices: string[];
  nextDetails: DeviceDetails;
  previousHistory: DeviceInstance[];
  owner?: DeviceHistoryOwner;
  renamedDevice?: { from: string; to: string } | null;
  dateProvider?: DateProvider;
  createId?: () => string;
}

interface DevicesCellChangeResult {
  nextDevices?: string[];
  nextHistory?: DeviceInstance[];
  nextDetails?: DeviceDetails;
}

const defaultCreateId = () => crypto.randomUUID();

const isVvpDevice = (device: string): boolean => device.startsWith('VVP#');

const buildVvpSlotMap = (devices: string[]): Record<string, string> => {
  const map: Record<string, string> = {};
  let vvpIndex = 0;

  devices.forEach(device => {
    if (!isVvpDevice(device) || map[device]) {
      return;
    }

    const canonicalSlot = VVP_DEVICE_KEYS[vvpIndex];
    if (canonicalSlot) {
      map[device] = canonicalSlot;
      vvpIndex += 1;
    }
  });

  return map;
};

const removeRetirementFields = (details: DeviceDetails[string]): DeviceDetails[string] => {
  const activeDetails = { ...details };
  delete activeDetails.removalDate;
  return activeDetails;
};

const resolveCanonicalActiveDevices = (
  nextDevices: string[],
  vvpSlotMap: Record<string, string>
): string[] =>
  Array.from(new Set(nextDevices.map(device => vvpSlotMap[device] ?? device).filter(Boolean)));

const resolveCanonicalActiveDetails = ({
  nextDevices,
  nextDetails,
  vvpSlotMap,
}: {
  nextDevices: string[];
  nextDetails: DeviceDetails;
  vvpSlotMap: Record<string, string>;
}): DeviceDetails => {
  const canonicalDetails: DeviceDetails = {};

  nextDevices.forEach(device => {
    const canonicalDevice = vvpSlotMap[device] ?? device;
    const details = nextDetails[device];
    if (details) {
      canonicalDetails[canonicalDevice] = removeRetirementFields(details);
    }
  });

  return canonicalDetails;
};

const applyRetirementDetailsToHistory = ({
  previousDevices,
  nextDevices,
  nextDetails,
  history,
}: {
  previousDevices: string[];
  nextDevices: string[];
  nextDetails: DeviceDetails;
  history: DeviceInstance[];
}): DeviceInstance[] => {
  const removedDevices = previousDevices.filter(device => !nextDevices.includes(device));
  if (!removedDevices.length) {
    return history;
  }

  return history.map(item => {
    if (item.status !== 'Removed' || !removedDevices.includes(item.type)) {
      return item;
    }

    const details = nextDetails[item.type];
    if (!details) {
      return item;
    }

    return {
      ...item,
      removalDate: details.removalDate || item.removalDate,
      note: details.note || item.note,
    };
  });
};

const resolveCanonicalHistory = ({
  history,
  vvpSlotMap,
}: {
  history: DeviceInstance[];
  vvpSlotMap: Record<string, string>;
}): DeviceInstance[] =>
  history.map(item => {
    if (item.status !== 'Active') {
      return item;
    }

    const canonicalType = vvpSlotMap[item.type];
    if (!canonicalType || canonicalType === item.type) {
      return item;
    }

    return {
      ...item,
      type: canonicalType,
    };
  });

const applyDeviceRenameToHistory = ({
  history,
  owner,
  renamedDevice,
}: {
  history: DeviceInstance[];
  owner?: DeviceHistoryOwner;
  renamedDevice?: { from: string; to: string } | null;
}): DeviceInstance[] => {
  if (!renamedDevice || !renamedDevice.from || !renamedDevice.to) {
    return history;
  }

  return history.map(item =>
    item.type === renamedDevice.from && matchesDeviceHistoryOwner(item, owner)
      ? { ...item, type: renamedDevice.to }
      : item
  );
};

export const buildSelectionChangeResult = ({
  previousDevices,
  nextDevices,
  previousHistory,
  deviceDetails,
  owner,
  dateProvider = systemDateProvider,
  createId = defaultCreateId,
}: BuildSelectionChangeResultParams): DevicesCellChangeResult => {
  const selectionSync = syncDeviceHistoryForSelection({
    previousDevices,
    nextDevices,
    previousHistory,
    deviceDetails,
    owner,
    timestamp: buildDeviceHistoryTimestamp({ now: dateProvider() }),
    createId,
  });

  return {
    nextDevices,
    nextHistory: selectionSync.changed ? selectionSync.history : undefined,
  };
};

export const buildDetailsChangeResult = ({
  activeDevices,
  nextDetails,
  previousHistory,
  owner,
  dateProvider = systemDateProvider,
  createId = defaultCreateId,
}: BuildDetailsChangeResultParams): DevicesCellChangeResult => {
  const detailsSync = syncDeviceHistoryForDetails({
    nextDetails,
    activeDevices,
    previousHistory,
    owner,
    timestamp: buildDeviceHistoryTimestamp({ now: dateProvider() }),
    createId,
  });

  return {
    nextDetails,
    nextHistory: detailsSync.changed ? detailsSync.history : undefined,
  };
};

export const buildDeviceBundleChangeResult = ({
  previousDevices,
  nextDevices,
  nextDetails,
  previousHistory,
  owner,
  renamedDevice,
  dateProvider = systemDateProvider,
  createId = defaultCreateId,
}: BuildDeviceBundleChangeResultParams): Required<DevicesCellChangeResult> => {
  const renamedHistory = applyDeviceRenameToHistory({
    history: previousHistory,
    owner,
    renamedDevice,
  });
  const previousDevicesForSelection = renamedDevice
    ? previousDevices.map(device => (device === renamedDevice.from ? renamedDevice.to : device))
    : previousDevices;
  const selectionResult = buildSelectionChangeResult({
    previousDevices: previousDevicesForSelection,
    nextDevices,
    previousHistory: renamedHistory,
    deviceDetails: nextDetails,
    owner,
    dateProvider,
    createId,
  });

  const historyAfterSelection = applyRetirementDetailsToHistory({
    previousDevices: previousDevicesForSelection,
    nextDevices,
    nextDetails,
    history: selectionResult.nextHistory ?? renamedHistory,
  });

  const detailsResult = buildDetailsChangeResult({
    activeDevices: nextDevices,
    nextDetails,
    previousHistory: historyAfterSelection,
    owner,
    dateProvider,
    createId,
  });

  const historyAfterDetails = detailsResult.nextHistory ?? historyAfterSelection;
  const vvpSlotMap = buildVvpSlotMap(nextDevices);
  const canonicalDevices = resolveCanonicalActiveDevices(nextDevices, vvpSlotMap);
  const canonicalDetails = resolveCanonicalActiveDetails({
    nextDevices,
    nextDetails,
    vvpSlotMap,
  });

  return {
    nextDevices: canonicalDevices,
    nextDetails: canonicalDetails,
    nextHistory: resolveCanonicalHistory({
      history: historyAfterDetails,
      vvpSlotMap,
    }),
  };
};

export const buildModalSaveResult = (
  nextHistory: DeviceInstance[]
): Required<Pick<DevicesCellChangeResult, 'nextHistory' | 'nextDevices'>> => ({
  nextHistory,
  nextDevices: resolveActiveDeviceTypesFromHistory(nextHistory),
});
