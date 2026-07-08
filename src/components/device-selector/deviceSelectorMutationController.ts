import type { DeviceDetails, DeviceInfo, DeviceInstance } from '@/types/domain/devices';
import { buildRetireNote } from '@/components/device-selector/deviceSelectorController';

interface BuildRetireDeviceMutationParams {
  retiringDevice: string;
  normalizedDevices: string[];
  deviceDetails: DeviceDetails;
  removalDate: string;
  note: string;
}

export interface DeviceRetireMutationResult {
  nextDevices: string[];
  nextDetails: DeviceDetails;
}

interface BuildDeviceConfigMutationParams {
  pendingAddition: string | null;
  editingDevice: string | null;
  nextDeviceName?: string | null;
  normalizedDevices: string[];
  deviceDetails: DeviceDetails;
  info: DeviceInfo;
}

export interface DeviceConfigMutationResult {
  operatedDevice: string | null;
  renamedDevice?: { from: string; to: string } | null;
  nextDevices: string[] | null;
  nextDetails: DeviceDetails | null;
}

interface RenameCustomDeviceBundleParams {
  previousDevice: string;
  nextDevice: string;
  normalizedDevices: string[];
  deviceDetails: DeviceDetails;
  history: DeviceInstance[];
}

export interface RenameCustomDeviceBundleResult {
  nextDevices: string[];
  nextDetails: DeviceDetails;
  nextHistory: DeviceInstance[];
}

export const buildRetireDeviceMutation = ({
  retiringDevice,
  normalizedDevices,
  deviceDetails,
  removalDate,
  note,
}: BuildRetireDeviceMutationParams): DeviceRetireMutationResult => {
  const nextDetails = {
    ...deviceDetails,
    [retiringDevice]: {
      ...deviceDetails[retiringDevice],
      removalDate,
      note: buildRetireNote(deviceDetails[retiringDevice]?.note, note),
    },
  };

  return {
    nextDevices: normalizedDevices.filter(device => device !== retiringDevice),
    nextDetails,
  };
};

export const buildDeviceConfigMutation = ({
  pendingAddition,
  editingDevice,
  nextDeviceName,
  normalizedDevices,
  deviceDetails,
  info,
}: BuildDeviceConfigMutationParams): DeviceConfigMutationResult => {
  const operatedDevice = pendingAddition || editingDevice;
  if (!operatedDevice) {
    return {
      operatedDevice: null,
      nextDevices: null,
      nextDetails: null,
    };
  }

  const sanitizedInfo = { ...info };
  delete sanitizedInfo.removalDate;
  const resolvedDeviceName = (nextDeviceName || operatedDevice).trim();
  const collidesWithAnotherDevice = normalizedDevices.some(
    device => device !== operatedDevice && device === resolvedDeviceName
  );
  if (pendingAddition && (!resolvedDeviceName || collidesWithAnotherDevice)) {
    return {
      operatedDevice,
      renamedDevice: null,
      nextDevices: null,
      nextDetails: null,
    };
  }

  const isRename = Boolean(
    editingDevice &&
    resolvedDeviceName &&
    resolvedDeviceName !== operatedDevice &&
    !collidesWithAnotherDevice
  );
  const nextDetails = { ...deviceDetails };

  if (isRename) {
    delete nextDetails[operatedDevice];
    nextDetails[resolvedDeviceName] = sanitizedInfo;
  } else {
    nextDetails[operatedDevice] = sanitizedInfo;
  }

  return {
    operatedDevice,
    renamedDevice: isRename ? { from: operatedDevice, to: resolvedDeviceName } : null,
    nextDevices: pendingAddition
      ? [...normalizedDevices, resolvedDeviceName]
      : isRename
        ? normalizedDevices.map(device => (device === operatedDevice ? resolvedDeviceName : device))
        : null,
    nextDetails,
  };
};

export const renameCustomDeviceBundle = ({
  previousDevice,
  nextDevice,
  normalizedDevices,
  deviceDetails,
  history,
}: RenameCustomDeviceBundleParams): RenameCustomDeviceBundleResult => {
  const trimmedNextDevice = nextDevice.trim();
  const collidesWithAnotherDevice = normalizedDevices.some(
    device => device !== previousDevice && device === trimmedNextDevice
  );
  if (!trimmedNextDevice || trimmedNextDevice === previousDevice || collidesWithAnotherDevice) {
    return {
      nextDevices: normalizedDevices,
      nextDetails: deviceDetails,
      nextHistory: history,
    };
  }

  const nextDetails = { ...deviceDetails };
  if (nextDetails[previousDevice]) {
    nextDetails[trimmedNextDevice] = nextDetails[previousDevice];
    delete nextDetails[previousDevice];
  }

  return {
    nextDevices: normalizedDevices.map(device =>
      device === previousDevice ? trimmedNextDevice : device
    ),
    nextDetails,
    nextHistory: history.map(item =>
      item.type === previousDevice ? { ...item, type: trimmedNextDevice } : item
    ),
  };
};

export const resolveRetiringDeviceLabel = (retiringDevice: string): string =>
  retiringDevice.startsWith('VVP#') ? `VVP #${retiringDevice.split('#')[1]}` : retiringDevice;
