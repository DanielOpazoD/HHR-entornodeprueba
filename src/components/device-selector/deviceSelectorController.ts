import { DEVICE_OPTIONS, VVP_DEVICE_KEYS } from '@/constants';

export const isAnyVvpDevice = (device: string): boolean =>
  device === 'VVP' || device === '2 VVP' || device.startsWith('VVP#');

export const normalizeSelectedDevices = (devices: string[]): string[] => {
  const existingVvpCount = devices.filter(device => device.startsWith('VVP#')).length;
  const legacyVvpCount = (devices.includes('2 VVP') ? 2 : 0) + (devices.includes('VVP') ? 1 : 0);
  const finalCount = Math.min(3, Math.max(existingVvpCount, legacyVvpCount));
  const nonVvpDevices = devices.filter(device => !isAnyVvpDevice(device));

  return [...nonVvpDevices, ...VVP_DEVICE_KEYS.slice(0, finalCount)];
};

export const resolveVvpDevices = (devices: string[]): string[] =>
  VVP_DEVICE_KEYS.filter(device => devices.includes(device));

export const resolveNextVvpKey = (normalizedDevices: string[]): string | null =>
  VVP_DEVICE_KEYS.find(device => !normalizedDevices.includes(device)) || null;

export type DeviceToggleOutcome =
  | { kind: 'pendingAddition'; device: string }
  | { kind: 'retire'; device: string }
  | { kind: 'noop' };

interface ResolveDeviceToggleOutcomeParams {
  requestedDevice: string;
  normalizedDevices: string[];
}

export const resolveDeviceToggleOutcome = ({
  requestedDevice,
  normalizedDevices,
}: ResolveDeviceToggleOutcomeParams): DeviceToggleOutcome => {
  if (requestedDevice === 'VVP') {
    const nextVvpKey = resolveNextVvpKey(normalizedDevices);
    return nextVvpKey ? { kind: 'pendingAddition', device: nextVvpKey } : { kind: 'noop' };
  }

  if (normalizedDevices.includes(requestedDevice)) {
    return { kind: 'retire', device: requestedDevice };
  }

  return { kind: 'pendingAddition', device: requestedDevice };
};

export const resolveCustomDeviceOptions = (devices: string[]): string[] =>
  devices.filter(device => !DEVICE_OPTIONS.includes(device) && !isAnyVvpDevice(device));

export const buildRetireNote = (previousNote: string | undefined, retireNote: string): string =>
  `${previousNote || ''}\n[Retiro] ${retireNote}`.trim();
