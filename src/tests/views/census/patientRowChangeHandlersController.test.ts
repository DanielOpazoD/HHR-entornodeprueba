import { describe, expect, it, vi } from 'vitest';
import { buildPatientRowChangeHandlers } from '@/features/census/controllers/patientRowChangeHandlersController';

describe('patientRowChangeHandlersController', () => {
  it('builds main and crib input change handlers preserving references', () => {
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

    const result = buildPatientRowChangeHandlers(fns);

    expect(result.mainInputChangeHandlers.text).toBe(fns.handleTextChange);
    expect(result.mainInputChangeHandlers.check).toBe(fns.handleCheckboxChange);
    expect(result.mainInputChangeHandlers.devices).toBe(fns.handleDevicesChange);
    expect(result.mainInputChangeHandlers.deviceDetails).toBe(fns.handleDeviceDetailsChange);
    expect(result.mainInputChangeHandlers.deviceHistory).toBe(fns.handleDeviceHistoryChange);
    expect(result.mainInputChangeHandlers.toggleDocType).toBe(fns.toggleDocumentType);
    expect(result.mainInputChangeHandlers.deliveryRoute).toBe(fns.handleDeliveryRouteChange);
    expect(result.mainInputChangeHandlers.multiple).toBe(fns.handleDemographicsSave);

    expect(result.cribInputChangeHandlers.text).toBe(fns.handleCribTextChange);
    expect(result.cribInputChangeHandlers.check).toBe(fns.handleCribCheckboxChange);
    expect(result.cribInputChangeHandlers.devices).toBe(fns.handleCribDevicesChange);
    expect(result.cribInputChangeHandlers.deviceDetails).toBe(fns.handleCribDeviceDetailsChange);
    expect(result.cribInputChangeHandlers.deviceHistory).toBe(fns.handleCribDeviceHistoryChange);
    expect(result.cribInputChangeHandlers.multiple).toBe(fns.handleCribDemographicsSave);
  });
});
