import { getRequestOrigin, type NetlifyEventLike } from './http';

/** Complete legacy HTTP response. The wrapper never adds or normalizes headers. */
export interface FunctionResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

type MaybePromise<T> = T | Promise<T>;

/** Preparation can stop with a complete response or pass typed input to run. */
export type FunctionStep<T> =
  | { kind: 'continue'; value: T }
  | { kind: 'reply'; response: FunctionResponse };

export interface FunctionContext {
  event: NetlifyEventLike;
  requestOrigin: string | undefined;

  /**
   * Optional method gate, called explicitly by prepare at the original position.
   * It does not infer allowed methods from the preflight response.
   */
  method(allowed: readonly string[], reject: () => FunctionResponse): FunctionStep<void>;
}

interface OriginPolicy<C> {
  /**
   * Policy is required, including whether absent Origin is accepted.
   * This is deliberately separate from the response's CORS header builder.
   */
  isOriginAllowed: (requestOrigin: string | undefined) => boolean;
  denied: (context: C) => FunctionResponse;
}

interface FunctionHandlerPlan<C extends FunctionContext, P> {
  /**
   * Build per-request context before origin validation. Keep this synchronous:
   * endpoint-specific headers can be computed here without contacting providers.
   * Nothing returned here is merged into responses automatically.
   */
  context: (context: FunctionContext) => C;

  /** Required so an HTTP entry cannot silently omit origin validation. */
  origin: OriginPolicy<C>;

  /**
   * Required full response factory, called only after origin is accepted.
   * Status, headers and body stay endpoint-owned: empty text and JSON preflights
   * are distinct contracts. The wrapper does not add Content-Length or no-store.
   */
  preflight: (context: C) => FunctionResponse;

  /**
   * All remaining gates stay explicit and ordered by the entrypoint.
   * Method, quota, availability, authentication and parsing are not implicit
   * phases. Returning reply bypasses run, preserving that gate's exact response.
   */
  prepare: (context: C) => MaybePromise<FunctionStep<P>>;

  /**
   * Receives only successfully prepared input. Owns fetch, transformation and
   * local error handling, and returns the entire response including binary flags.
   */
  run: (context: C, prepared: P) => MaybePromise<FunctionResponse>;
}

/**
 * Legacy Netlify HTTP boundary: context -> origin -> OPTIONS -> prepare -> run.
 *
 * There is intentionally no universal catch: exception scope and translation
 * belong to each entrypoint. The same applies to retries, deadlines and telemetry.
 * Importing this module does not initialize Firebase or load a provider SDK.
 * Modern Request/Response adapters and scheduled workers remain separate.
 */
export const withFunctionHandler = <C extends FunctionContext, P>(
  plan: FunctionHandlerPlan<C, P>
): ((event: NetlifyEventLike) => Promise<FunctionResponse>) => {
  return async event => {
    const context = plan.context(createFunctionContext(event));

    if (!plan.origin.isOriginAllowed(context.requestOrigin)) {
      return plan.origin.denied(context);
    }

    if (event.httpMethod === 'OPTIONS') {
      return plan.preflight(context);
    }

    const prepared = await plan.prepare(context);
    if (prepared.kind === 'reply') {
      return prepared.response;
    }

    return plan.run(context, prepared.value);
  };
};

const createFunctionContext = (event: NetlifyEventLike): FunctionContext => ({
  event,
  requestOrigin: getRequestOrigin(event),
  method: (allowed, reject) => {
    if (!allowed.includes(event.httpMethod)) {
      return { kind: 'reply', response: reject() };
    }
    return { kind: 'continue', value: undefined };
  },
});
