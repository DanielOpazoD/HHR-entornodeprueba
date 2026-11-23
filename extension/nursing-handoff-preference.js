// Profile preference only. The page receives a display flag, never session or patient data.
(() => {
  'use strict';
  const key = 'hhr-nursing-handoff-enabled';
  const storage = chrome.storage.local;
  let enabled = false;
  let revision = 0;
  const display = value => {
    enabled = value !== false;
    document.documentElement.toggleAttribute('data-hhr-handoff-enabled', enabled);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.hasOwn(changes, key)) return;
    revision++;
    display(changes[key].newValue);
  });
  const load = async () => {
    const before = revision;
    const stored = await storage.get(key);
    if (revision === before) display(stored[key]);
  };
  globalThis.HhrNursingHandoffPreference = Object.freeze({
    get: () => enabled, load,
    set: value => storage.set({ [key]: value === true }),
  });
  void load().catch(() => {});
})();
