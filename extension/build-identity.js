/** Public content identity, separate from installation/session generation. */
((root) => {
  'use strict';
  const withIdentity = (manifest, context = {}) => {
    const prefix = `${manifest?.version}+hhr1.`;
    const name = manifest?.version_name;
    const id = typeof name === 'string' && name.startsWith(prefix) ? name.slice(prefix.length) : '';
    return { ...context, buildId: /^[a-f0-9]{64}$/.test(id) ? id : undefined };
  };
  root.HhrExtensionBuildIdentity = Object.freeze({ withIdentity });
})(typeof self !== 'undefined' ? self : globalThis);
