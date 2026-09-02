import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reportBasicReadPermissionDenied,
  resetSessionPermissionStormDetector,
  SESSION_PERMISSION_STORM_WINDOW_MS,
  subscribeToSessionPermissionStorm,
} from '@/services/auth/sessionPermissionStormDetector';

describe('sessionPermissionStormDetector', () => {
  beforeEach(() => {
    resetSessionPermissionStormDetector();
  });

  it('una sola fuente denegada no es tormenta (puede ser un permiso legítimo por rol)', () => {
    const listener = vi.fn();
    subscribeToSessionPermissionStorm(listener);

    reportBasicReadPermissionDenied('records:getRecord', 1_000);
    reportBasicReadPermissionDenied('records:getRecord', 2_000);
    reportBasicReadPermissionDenied('records:getRecord', 3_000);

    expect(listener).not.toHaveBeenCalled();
  });

  it('dos fuentes básicas distintas dentro de la ventana anuncian la tormenta una sola vez', () => {
    const listener = vi.fn();
    subscribeToSessionPermissionStorm(listener);

    reportBasicReadPermissionDenied('records:subscribeToRecord', 1_000);
    reportBasicReadPermissionDenied('catalog:nurse', 4_000);
    reportBasicReadPermissionDenied('catalog:professionals', 5_000);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      sources: ['catalog:nurse', 'records:subscribeToRecord'],
      detectedAt: 4_000,
    });
  });

  it('las denegaciones fuera de la ventana no cuentan', () => {
    const listener = vi.fn();
    subscribeToSessionPermissionStorm(listener);

    reportBasicReadPermissionDenied('records:getAvailableDates', 1_000);
    reportBasicReadPermissionDenied('catalog:tens', 1_000 + SESSION_PERMISSION_STORM_WINDOW_MS + 1);

    expect(listener).not.toHaveBeenCalled();
  });

  it('reset limpia el historial y permite una nueva tormenta (nuevo inicio de sesión)', () => {
    const listener = vi.fn();
    subscribeToSessionPermissionStorm(listener);
    reportBasicReadPermissionDenied('records:getRecord', 1_000);
    reportBasicReadPermissionDenied('catalog:nurse', 2_000);
    expect(listener).toHaveBeenCalledTimes(1);

    resetSessionPermissionStormDetector();
    reportBasicReadPermissionDenied('records:getRecord', 3_000);
    expect(listener).toHaveBeenCalledTimes(1);
    reportBasicReadPermissionDenied('catalog:nurse', 4_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('la desuscripción deja de notificar', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionPermissionStorm(listener);
    unsubscribe();

    reportBasicReadPermissionDenied('records:getRecord', 1_000);
    reportBasicReadPermissionDenied('catalog:nurse', 2_000);

    expect(listener).not.toHaveBeenCalled();
  });
});
