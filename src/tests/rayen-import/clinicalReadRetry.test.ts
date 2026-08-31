import { describe, expect, it, vi } from 'vitest';
import { retryClinicalReadOnce } from '@/features/rayen-import/domain/clinicalReadRetry';

describe('retryClinicalReadOnce', () => {
  it('no reintenta una lectura exitosa', async () => {
    const read = vi.fn().mockResolvedValue({ forms: [1] });
    const onRetry = vi.fn();

    const result = await retryClinicalReadOnce(
      read,
      r => Boolean((r as { error?: string }).error),
      onRetry
    );

    expect(result).toEqual({ forms: [1] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('reintenta UNA vez tras un rechazo y devuelve el segundo resultado', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ ok: true });
    const onRetry = vi.fn();

    const result = await retryClinicalReadOnce(read, () => false, onRetry);

    expect(result).toEqual({ ok: true });
    expect(read).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('propaga el error cuando el reintento tras un rechazo también revienta', async () => {
    const read = vi.fn().mockRejectedValue(new Error('sin pestaña de Rayen'));

    await expect(retryClinicalReadOnce(read, () => false, vi.fn())).rejects.toThrow(
      'sin pestaña de Rayen'
    );
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('con error de valor, reintenta y conserva el original si el reintento también falla', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ forms: [], error: 'timeout original' })
      .mockRejectedValueOnce(new Error('reintento reventado'));
    const onRetry = vi.fn();

    const result = await retryClinicalReadOnce(
      read,
      r => Boolean((r as { error?: string }).error),
      onRetry
    );

    expect(result).toEqual({ forms: [], error: 'timeout original' });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('con error de valor, el reintento exitoso reemplaza al primero', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ forms: [], error: 'timeout' })
      .mockResolvedValueOnce({ forms: [1, 2] });

    const result = await retryClinicalReadOnce(
      read,
      r => Boolean((r as { error?: string }).error),
      vi.fn()
    );

    expect(result).toEqual({ forms: [1, 2] });
  });
});
