import { useCallback, useMemo, useState } from 'react';
import type { DeviceDetails, DeviceInstance } from '@/types/domain/devices';
import type {
  PatientData,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import {
  buildDeviceBundleChangeResult,
  buildDetailsChangeResult,
  buildModalSaveResult,
  buildSelectionChangeResult,
} from '@/features/census/controllers/devicesCellController';
import { DateProvider, systemDateProvider } from '@/features/census/controllers/dateProvider';
import { resolveDeviceHistoryOwner } from '@/features/census/controllers/deviceHistoryController';

interface UseDevicesCellControllerParams {
  data: PatientData;
  onDevicesChange: (devices: string[]) => void;
  onDeviceDetailsChange: (details: DeviceDetails) => void;
  onDeviceHistoryChange: (history: DeviceInstance[]) => void;
  onDeviceBundleChange?: (fields: PatientRowPatientPatch) => void;
  dateProvider?: DateProvider;
}

export const useDevicesCellController = ({
  data,
  onDevicesChange,
  onDeviceDetailsChange,
  onDeviceHistoryChange,
  onDeviceBundleChange,
  dateProvider = systemDateProvider,
}: UseDevicesCellControllerParams) => {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const devices = useMemo(() => data.devices || [], [data.devices]);
  const deviceDetails = useMemo(() => data.deviceDetails || {}, [data.deviceDetails]);
  const owner = useMemo(
    () =>
      resolveDeviceHistoryOwner({
        clinicalEpisodeId: data.clinicalEpisodeId,
        patientName: data.patientName,
        rut: data.rut,
      }),
    [data.clinicalEpisodeId, data.patientName, data.rut]
  );
  const history = useMemo(
    () => (data.deviceInstanceHistory || []) as DeviceInstance[],
    [data.deviceInstanceHistory]
  );

  const openHistory = useCallback(() => setIsHistoryOpen(true), []);
  const closeHistory = useCallback(() => setIsHistoryOpen(false), []);

  const handleDevicesChange = useCallback(
    (nextDevices: string[]) => {
      const result = buildSelectionChangeResult({
        previousDevices: devices,
        nextDevices,
        previousHistory: history,
        deviceDetails,
        owner,
        dateProvider,
      });

      // Un solo parche atómico por gesto: emitir devices y su historial como
      // escrituras separadas hacía que la segunda naciera con versión vieja
      // (CAS) — reintentos de segundos o cambios perdidos al agregar LA/SNG.
      if (onDeviceBundleChange) {
        onDeviceBundleChange({
          devices: result.nextDevices ?? nextDevices,
          ...(result.nextHistory ? { deviceInstanceHistory: result.nextHistory } : {}),
        });
        return;
      }
      onDevicesChange(result.nextDevices ?? nextDevices);
      if (result.nextHistory) {
        onDeviceHistoryChange(result.nextHistory);
      }
    },
    [
      dateProvider,
      deviceDetails,
      devices,
      history,
      onDeviceBundleChange,
      onDeviceHistoryChange,
      onDevicesChange,
      owner,
    ]
  );

  const handleDeviceDetailsChange = useCallback(
    (nextDetails: DeviceDetails) => {
      const result = buildDetailsChangeResult({
        nextDetails,
        activeDevices: devices,
        previousHistory: history,
        owner,
        dateProvider,
      });

      if (onDeviceBundleChange) {
        onDeviceBundleChange({
          deviceDetails: result.nextDetails ?? nextDetails,
          ...(result.nextHistory ? { deviceInstanceHistory: result.nextHistory } : {}),
        });
        return;
      }
      onDeviceDetailsChange(result.nextDetails ?? nextDetails);
      if (result.nextHistory) {
        onDeviceHistoryChange(result.nextHistory);
      }
    },
    [
      dateProvider,
      devices,
      history,
      onDeviceBundleChange,
      onDeviceDetailsChange,
      onDeviceHistoryChange,
      owner,
    ]
  );

  const handleDeviceRetireChange = useCallback(
    (nextDevices: string[], nextDetails: DeviceDetails) => {
      const bundleResult = buildDeviceBundleChangeResult({
        previousDevices: devices,
        nextDevices,
        nextDetails,
        previousHistory: history,
        owner,
        dateProvider,
      });

      if (onDeviceBundleChange) {
        const fields: PatientRowPatientPatch = {
          devices: bundleResult.nextDevices,
          deviceDetails: bundleResult.nextDetails,
          deviceInstanceHistory: bundleResult.nextHistory,
        };
        onDeviceBundleChange(fields);
        return;
      }

      onDeviceDetailsChange(bundleResult.nextDetails);
      onDevicesChange(bundleResult.nextDevices);
      onDeviceHistoryChange(bundleResult.nextHistory);
    },
    [
      dateProvider,
      devices,
      history,
      owner,
      onDeviceBundleChange,
      onDeviceDetailsChange,
      onDeviceHistoryChange,
      onDevicesChange,
    ]
  );

  const handleDeviceConfigChange = useCallback(
    (
      nextDevices: string[] | null,
      nextDetails: DeviceDetails,
      options?: { renamedDevice?: { from: string; to: string } | null }
    ) => {
      const bundleResult = buildDeviceBundleChangeResult({
        previousDevices: devices,
        nextDevices: nextDevices ?? devices,
        nextDetails,
        previousHistory: history,
        owner,
        renamedDevice: options?.renamedDevice,
        dateProvider,
      });

      if (onDeviceBundleChange) {
        onDeviceBundleChange({
          devices: bundleResult.nextDevices,
          deviceDetails: bundleResult.nextDetails,
          deviceInstanceHistory: bundleResult.nextHistory,
        });
        return;
      }

      onDeviceDetailsChange(bundleResult.nextDetails);
      onDevicesChange(bundleResult.nextDevices);
      onDeviceHistoryChange(bundleResult.nextHistory);
    },
    [
      dateProvider,
      devices,
      history,
      owner,
      onDeviceBundleChange,
      onDeviceDetailsChange,
      onDeviceHistoryChange,
      onDevicesChange,
    ]
  );

  const handleHistoryModalSave = useCallback(
    (nextHistory: DeviceInstance[]) => {
      const result = buildModalSaveResult(nextHistory);
      if (onDeviceBundleChange) {
        onDeviceBundleChange({
          devices: result.nextDevices,
          deviceInstanceHistory: result.nextHistory,
        });
        return;
      }
      onDeviceHistoryChange(result.nextHistory);
      onDevicesChange(result.nextDevices);
    },
    [onDeviceBundleChange, onDeviceHistoryChange, onDevicesChange]
  );

  return {
    devices,
    deviceDetails,
    history,
    owner,
    isHistoryOpen,
    openHistory,
    closeHistory,
    handleDevicesChange,
    handleDeviceDetailsChange,
    handleDeviceConfigChange,
    handleDeviceRetireChange,
    handleHistoryModalSave,
  };
};
