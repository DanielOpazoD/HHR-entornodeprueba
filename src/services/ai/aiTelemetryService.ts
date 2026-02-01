/**
 * AI Telemetry Service
 * 
 * Collects real-time metrics for AI requests, including queue status,
 * successes, failures, and rate limit errors.
 */

export interface AIMetrics {
    queuedRequests: number;
    activeRequests: number;
    totalRequests: number;
    successCount: number;
    rateLimitCount: number; // 429/503 errors (includes retries)
    failedCount: number;    // Final failures
    canceledCount: number;  // Requests superceded or aborted
    lastError?: string;
    lastUpdated: number;
}

type MetricsListener = (metrics: AIMetrics) => void;

class AITelemetryService {
    private static instance: AITelemetryService;
    private listeners: Set<MetricsListener> = new Set();

    private metrics: AIMetrics = {
        queuedRequests: 0,
        activeRequests: 0,
        totalRequests: 0,
        successCount: 0,
        rateLimitCount: 0,
        failedCount: 0,
        canceledCount: 0,
        lastUpdated: Date.now()
    };

    private constructor() { }

    public static getInstance(): AITelemetryService {
        if (!AITelemetryService.instance) {
            AITelemetryService.instance = new AITelemetryService();
        }
        return AITelemetryService.instance;
    }

    public subscribe(listener: MetricsListener): () => void {
        this.listeners.add(listener);
        listener(this.metrics);
        return () => this.listeners.delete(listener);
    }

    public getMetrics(): AIMetrics {
        return { ...this.metrics };
    }

    private notify() {
        this.metrics.lastUpdated = Date.now();
        this.listeners.forEach(l => l(this.metrics));
    }

    public onQueued(_id: string) {
        this.metrics.totalRequests++;
        this.metrics.queuedRequests++;
        this.notify();
    }

    public onProcessingStart() {
        if (this.metrics.queuedRequests > 0) this.metrics.queuedRequests--;
        this.metrics.activeRequests++;
        this.notify();
    }

    public onProcessingEnd() {
        if (this.metrics.activeRequests > 0) this.metrics.activeRequests--;
        this.notify();
    }

    public onSuccess() {
        this.metrics.successCount++;
        this.notify();
    }

    public onRateLimit() {
        this.metrics.rateLimitCount++;
        this.notify();
    }

    public onFailed(error: string) {
        this.metrics.failedCount++;
        this.metrics.lastError = error;
        this.notify();
    }

    public onCanceled() {
        if (this.metrics.queuedRequests > 0) this.metrics.queuedRequests--;
        this.metrics.canceledCount++;
        this.notify();
    }

    public reset() {
        this.metrics = {
            queuedRequests: 0,
            activeRequests: 0,
            totalRequests: 0,
            successCount: 0,
            rateLimitCount: 0,
            failedCount: 0,
            canceledCount: 0,
            lastUpdated: Date.now()
        };
        this.notify();
    }
}

export const aiTelemetryService = AITelemetryService.getInstance();
