/** Approved relay scripts and manifest entries for bounded reinjection. */
(function (root) {
  'use strict';
  const RELAYS = Object.freeze({
    'content-hhr.js': Object.freeze({
      ready: 'hhr',
      main: Object.freeze([]),
      isolated: Object.freeze([
        'message-contract.js',
        'bridge-generation.js',
        'health-push-ordering-runtime.js',
        'content-hhr-sync-bundle.js',
        'content-hhr-connection-repair.js',
        'content-hhr.js',
        'content-hhr-patient-flow.js',
        'content-hhr-epicrisis.js',
        'content-hhr-patient-documents.js',
        'content-hhr-statistical-discharge.js',
        'content-hhr-statistical-evidence.js',
        'content-hhr-syslab.js',
      ]),
    }),
    'content-fichamedico.js': Object.freeze({
      ready: 'fichamedico',
      companionFile: 'content-prescription-print.js',
      companionRequires: Object.freeze(['hhr-prescription-ui-lifecycle.js']),
      main: Object.freeze([
        'fichamedico-isolation-normalization.js',
        'fichamedico-treating-physician-dom.js',
        'fichamedico-treating-physician-sources.js',
        'fichamedico-treating-physician-normalization.js',
        'fichamedico-normalization.js',
        'fichamedico-read-resilience.js',
        'bridge-generation-main.js',
        'connection-relay-recovery.js',
        'inject-fichamedico.js',
      ]),
      isolated: Object.freeze([
        'message-contract.js',
        'bridge-generation.js',
        'content-fichamedico.js',
      ]),
    }),
    'content-gestioncamas.js': Object.freeze({
      ready: 'gestioncamas',
      main: Object.freeze([
        'bridge-generation-main.js',
        'connection-relay-recovery.js',
        'inject-gestioncamas.js',
      ]),
      isolated: Object.freeze([
        'message-contract.js',
        'bridge-generation.js',
        'gestion-camas-bridge-health.js',
        'health-push-ordering-runtime.js',
        'hhr-connection-action-model.js',
        'hhr-connection-presentation.js',
        'gestion-camas-connection-indicator.js',
        'gestion-camas-connection-indicator-bootstrap.js',
        'content-gestioncamas.js',
      ]),
    }),
    'syslab-bridge.js': Object.freeze({
      ready: null,
      allFrames: true,
      main: Object.freeze([]),
      isolated: Object.freeze(['lab-result-parser.js', 'lab-viewer.js', 'syslab-bridge.js']),
    }),
  });
  const matchesPattern = (url, pattern) => {
    if (typeof url !== 'string' || typeof pattern !== 'string') return false;
    const escaped = pattern.replace(/[.+?^\${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + escaped + '$').test(url);
  };
  const create = chromeApi => {
    const entries = () => chromeApi.runtime.getManifest().content_scripts || [];
    const entryFor = (requiredFile, world) =>
      entries().find(entry =>
        (world === 'MAIN' ? entry.world === 'MAIN' : entry.world !== 'MAIN') &&
        Array.isArray(entry.js) && entry.js.includes(requiredFile)
      );
    const resolveRelay = requiredFile => {
      const definition = RELAYS[requiredFile];
      const isolatedEntry = entryFor(requiredFile, 'ISOLATED');
      if (!definition || !isolatedEntry) return null;
      if (!definition.isolated.every(file => isolatedEntry.js.includes(file))) return null;
      const mainEntry = definition.main.length ? entryFor(definition.main.at(-1), 'MAIN') : null;
      if (definition.main.length &&
          (!mainEntry || !definition.main.every(file => mainEntry.js.includes(file)))) return null;
      const companionEntry = definition.companionFile ? entryFor(definition.companionFile, 'ISOLATED') : null;
      if (definition.companionFile && (!companionEntry || definition.companionRequires?.some(file => !companionEntry.js.includes(file)))) return null;
      return { definition, isolatedEntry, companionEntry };
    };
    return { requiredFiles: Object.keys(RELAYS), resolveRelay, matchesPattern };
  };
  root.HhrRelayReinjectionManifest = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
