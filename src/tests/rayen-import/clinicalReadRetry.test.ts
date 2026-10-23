import { describe, expect, it, vi } from 'vitest';
import { retryClinicalReadOnce } from '@/features/rayen-import/domain/clinicalReadRetry';

describe('retryClinicalReadOnce', () => {
  it('does not retry cancellation', async () => {
    const read = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const onRetry = vi.fn();
    await expect(retryClinicalReadOnce(read, () => false, onRetry)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it.each(['permission_denied', 'invalid_request', 'future_unknown_code'])(
    'does not retry explicit permanent code %s',
    async errorCode => {
      const failure = { forms: [], error: 'timeout text must not override code', errorCode };
      const read = vi.fn().mockResolvedValue(failure);
      expect(await retryClinicalReadOnce(read, () => true, vi.fn())).toBe(failure);
      expect(read).toHaveBeenCalledTimes(1);
    }
  );

  it('does not use a late success after cancellation during recovery', async () => {
    const controller = new AbortController();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('port closed'))
      .mockImplementationOnce(async () => {
        controller.abort(new DOMException('Cancelled', 'AbortError'));
        return { forms: [1] };
      });
    await expect(
      retryClinicalReadOnce(read, () => false, vi.fn(), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledTimes(2);
  });

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

  it.each([false, true])('preserves the permanent recovery refusal, thrown=%s', async thrown => {
    const refusal = { error: 'Permission refused', errorCode: 'permission_denied' };
    const read = vi.fn().mockResolvedValueOnce({ error: 'timeout', errorCode: 'source_timeout' });
    if (thrown) read.mockRejectedValueOnce(refusal);
    else read.mockResolvedValueOnce(refusal);
    const result = retryClinicalReadOnce(read, () => true, vi.fn());
    if (thrown) await expect(result).rejects.toBe(refusal);
    else await expect(result).resolves.toBe(refusal);
    expect(read).toHaveBeenCalledTimes(2);
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
