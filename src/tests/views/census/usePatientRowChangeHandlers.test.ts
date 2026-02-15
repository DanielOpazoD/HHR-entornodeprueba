import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePatientRowChangeHandlers } from '@/features/census/components/patient-row/usePatientRowChangeHandlers';

describe('usePatientRowChangeHandlers', () => {
  it('maps main and crib handlers to expected contract keys', () => {
    const fns = {
      handleTextChange: vi.fn(),
      handleCheckboxChange: vi.fn(),
      handleDevicesChange: vi.fn(),
      handleDeviceDetailsChange: vi.fn(),
      handleDeviceHistoryChange: vi.fn(),
      handleDemographicsSave: vi.fn(),
      toggleDocumentType: vi.fn(),
      handleDeliveryRouteChange: vi.fn(),
      handleCribTextChange: vi.fn(),
      handleCribCheckboxChange: vi.fn(),
      handleCribDevicesChange: vi.fn(),
      handleCribDeviceDetailsChange: vi.fn(),
      handleCribDeviceHistoryChange: vi.fn(),
      handleCribDemographicsSave: vi.fn(),
    };

    const { result } = renderHook(() => usePatientRowChangeHandlers(fns));

    expect(result.current.mainInputChangeHandlers.text).toBe(fns.handleTextChange);
    expect(result.current.mainInputChangeHandlers.check).toBe(fns.handleCheckboxChange);
    expect(result.current.mainInputChangeHandlers.devices).toBe(fns.handleDevicesChange);
    expect(result.current.mainInputChangeHandlers.deviceDetails).toBe(
      fns.handleDeviceDetailsChange
    );
    expect(result.current.mainInputChangeHandlers.deviceHistory).toBe(
      fns.handleDeviceHistoryChange
    );
    expect(result.current.mainInputChangeHandlers.toggleDocType).toBe(fns.toggleDocumentType);
    expect(result.current.mainInputChangeHandlers.deliveryRoute).toBe(
      fns.handleDeliveryRouteChange
    );
    expect(result.current.mainInputChangeHandlers.multiple).toBe(fns.handleDemographicsSave);

    expect(result.current.cribInputChangeHandlers.text).toBe(fns.handleCribTextChange);
    expect(result.current.cribInputChangeHandlers.check).toBe(fns.handleCribCheckboxChange);
    expect(result.current.cribInputChangeHandlers.devices).toBe(fns.handleCribDevicesChange);
    expect(result.current.cribInputChangeHandlers.deviceDetails).toBe(
      fns.handleCribDeviceDetailsChange
    );
    expect(result.current.cribInputChangeHandlers.deviceHistory).toBe(
      fns.handleCribDeviceHistoryChange
    );
    expect(result.current.cribInputChangeHandlers.multiple).toBe(fns.handleCribDemographicsSave);
  });
});
