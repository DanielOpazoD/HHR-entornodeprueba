import type { DeviceDetails, DeviceInfo } from '@/types';
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
  normalizedDevices: string[];
  deviceDetails: DeviceDetails;
  info: DeviceInfo;
}

export interface DeviceConfigMutationResult {
  operatedDevice: string | null;
  nextDevices: string[] | null;
  nextDetails: DeviceDetails | null;
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

  return {
    operatedDevice,
    nextDevices: pendingAddition ? [...normalizedDevices, pendingAddition] : null,
    nextDetails: {
      ...deviceDetails,
      [operatedDevice]: sanitizedInfo,
    },
  };
};

export const resolveRetiringDeviceLabel = (retiringDevice: string): string =>
  retiringDevice.startsWith('VVP#') ? `VVP #${retiringDevice.split('#')[1]}` : retiringDevice;
