/** Profile-local presentation preferences. Never stores patient or report content. */
(() => {
  'use strict';
  const KEY = 'hhr-center-presentation-v1';
  const normalize = value => ({
    mode: value?.mode === 'docked' ? 'docked' : 'floating',
    width: Math.max(400, Math.min(900, Number(value?.width) || 560)),
    density: value?.density === 'compact' ? 'compact' : 'normal',
    printFormat: value?.printFormat === 'compact' ? 'compact' : 'standard',
    labGroups: (Array.isArray(value?.labGroups) ? value.labGroups : [])
      .filter(group => group && typeof group.name === 'string' && Array.isArray(group.keys))
      .map(group => ({ name: group.name.trim().slice(0, 48), keys: [...new Set(group.keys
        .filter(key => typeof key === 'string' && key.length < 160))].slice(0, 100) }))
      .filter(group => group.name && group.keys.length),
  });
  const FIELDS = ['mode', 'width', 'density', 'printFormat'];
  // Reset the previous docked default once, preserving all other preferences.
  const fieldKey = key => key === 'mode' ? 'hhr-center-presentation-v2-mode' : KEY + '-' + key;
  const GROUP_PREFIX = 'hhr-center-lab-group-v1:';
  const groupId = name => GROUP_PREFIX + encodeURIComponent(String(name || '').trim().normalize('NFC').toLocaleLowerCase('es'));
  const create = storage => {
    let state = normalize();
    let loading = null;
    let loaded = false;
    let writes = Promise.resolve();
    const dirty = new Set();
    const listeners = new Set();
    const get = () => structuredClone(state);
    const notify = () => listeners.forEach(listener => listener(get()));
    const groupsFrom = stored => normalize({ labGroups: Object.entries(stored || {})
      .filter(([key]) => key.startsWith(GROUP_PREFIX)).map(([, value]) => value) }).labGroups
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const mergeGroup = group => {
      state.labGroups = [...state.labGroups.filter(item => groupId(item.name) !== groupId(group.name)), group]
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    };
    const load = () => loading || (loading = Promise.resolve().then(async () => {
      if (!storage?.get) return get();
      const stored = await storage.get(null);
      const storedState = normalize(Object.fromEntries(FIELDS.map(key => [key, stored[fieldKey(key)]])));
      loaded = true;
      FIELDS.forEach(key => { if (!dirty.has(key)) state[key] = storedState[key]; });
      state.labGroups = groupsFrom(stored);
      notify();
      return get();
    }).catch(() => { loading = null; loaded = false; return get(); }));
    const reloadGroups = async () => {
      await load();
      try { if (loaded) { state.labGroups = groupsFrom(await storage.get(null)); notify(); } } catch (_error) {}
      return get().labGroups;
    };
    const save = patch => {
      const keys = FIELDS.filter(key => Object.hasOwn(patch, key));
      keys.forEach(key => dirty.add(key));
      state = { ...normalize({ ...state, ...patch }), labGroups: state.labGroups };
      notify();
      writes = writes.then(async () => {
        await load();
        if (!loaded || !storage?.set) return false;
        try {
          await storage.set(Object.fromEntries(keys.map(key => [fieldKey(key), state[key]])));
          return true;
        } catch (_error) { return false; }
      });
      return writes;
    };
    const saveGroup = value => {
      writes = writes.then(async () => {
        const group = normalize({ labGroups: [value] }).labGroups[0];
        if (!group) return false;
        await reloadGroups();
        if (state.labGroups.length >= 20 && !state.labGroups.some(item => groupId(item.name) === groupId(group.name))) return false;
        if (!loaded || !storage?.set) return false;
        try {
          await storage.set({ [groupId(group.name)]: group });
          mergeGroup(group); notify(); return true;
        } catch (_error) { return false; }
      });
      return writes;
    };
    const removeGroup = name => {
      writes = writes.then(async () => {
        await reloadGroups();
        if (!loaded || !storage?.remove) return false;
        try {
          await storage.remove(groupId(name));
          state.labGroups = state.labGroups.filter(group => groupId(group.name) !== groupId(name));
          notify(); return true;
        } catch (_error) { return false; }
      });
      return writes;
    };
    return Object.freeze({ get, load, save, saveGroup, removeGroup, reloadGroups, groupId,
      subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } });
  };
  const preferences = create(globalThis.chrome?.storage?.local);
  globalThis.HhrCenterPreferences = Object.freeze({ ...preferences, create, normalize });
})();
