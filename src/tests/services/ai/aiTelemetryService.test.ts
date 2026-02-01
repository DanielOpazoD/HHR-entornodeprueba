import { describe, it, expect, beforeEach } from 'vitest';
import { aiTelemetryService } from '@/services/ai/aiTelemetryService';

describe('AITelemetryService', () => {
    beforeEach(() => {
        aiTelemetryService.reset();
    });

    it('should track queued and canceled requests', () => {
        aiTelemetryService.onQueued('test-1');
        aiTelemetryService.onQueued('test-2');

        let metrics = aiTelemetryService.getMetrics();
        expect(metrics.totalRequests).toBe(2);
        expect(metrics.queuedRequests).toBe(2);

        aiTelemetryService.onCanceled();
        metrics = aiTelemetryService.getMetrics();
        expect(metrics.queuedRequests).toBe(1);
        expect(metrics.canceledCount).toBe(1);
    });

    it('should track processing lifecycle', () => {
        aiTelemetryService.onQueued('test-1');
        aiTelemetryService.onProcessingStart();

        let metrics = aiTelemetryService.getMetrics();
        expect(metrics.queuedRequests).toBe(0);
        expect(metrics.activeRequests).toBe(1);

        aiTelemetryService.onSuccess();
        aiTelemetryService.onProcessingEnd();

        metrics = aiTelemetryService.getMetrics();
        expect(metrics.activeRequests).toBe(0);
        expect(metrics.successCount).toBe(1);
    });

    it('should track rate limits and failures', () => {
        aiTelemetryService.onQueued('test-1');
        aiTelemetryService.onProcessingStart();

        aiTelemetryService.onRateLimit();
        aiTelemetryService.onRateLimit();

        let metrics = aiTelemetryService.getMetrics();
        expect(metrics.rateLimitCount).toBe(2);

        aiTelemetryService.onFailed('Critical Error');
        aiTelemetryService.onProcessingEnd();

        metrics = aiTelemetryService.getMetrics();
        expect(metrics.failedCount).toBe(1);
        expect(metrics.lastError).toBe('Critical Error');
    });

    it('should support multiple listeners', () => {
        let callCount = 0;
        const unsubscribe = aiTelemetryService.subscribe(() => {
            callCount++;
        });

        // Initial call + 1 update
        aiTelemetryService.onQueued('test-1');
        expect(callCount).toBe(2);

        unsubscribe();
        aiTelemetryService.onQueued('test-2');
        expect(callCount).toBe(2);
    });
});
