import { describe, it, expect } from 'vitest';
import { normalizeSourceExpiry } from '@/features/rayen-import/bridge/sourceHealthExpiry';
import type { RayenSourceHealth } from '@/features/rayen-import/bridge/extensionHealthBridge';
const ready: RayenSourceHealth = {
  status: 'ready',
  message: 'Sesión vigente',
  reason: 'connected',
};
describe('source health expiry', () => {
  it('la expiración absoluta prevalece sobre un verde y contador contradictorios', () => {
    const source = normalizeSourceExpiry(
      { ...ready, expiresAt: 1000, remainingSeconds: 600 },
      'Ficha Médico',
      1000,
      900
    );
    expect(source.status).toBe('stale');
    expect(source.reason).toBe('session_expired');
    expect(source.message).toContain('venció');
  });
  it('descuenta el tiempo transcurrido de reportes sin fecha absoluta', () => {
    expect(
      normalizeSourceExpiry({ ...ready, remainingSeconds: 1 }, 'Ficha Médico', 2000, 1000).status
    ).toBe('stale');
  });
  it('normalizar repetidamente no descuenta dos veces el tiempo', () => {
    const once = normalizeSourceExpiry(
      { ...ready, remainingSeconds: 60 },
      'Ficha Médico',
      2000,
      1000
    );
    expect(normalizeSourceExpiry(once, 'Ficha Médico', 2000, 1000)).toEqual(once);
  });
  it('no inventa caducidad y no revive una fuente sin conexión', () => {
    expect(normalizeSourceExpiry(ready, 'Ficha Médico', 2000, 1000)).toEqual(ready);
    expect(
      normalizeSourceExpiry(
        { ...ready, status: 'stale', expiresAt: 10000 },
        'Ficha Médico',
        2000,
        1000
      ).status
    ).toBe('stale');
  });
});
