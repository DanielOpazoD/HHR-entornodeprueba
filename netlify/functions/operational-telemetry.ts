/** Same-origin beacon receiver. No clinical reads or anonymous datastore access. */
import {
  parseOperationalTelemetryBody,
  shouldAlertOperationalTelemetry,
} from '../../src/services/observability/operationalTelemetryIngestPolicy';
import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';
import type { AlertQueue } from './lib/telemetry-alerts/queueTypes';
import { createRuntimeAlertQueue, logAlertDelivery } from './lib/telemetry-alerts/runtime';
import type { TelemetryRuntimeContext } from './lib/telemetry-alerts/store';

const RATE_LIMIT = { maxPerWindow: 60, windowMs: 60_000 };
export interface OperationalTelemetryHandlerDeps {
  queue: () => AlertQueue;
  now: () => number;
  log: (line: string) => void;
}
export const createOperationalTelemetryHandler =
  (deps: OperationalTelemetryHandlerDeps) => async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const response = (status: number, payload: unknown) =>
      buildJsonResponse(status, payload, {
        requestOrigin,
        headers: { 'Cache-Control': 'no-store' },
      });
    if (!isOriginAllowed(requestOrigin)) return response(403, { error: 'Origin not allowed' });
    if (event.httpMethod === 'OPTIONS')
      return {
        statusCode: 200,
        headers: buildCorsHeaders(requestOrigin, {
          allowedHeaders: 'Content-Type',
          allowedMethods: 'POST,OPTIONS',
        }),
        body: '',
      };
    if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
    if (isRateLimited(getClientIp(event), RATE_LIMIT))
      return buildTooManyRequestsResponse(requestOrigin);
    const parsed = parseOperationalTelemetryBody(event.body);
    if (!parsed.ok)
      return response(parsed.reason === 'too_large' ? 413 : 400, { error: parsed.reason });
    let delivery: { alert: string; id?: string } = { alert: 'not_alertable' };
    try {
      if (shouldAlertOperationalTelemetry(parsed.event)) {
        const queue = deps.queue();
        delivery = await queue.enqueue(parsed.event);
        if (delivery.alert === 'queue_full')
          return response(503, { accepted: false, error: 'alert_queue_full' });
        if (delivery.alert === 'queued' && delivery.id) delivery = await queue.deliver(delivery.id);
      }
    } catch {
      // A missing receipt is not success. Never fall back to an uncoordinated Gmail send.
      deps.log(
        JSON.stringify({
          source: 'operational-telemetry',
          kind: 'delivery_unavailable',
          code: 'alert_store_unavailable',
        })
      );
      return response(503, { accepted: false, error: 'alert_store_unavailable' });
    }
    deps.log(
      JSON.stringify({
        source: 'operational-telemetry',
        kind: 'event',
        receivedAt: new Date(deps.now()).toISOString(),
        ...delivery,
        event: parsed.event,
      })
    );
    return response(202, { accepted: true, ...delivery });
  };

/** Modern runtime supplies private Blobs credentials and trustworthy deploy metadata. */
export default async (request: Request, context: TelemetryRuntimeContext): Promise<Response> => {
  // Cap the streamed body before parsing; never read an arbitrarily large beacon into memory.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8 * 1024) {
        await reader.cancel();
        return Response.json(
          { error: 'too_large' },
          { status: 413, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      chunks.push(value);
    }
  }
  const handler = createOperationalTelemetryHandler({
    queue: () => createRuntimeAlertQueue(context),
    now: Date.now,
    log: logAlertDelivery,
  });
  const result = await handler({
    httpMethod: request.method,
    headers: { ...Object.fromEntries(request.headers), 'x-nf-client-connection-ip': context.ip },
    body: Buffer.concat(chunks).toString('utf8'),
  });
  return new Response(result.body, { status: result.statusCode, headers: result.headers });
};
