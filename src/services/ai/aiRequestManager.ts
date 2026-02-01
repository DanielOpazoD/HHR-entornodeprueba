/**
 * AI Request Manager - Stability Layer for Gemini API
 * 
 * Logic implemented:
 * 1. Concurrency Control: Max 1 active request to prevent 429 errors.
 * 2. Throttling: Minimum delay between consecutive requests.
 * 3. Exponential Backoff: Retries on rate limit errors (429/503).
 * 4. Request Deduplication: Don't process the same query multiple times if it's already in queue.
 */

import { aiTelemetryService } from './aiTelemetryService';

type AIRecipe<T> = (signal?: AbortSignal) => Promise<T>;

interface InternalTask {
    id: string;
    execute: () => Promise<void>;
    cancel: (reason: Error) => void;
    signal?: AbortSignal;
}

class AIRequestManager {
    private static instance: AIRequestManager;
    private queue: InternalTask[] = [];
    private isProcessing = false;
    private lastRequestTime = 0;

    private readonly MIN_INTERVAL_MS = 1500;
    private readonly MAX_RETRIES = 3;
    private readonly BACKOFF_BASE_MS = 2000;

    private constructor() { }

    public static getInstance(): AIRequestManager {
        if (!AIRequestManager.instance) {
            AIRequestManager.instance = new AIRequestManager();
        }
        return AIRequestManager.instance;
    }

    /**
     * Enqueue a new AI request
     */
    public async enqueue<T>(id: string, recipe: AIRecipe<T>, signal?: AbortSignal): Promise<T> {
        // Deduplication
        this.queue = this.queue.filter(task => {
            if (task.id === id) {
                task.cancel(new Error('Superceded by newer request'));
                aiTelemetryService.onCanceled();
                return false;
            }
            return true;
        });

        aiTelemetryService.onQueued(id);

        return new Promise<T>((resolve, reject) => {
            const task: InternalTask = {
                id,
                signal,
                execute: async () => {
                    try {
                        const result = await this.executeWithRetries(recipe, signal);
                        aiTelemetryService.onSuccess();
                        resolve(result);
                    } catch (error) {
                        aiTelemetryService.onFailed(error instanceof Error ? error.message : String(error));
                        reject(error);
                    }
                },
                cancel: (reason) => reject(reason)
            };

            this.queue.push(task);
            this.processQueue().catch(err => console.error('AI Manager Error:', err));
        });
    }

    private async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;

        const task = this.queue.shift();
        if (!task) {
            this.isProcessing = false;
            return;
        }

        if (task.signal?.aborted) {
            task.cancel(new DOMException('Aborted', 'AbortError'));
            aiTelemetryService.onCanceled();
            this.isProcessing = false;
            this.processQueue();
            return;
        }

        aiTelemetryService.onProcessingStart();

        try {
            const now = Date.now();
            const elapsed = now - this.lastRequestTime;
            if (elapsed < this.MIN_INTERVAL_MS) {
                await new Promise(r => setTimeout(r, this.MIN_INTERVAL_MS - elapsed));
            }

            await task.execute();
        } catch (_error) {
            // Error is handled inside task.execute (rejects the promise)
        } finally {
            aiTelemetryService.onProcessingEnd();
            this.lastRequestTime = Date.now();
            this.isProcessing = false;
            setTimeout(() => this.processQueue(), 100);
        }
    }

    private async executeWithRetries<T>(recipe: AIRecipe<T>, signal?: AbortSignal, attempt = 0): Promise<T> {
        try {
            return await recipe(signal);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorObj = error as Record<string, unknown>;
            const errorStatus = typeof errorObj?.status === 'number' ? errorObj.status : undefined;

            const isRateLimit = errorMessage.includes('429') || errorStatus === 429;
            const isOverloaded = errorMessage.includes('503') || errorStatus === 503;

            if ((isRateLimit || isOverloaded) && attempt < this.MAX_RETRIES) {
                aiTelemetryService.onRateLimit();
                const delay = this.BACKOFF_BASE_MS * Math.pow(2, attempt);
                await new Promise(r => setTimeout(r, delay));
                return this.executeWithRetries(recipe, signal, attempt + 1);
            }
            throw error;
        }
    }
}

export const aiRequestManager = AIRequestManager.getInstance();
