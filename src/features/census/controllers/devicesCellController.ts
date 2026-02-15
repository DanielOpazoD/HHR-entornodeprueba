import { DeviceDetails, DeviceInstance } from '@/types';
import {
  buildDeviceHistoryTimestamp,
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
  dateProvider?: DateProvider;
  createId?: () => string;
}

interface BuildDetailsChangeResultParams {
  activeDevices: string[];
  nextDetails: DeviceDetails;
  previousHistory: DeviceInstance[];
  dateProvider?: DateProvider;
  createId?: () => string;
}

interface DevicesCellChangeResult {
  nextDevices?: string[];
  nextHistory?: DeviceInstance[];
  nextDetails?: DeviceDetails;
}

const defaultCreateId = () => crypto.randomUUID();

export const buildSelectionChangeResult = ({
  previousDevices,
  nextDevices,
  previousHistory,
  deviceDetails,
  dateProvider = systemDateProvider,
  createId = defaultCreateId,
}: BuildSelectionChangeResultParams): DevicesCellChangeResult => {
  const selectionSync = syncDeviceHistoryForSelection({
    previousDevices,
    nextDevices,
    previousHistory,
    deviceDetails,
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
  dateProvider = systemDateProvider,
  createId = defaultCreateId,
}: BuildDetailsChangeResultParams): DevicesCellChangeResult => {
  const detailsSync = syncDeviceHistoryForDetails({
    nextDetails,
    activeDevices,
    previousHistory,
    timestamp: buildDeviceHistoryTimestamp({ now: dateProvider() }),
    createId,
  });

  return {
    nextDetails,
    nextHistory: detailsSync.changed ? detailsSync.history : undefined,
  };
};

export const buildModalSaveResult = (
  nextHistory: DeviceInstance[]
): Required<Pick<DevicesCellChangeResult, 'nextHistory' | 'nextDevices'>> => ({
  nextHistory,
  nextDevices: resolveActiveDeviceTypesFromHistory(nextHistory),
});
