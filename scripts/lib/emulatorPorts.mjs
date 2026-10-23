import net from 'node:net';

/**
 * `listen(0)` hands out ephemeral ports (Linux 32768-60999, macOS 49152-65535),
 * which any outgoing connection can take before an emulator binds them. Probe a
 * range below both instead.
 */
export const EMULATOR_PORT_RANGE = { min: 20000, max: 29999 };

/** @param {number} port */
export const isLocalPortFree = port =>
  new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });

/**
 * Picks one distinct free port per emulator name.
 *
 * @param {string[]} names
 * @param {{ isFree?: (port: number) => Promise<boolean>, random?: () => number, attempts?: number }} [options]
 * @returns {Promise<Record<string, number>>}
 */
export const pickEmulatorPorts = async (
  names,
  { isFree = isLocalPortFree, random = Math.random, attempts = 500 } = {}
) => {
  const { min, max } = EMULATOR_PORT_RANGE;
  /** @type {Record<string, number>} */
  const ports = {};
  const taken = new Set();
  for (const name of names) {
    let port = null;
    for (let attempt = 0; attempt < attempts && port === null; attempt += 1) {
      const candidate = min + Math.floor(random() * (max - min + 1));
      if (!taken.has(candidate) && (await isFree(candidate))) port = candidate;
    }
    if (port === null) throw new Error(`No free ${name} emulator port between ${min} and ${max}.`);
    taken.add(port);
    ports[name] = port;
  }
  return ports;
};
