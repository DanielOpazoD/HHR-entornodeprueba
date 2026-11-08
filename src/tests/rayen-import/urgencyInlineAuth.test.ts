// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { extensionId, harness, hhrSender } from './urgencyInlineAuth.fixture';

describe('extension-owned inline urgency login', () => {
  it('issues a native session using only the ContextId returned by password authentication', async () => {
    const h = harness(),
      step = await h.begin();
    expect(await step.login()).toMatchObject({ ok: true, state: 'authenticated' });
    const paths = h.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths).toEqual(['/api/usuario/login', '/api/tokenAcceso/']);
    expect(JSON.parse(String(h.fetchImpl.mock.calls[0][1]?.body))).toEqual({
      Username: 'synthetic.user',
      Password: 'example',
      IdFacility: 0,
      Domain: 'synthetic',
      TimeStampOtp: null,
    });
    expect(JSON.parse(String(h.fetchImpl.mock.calls[1][1]?.body))).toEqual({
      idPT: 2,
      contextId: 'native-context-fixture',
    });
    expect(await h.auth.sessionFor(hhrSender)).toMatchObject({ facilityId: '9', staffId: '6' });
    expect(JSON.stringify(h.values)).not.toContain('example');
    expect(JSON.stringify(h.values)).not.toContain('native-context-fixture');
  });

  it('survives a worker restart without persisting a password', async () => {
    const h = harness(),
      step = await h.begin();
    await step.login();
    const restarted = HhrUrgencyAuth.create(h.dependencies);
    expect(await restarted.sessionFor(hhrSender)).toMatchObject({
      token: 'fake',
    });
    h.clock.now += 3600001;
    expect(await restarted.sessionFor(hhrSender)).toBeNull();
    expect(JSON.stringify(h.values)).not.toContain('synthetic-native-ticket');
  });

  it('keeps server login diagnostics private and permits a credential retry', async () => {
    const h = harness(),
      step = await h.begin();
    h.config.invalidLogin = true;
    const result = await step.login();
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-error');
    h.config.invalidLogin = false;
    expect(await step.login()).toMatchObject({ ok: true, state: 'authenticated' });
  });

  it('requires the OTP before issuing a native ticket and permits a code retry', async () => {
    const h = harness(),
      step = await h.begin();
    h.config.mfa = true;
    expect(await step.login()).toMatchObject({ ok: true, state: 'otp' });
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
    h.config.otpValid = false;
    expect(
      await h.auth.handle(
        { operation: 'otp', flowId: step.flow.flowId, otp: '123456' },
        step.sender
      )
    ).toMatchObject({ ok: false });
    expect(h.fetchImpl.mock.calls.some(([url]) => String(url).includes('/tokenAcceso/'))).toBe(
      false
    );
    h.config.otpValid = true;
    expect(
      await h.auth.handle(
        { operation: 'otp', flowId: step.flow.flowId, otp: '654321' },
        step.sender
      )
    ).toMatchObject({ state: 'authenticated' });
    expect(JSON.stringify(h.values)).not.toContain('654321');
  });

  it('does not postpone or bypass required MFA enrollment', async () => {
    const h = harness(),
      step = await h.begin();
    h.config.enrollment = true;
    expect(await step.login()).toMatchObject({
      ok: false,
      error: expect.stringContaining('configurar'),
    });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
  });

  it('requires the explicit native role when more than one is available', async () => {
    const h = harness(),
      step = await h.begin();
    h.config.multipleRoles = true;
    const result = await step.login();
    expect(result).toMatchObject({ state: 'profiles', choices: [{ id: '0:0' }, { id: '0:1' }] });
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
    expect(
      await h.auth.handle(
        { operation: 'choose', flowId: step.flow.flowId, choiceId: '0:1' },
        step.sender
      )
    ).toMatchObject({ state: 'authenticated' });
    expect(JSON.parse(String(h.fetchImpl.mock.calls.at(-1)?.[1]?.body))).toEqual({
      idPT: 4,
      contextId: 'native-context-fixture',
    });
  });

  it('rejects a native ticket belonging to a different staff member', async () => {
    const h = harness(),
      step = await h.begin();
    h.config.wrongTicketStaff = true;
    expect(await step.login()).toMatchObject({ ok: false });
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
    expect(JSON.stringify(h.values)).not.toContain('fake');
  });

  it.each(['hhr-page', 'another-tab', 'another-extension', 'wrong-flow'])(
    'rejects credentials from %s before any network transmission',
    async kind => {
      const h = harness(),
        step = await h.begin();
      const sender = kind === 'hhr-page' ? hhrSender : { ...step.sender };
      if (kind === 'another-tab') sender.tab = { id: 99 };
      if (kind === 'another-extension') sender.id = 'b'.repeat(32);
      const flowId = kind === 'wrong-flow' ? 'b'.repeat(36) : step.flow.flowId;
      expect(
        await h.auth.handle(
          {
            operation: 'login',
            flowId,
            username: 'synthetic.user',
            password: 'example',
            domain: 'synthetic',
          },
          sender
        )
      ).toMatchObject({ ok: false });
      expect(h.fetchImpl).not.toHaveBeenCalled();
      expect(JSON.stringify(h.values)).not.toContain('example');
    }
  );

  it('expires the pending context and binds the authenticated session to its HHR tab', async () => {
    const h = harness(),
      step = await h.begin();
    h.clock.now += 300001;
    expect(await step.login()).toMatchObject({ ok: false });
    expect(h.fetchImpl).not.toHaveBeenCalled();
    const second = await h.begin();
    await second.login();
    expect(await h.auth.sessionFor({ ...hhrSender, tab: { id: 99 } })).toBeNull();
    expect(extensionId).toHaveLength(32);
  });

  it('drops the native session when the clinical owner changes', async () => {
    const h = harness(),
      step = await h.begin();
    await step.login();
    h.clock.owner = 'new-clinical-owner';
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
    expect(JSON.stringify(h.values)).not.toContain('fake');
  });

  it('removes the native ticket if the clinical authorization becomes unavailable', async () => {
    const h = harness(),
      step = await h.begin();
    await step.login();
    h.config.authorizationUnavailable = true;
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
    expect(JSON.stringify(h.values)).not.toContain('fake');
  });

  it('does not exchange a context if the clinical session changes during login', async () => {
    const h = harness(),
      step = await h.begin();
    h.hooks.onLogin = async () => {
      h.clock.owner = 'new-clinical-owner';
    };
    expect(await step.login()).toMatchObject({ ok: false });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
  });

  it('cancels an in-flight login without resurrecting its deleted context', async () => {
    const h = harness(),
      step = await h.begin();
    let release: () => void = () => {};
    h.hooks.onLogin = () =>
      new Promise<void>(resolve => {
        release = resolve;
      });
    const pending = step.login();
    await vi.waitFor(() => expect(h.fetchImpl).toHaveBeenCalled());
    expect(
      await h.auth.handle({ operation: 'cancel', flowId: step.flow.flowId }, step.sender)
    ).toMatchObject({ state: 'cancelled' });
    release();
    expect(await pending).toMatchObject({ ok: false });
    expect(await h.auth.sessionFor(hhrSender)).toBeNull();
    expect(JSON.stringify(h.values)).not.toContain('native-context-fixture');
  });
});
