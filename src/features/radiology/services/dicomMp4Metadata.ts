const CONTAINERS = new Set(['moov', 'trak', 'mdia']);
/** Each starts with version/flags, then creation and modification time (ISO/IEC 14496-12). */
const TIMED = new Set(['mvhd', 'tkhd', 'mdhd']);

/** Mediabunny 1.61.6 stamps the encoding time in these headers and has no option to omit it
 * (1.65 adds one). Zero means "unknown" and leaves no date of the study or export in the file.
 * Fails closed: an unexpected layout never yields a file that might still carry the date. */
export const clearMp4CreationTimes = (buffer: ArrayBuffer): ArrayBuffer => {
  const view = new DataView(buffer);
  const cleared = new Set<string>();
  const walk = (start: number, end: number) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) throw new Error('No se pudo preparar el MP4.');
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) size = end - offset;
      if (size < header || offset + size > end) throw new Error('No se pudo preparar el MP4.');
      const type = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );
      if (CONTAINERS.has(type)) walk(offset + header, offset + size);
      else if (TIMED.has(type)) {
        const fields = offset + header + 4;
        const width = view.getUint8(offset + header) === 1 ? 8 : 4;
        if (fields + width * 2 > offset + size) throw new Error('No se pudo preparar el MP4.');
        new Uint8Array(buffer, fields, width * 2).fill(0);
        cleared.add(type);
      }
      offset += size;
    }
  };
  walk(0, buffer.byteLength);
  if (!cleared.has('mvhd')) throw new Error('No se pudo preparar el MP4.');
  return buffer;
};
