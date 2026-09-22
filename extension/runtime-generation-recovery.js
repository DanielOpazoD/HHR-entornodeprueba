/** Recover a MAIN-world generation that survived an MV3 extension reload/update. */
(function (root) {
  'use strict';
  // HHR is absent: it has no persistent MAIN reader or credential authority.
  const SOURCE_TAB_MATCHES = [
    'https://fichamedico.rayensalud.cl/*', 'https://hospitalizado.rayensalud.cl/*',
  ];
  const readMainWorldGeneration = () => {
    const value = globalThis.__hhrExtensionRuntimeGenerationV1__;
    return typeof value === 'string' ? value : '';
  };
  const isGeneration = value => /^[a-f0-9-]{20,}$/i.test(String(value || ''));
  const readTab = async (chromeApi, tab) => {
    if (!Number.isInteger(tab?.id)) return { status: 'unreadable', generation: '' };
    try {
      const results = await chromeApi.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] }, world: 'MAIN', func: readMainWorldGeneration,
      });
      const generation = String(results?.[0]?.result || '');
      return isGeneration(generation)
        ? { status: 'generation', generation } : { status: 'absent', generation: '' };
    } catch (_error) { return { status: 'unreadable', generation: '' }; }
  };
  const consensus = readings => {
    // A discarded tab cannot authorize a lifecycle. Readable MAIN markers may establish the
    // generation; an unreadable tab must prove that same generation when it becomes active.
    const distinct = [...new Set(readings
      .filter(reading => reading.status === 'generation').map(reading => reading.generation))];
    return distinct.length === 1 ? distinct[0] : null;
  };
  const recover = async ({ chromeApi, now }) => {
    if (!chromeApi.tabs?.query || !chromeApi.scripting?.executeScript) return null;
    const tabs = await chromeApi.tabs.query({ url: SOURCE_TAB_MATCHES }).catch(() => []);
    const generation = consensus(await Promise.all(tabs.map(tab => readTab(chromeApi, tab))));
    return generation ? { id: generation, createdAt: now() } : null;
  };
  root.HhrRuntimeGenerationRecovery = Object.freeze({ recover });
})(typeof self !== 'undefined' ? self : globalThis);
