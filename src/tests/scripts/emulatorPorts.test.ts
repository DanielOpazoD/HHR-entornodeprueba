// @vitest-environment node
import net from 'node:net';
import { describe, expect, it } from 'vitest';

import {
  EMULATOR_PORT_RANGE,
  isLocalPortFree,
  pickEmulatorPorts,
} from '../../../scripts/lib/emulatorPorts.mjs';

/** Deterministic `Math.random` replacement that maps each value to a port offset. */
const offsets = (...values: number[]) => {
  const span = EMULATOR_PORT_RANGE.max - EMULATOR_PORT_RANGE.min + 1;
  let index = 0;
  return () => (values[index++ % values.length] + 0.5) / span;
};

describe('emulator port selection', () => {
  it('keeps every emulator on a distinct port below the ephemeral ranges', async () => {
    const ports = await pickEmulatorPorts(['auth', 'firestore', 'storage'], {
      isFree: async () => true,
      random: offsets(7, 7, 7, 9, 7, 9, 11),
    });

    expect(ports).toEqual({
      auth: EMULATOR_PORT_RANGE.min + 7,
      firestore: EMULATOR_PORT_RANGE.min + 9,
      storage: EMULATOR_PORT_RANGE.min + 11,
    });
    expect(EMULATOR_PORT_RANGE.max).toBeLessThan(32768);
  });

  it('skips ports another process already holds', async () => {
    const busy = EMULATOR_PORT_RANGE.min + 3;
    const ports = await pickEmulatorPorts(['storage'], {
      isFree: async port => port !== busy,
      random: offsets(3, 4),
    });
    expect(ports.storage).toBe(EMULATOR_PORT_RANGE.min + 4);
  });

  it('fails clearly when no free port is found', async () => {
    await expect(
      pickEmulatorPorts(['storage'], { isFree: async () => false, attempts: 3 })
    ).rejects.toThrow('No free storage emulator port between 20000 and 29999.');
  });

  it('detects a port held by a listening server', async () => {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      expect(await isLocalPortFree(port)).toBe(false);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
    expect(await isLocalPortFree(port)).toBe(true);
  });
});
