import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { UISettingsProvider, useUISettings } from '@/context/UISettingsContext';
import { DEFAULT_UI_SETTINGS } from '@/services/storage/uiSettingsService';

describe('UISettingsContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove(
      'aesthetic-glass',
      'aesthetic-animations',
      'aesthetic-typography'
    );
  });

  it('memoizes provider value across parent re-renders and updates settings cleanly', () => {
    let consumerRenders = 0;
    let latestApi: ReturnType<typeof useUISettings> | undefined;

    const Consumer = React.memo(function UISettingsConsumer() {
      consumerRenders += 1;
      latestApi = useUISettings();
      return null;
    });
    const stableChild = <Consumer />;

    const { rerender } = render(<UISettingsProvider>{stableChild}</UISettingsProvider>);
    expect(consumerRenders).toBe(1);
    const initialApi = latestApi;

    rerender(<UISettingsProvider>{stableChild}</UISettingsProvider>);
    rerender(<UISettingsProvider>{stableChild}</UISettingsProvider>);
    expect(consumerRenders).toBe(1);
    expect(latestApi).toBe(initialApi);

    const toggled = !DEFAULT_UI_SETTINGS.glassmorphism;
    act(() => {
      latestApi?.updateSetting('glassmorphism', toggled);
    });
    expect(latestApi?.settings.glassmorphism).toBe(toggled);
    expect(latestApi?.updateSetting).toBe(initialApi?.updateSetting);
    expect(latestApi?.resetSettings).toBe(initialApi?.resetSettings);

    act(() => {
      latestApi?.resetSettings();
    });
    expect(latestApi?.settings).toEqual(DEFAULT_UI_SETTINGS);
  });
});
