/** Coalesce episode reads only within one capture, so later captures always read current data. */
(function (root) {
  'use strict';

  const create = () => {
    const reads = new Map();
    return (key, reader) => {
      if (!reads.has(key)) reads.set(key, Promise.resolve().then(reader));
      return reads.get(key);
    };
  };

  root.HhrFichaMedicoCaptureCache = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
