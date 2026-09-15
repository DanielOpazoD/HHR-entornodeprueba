/** Persistent publisher order and receiver-side rejection for extension health pushes. */
(function (root) {
  'use strict';

  const STORAGE_KEY = 'hhrHealthPublicationSequenceV1';
  const createReceiver = () => {
    let lastAcceptedSequence = 0;
    const accept = message => {
      const sequence = message && message.publicationSequence;
      if (!Number.isSafeInteger(sequence) || sequence <= lastAcceptedSequence) return false;
      lastAcceptedSequence = sequence;
      return true;
    };
    return Object.freeze({ accept });
  };

  const createAllocator = storageArea => {
    let fallbackSequence = 0;
    let tail = Promise.resolve();
    const allocate = async () => {
      if (!storageArea) return ++fallbackSequence;
      const stored = await storageArea.get(STORAGE_KEY);
      const previous = Number(stored && stored[STORAGE_KEY]);
      const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1;
      await storageArea.set({ [STORAGE_KEY]: next });
      return next;
    };
    return () => {
      const next = tail.then(allocate, allocate);
      tail = next.then(() => undefined, () => undefined);
      return next;
    };
  };

  root.HhrHealthPushOrderingRuntime = Object.freeze({ createAllocator, createReceiver, STORAGE_KEY });
})(typeof self !== 'undefined' ? self : globalThis);
