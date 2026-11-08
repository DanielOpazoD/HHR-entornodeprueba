import { vi } from 'vitest';
import { normalizeRut } from '@/utils/rutUtils';
import '../../../extension/hhr-origin-policy.js';
import '../../../extension/urgency-api.js';
import '../../../extension/urgency-auth-model.js';
import '../../../extension/urgency-auth-state.js';
import '../../../extension/urgency-dau-api.js';
import '../../../extension/urgency-auth-runtime.js';

export type Sender = { id?: string; url: string; tab: { id: number; url?: string } };
export type NativeSession = {
  id: string;
  token: string;
  facilityId: string;
  staffId: string;
  assertCurrent: () => Promise<void>;
};
type Api = { read: (...args: unknown[]) => Promise<unknown> };
type Message = {
  operation: string;
  flowId: string;
  username?: string;
  password?: string;
  domain?: string;
  otp?: string;
  choiceId?: string;
};
type Reply = {
  ok: boolean;
  state?: string;
  error?: string;
  choices?: Array<{ id: string; label: string }>;
};
type Auth = {
  begin: (sender: Sender) => Promise<{ ok: false; auth: { flowId: string; url: string } }>;
  handle: (message: Message, sender: Sender) => Promise<Reply>;
  sessionFor: (sender: Sender) => Promise<NativeSession | null>;
  revoke: (sender: Sender) => Promise<void>;
  remove: (id: string) => Promise<void>;
};
declare global {
  var HhrUrgencyApi: { create: (deps: { fetchImpl: typeof fetch }) => Api };
  var HhrUrgencyAuth: {
    create: (deps: {
      chrome: ReturnType<typeof memoryChrome>['chrome'];
      api: Api;
      getAuthorizationKey: () => Promise<string>;
      now: () => number;
    }) => Auth;
  };
  var HhrUrgencyDauApi: {
    create: (deps: { api: Api; normalizeRun: (value: unknown) => string }) => {
      read: (selection: {
        patientRun: string;
        attentionId: string;
        session: NativeSession;
        assertCurrent: () => Promise<void>;
      }) => Promise<Uint8Array>;
    };
  };
}
export const extensionId = 'a'.repeat(32);
export const hhrSender: Sender = {
  id: extensionId,
  url: 'http://localhost:3001/census',
  tab: { id: 5 },
};
export const selection = { patientRun: '111111111', attentionId: '8' };
const memoryChrome = () => {
  const values: Record<string, unknown> = {};
  const chrome = {
    runtime: { id: extensionId, getURL: (p: string) => `chrome-extension://${extensionId}/${p}` },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(values, structuredClone(patch));
        }),
        remove: vi.fn(async (key: string) => {
          delete values[key];
        }),
      },
    },
  };
  return { chrome, values };
};
const profile = () => ({
  Id: 3,
  Permissions: ['read'],
  StaffMember: { Id: 6, IdHealthCareCenter: 9 },
});
const user = () => ({
  Profile: profile(),
  HealthCareCenter: 'Hospital sintético',
  HealthPractitionerTypes: [{ Id: 2, Name: 'Médico' }],
});
export const harness = () => {
  const memory = memoryChrome();
  const clock = { now: 1000, owner: 'tab:synthetic-session' };
  const config = {
    mfa: false,
    enrollment: false,
    invalidLogin: false,
    otpValid: true,
    invalidPdf: false,
    duplicate: false,
    multipleRoles: false,
    wrongTicketStaff: false,
    authorizationUnavailable: false,
  };
  const hooks: { onLogin?: () => Promise<void>; onPdf?: () => Promise<void> } = {};
  const admission = {
    Id: 7,
    IdFacility: 9,
    Patient: { Id: 42, Rut: '11.111.111-1' },
    PatientCare: { Id: 8 },
  };
  const care = {
    Id: 8,
    IdPatient: 42,
    IdEmergencyAdmission: 7,
    IdHealthCareCenter: 9,
    IsEmergency: true,
  };
  const fetchImpl = vi.fn<typeof fetch>(async (input, options) => {
    const url = new URL(String(input));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname === '/api/usuario/login') {
      await hooks.onLogin?.();
      return json(
        config.invalidLogin
          ? { Message: 'synthetic-private-error' }
          : {
              ContextId: 'native-context-fixture',
              StatusMFA: config.mfa ? 99999 : 200,
              RequiereActivacionMFA: config.enrollment,
              Usuarios: [
                {
                  ...user(),
                  HealthPractitionerTypes: config.multipleRoles
                    ? [
                        { Id: 2, Name: 'Médico' },
                        { Id: 4, Name: 'Otro rol sintético' },
                      ]
                    : user().HealthPractitionerTypes,
                },
              ],
            }
      );
    }
    if (url.pathname === '/api/emergencyAccess/Validate')
      return json([{ Valido: config.otpValid, Usuarios: [user()] }]);
    if (url.pathname === '/api/tokenAcceso/') {
      const body: unknown = JSON.parse(String(options?.body));
      if (
        !body ||
        typeof body !== 'object' ||
        !('contextId' in body) ||
        body.contextId !== 'native-context-fixture'
      )
        throw new Error('Synthetic exchange received a non-native context');
      const ticketProfile = profile();
      if (config.wrongTicketStaff) ticketProfile.StaffMember.Id = 99;
      return json({ EncodedToken: 'fake', Profile: ticketProfile });
    }
    if (url.pathname === '/api/emergencyAdmissionsByPatient/')
      return json(config.duplicate ? [admission, admission] : [admission]);
    if (url.pathname.includes('/encounters/')) return json(care);
    if (url.pathname === '/api/reportes/DAU_C.pdf') {
      await hooks.onPdf?.();
      return new Response(
        config.invalidPdf ? '<html>Login</html>' : '%PDF-1.7 synthetic official report',
        {
          headers: { 'content-type': config.invalidPdf ? 'text/html' : 'application/pdf' },
        }
      );
    }
    throw new Error(`Unexpected synthetic endpoint: ${url.pathname}`);
  });
  const api = HhrUrgencyApi.create({ fetchImpl });
  const dependencies = {
    chrome: memory.chrome,
    api,
    getAuthorizationKey: async () => {
      if (config.authorizationUnavailable)
        throw new Error('Synthetic clinical authorization expired');
      return clock.owner;
    },
    now: () => clock.now,
  };
  const auth = HhrUrgencyAuth.create(dependencies);
  const pdf = HhrUrgencyDauApi.create({
    api,
    normalizeRun: value => normalizeRut(typeof value === 'string' ? value : ''),
  });
  const begin = async () => {
    const { auth: flow } = await auth.begin(hhrSender);
    const sender = { id: extensionId, tab: { id: 5 }, url: flow.url };
    const login = () =>
      auth.handle(
        {
          operation: 'login',
          flowId: flow.flowId,
          username: 'synthetic.user',
          password: 'example',
          domain: 'synthetic',
        },
        sender
      );
    return { flow, sender, login };
  };
  const readPdf = async () => {
    const session = await auth.sessionFor(hhrSender);
    if (!session) throw new Error('Synthetic session was not authenticated');
    return pdf.read({ ...selection, session, assertCurrent: session.assertCurrent });
  };
  return {
    ...memory,
    clock,
    config,
    hooks,
    admission,
    care,
    fetchImpl,
    dependencies,
    auth,
    begin,
    readPdf,
  };
};
