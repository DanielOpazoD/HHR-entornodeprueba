export const cudyrDocumentKey = (v: string) => v.replace(/[.\s-]/g, '').toUpperCase();
export const cudyrNameKey = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
/** Same complete name tokens, irrespective of source ordering; never fuzzy/partial matching. */
export const cudyrFullNameKey = (name: string) =>
  cudyrNameKey(name)
    .split(/[^A-Z0-9Ñ]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
export const cudyrIdentity = (document: string, name: string) =>
  JSON.stringify([cudyrDocumentKey(document), cudyrFullNameKey(name)]);
