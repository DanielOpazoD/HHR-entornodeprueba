/**
 * zip-store-writer.js (extension — importScripts in the SW, require() in tests)
 *
 * Builds a ZIP archive without compression. The archived files are official PDFs, which are
 * already compressed inside, so storing them keeps the writer small and dependency-free.
 * File names must be ASCII: the Windows built-in extractor ignores the UTF-8 name flag.
 */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  /** MS-DOS date and time of the archive entries, read from the given wall-clock parts. */
  const dosDateTime = ({ year, month, day, hour, minute, second }) => ({
    time: (hour << 11) | (minute << 5) | Math.floor(second / 2),
    date: ((Math.max(year, 1980) - 1980) << 9) | (month << 5) | day,
  });

  const asciiName = name => {
    const value = String(name || '');
    if (!value || !/^[\x20-\x7e]+$/.test(value) || value.length > 240) {
      throw new Error('Nombre de archivo no válido para el ZIP.');
    }
    return Uint8Array.from(value, character => character.charCodeAt(0));
  };

  /**
   * entries: [{ name, data: Uint8Array | ArrayBuffer }]
   * stamp: wall-clock parts in hospital time ({ year, month, day, hour, minute, second }).
   */
  const build = (entries, stamp) => {
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 0xffff) {
      throw new Error('El ZIP necesita entre 1 y 65535 archivos.');
    }
    const { time, date } = dosDateTime(stamp);
    const seen = new Set();
    const prepared = entries.map(entry => {
      const name = asciiName(entry && entry.name);
      const key = String(entry.name).toLowerCase();
      if (seen.has(key)) throw new Error('El ZIP no admite nombres repetidos.');
      seen.add(key);
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
      return { name, data, crc: crc32(data) };
    });

    const localSize = prepared.reduce((sum, entry) => sum + 30 + entry.name.length + entry.data.length, 0);
    const centralSize = prepared.reduce((sum, entry) => sum + 46 + entry.name.length, 0);
    if (localSize + centralSize + 22 > 0xffffffff) throw new Error('El ZIP supera 4 GB.');
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let offset = 0;
    const offsets = [];

    prepared.forEach(entry => {
      offsets.push(offset);
      view.setUint32(offset, 0x04034b50, true);
      view.setUint16(offset + 4, 20, true); // version needed: 2.0
      view.setUint16(offset + 6, 0, true); // flags
      view.setUint16(offset + 8, 0, true); // method: stored
      view.setUint16(offset + 10, time, true);
      view.setUint16(offset + 12, date, true);
      view.setUint32(offset + 14, entry.crc, true);
      view.setUint32(offset + 18, entry.data.length, true);
      view.setUint32(offset + 22, entry.data.length, true);
      view.setUint16(offset + 26, entry.name.length, true);
      view.setUint16(offset + 28, 0, true);
      out.set(entry.name, offset + 30);
      out.set(entry.data, offset + 30 + entry.name.length);
      offset += 30 + entry.name.length + entry.data.length;
    });

    const centralStart = offset;
    prepared.forEach((entry, index) => {
      view.setUint32(offset, 0x02014b50, true);
      view.setUint16(offset + 4, 20, true); // made by
      view.setUint16(offset + 6, 20, true); // version needed
      view.setUint16(offset + 8, 0, true);
      view.setUint16(offset + 10, 0, true);
      view.setUint16(offset + 12, time, true);
      view.setUint16(offset + 14, date, true);
      view.setUint32(offset + 16, entry.crc, true);
      view.setUint32(offset + 20, entry.data.length, true);
      view.setUint32(offset + 24, entry.data.length, true);
      view.setUint16(offset + 28, entry.name.length, true);
      view.setUint16(offset + 30, 0, true); // extra
      view.setUint16(offset + 32, 0, true); // comment
      view.setUint16(offset + 34, 0, true); // disk
      view.setUint16(offset + 36, 0, true); // internal attributes
      view.setUint32(offset + 38, 0, true); // external attributes
      view.setUint32(offset + 42, offsets[index], true);
      out.set(entry.name, offset + 46);
      offset += 46 + entry.name.length;
    });

    view.setUint32(offset, 0x06054b50, true);
    view.setUint16(offset + 8, prepared.length, true);
    view.setUint16(offset + 10, prepared.length, true);
    view.setUint32(offset + 12, offset - centralStart, true);
    view.setUint32(offset + 16, centralStart, true);
    return out;
  };

  const api = Object.freeze({ build, crc32 });
  root.HhrZipStoreWriter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
