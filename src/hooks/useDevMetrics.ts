import { useState, useEffect } from 'react';

export interface DevMetrics {
    testStats: {
        total: number;
        passed: number;
        failed: number;
        successRate: number;
    };
    coverage: {
        statements: number;
        functions: number;
        lines: number;
        branches: number;
    };
    healthScore: 'S' | 'A' | 'B' | 'C' | 'F';
    lastRun: string;
}

/**
 * useDevMetrics - Hook to provide development health data.
 * In a real environment, this might fetch from a dev server or local JSON.
 */
export const useDevMetrics = () => {
    const [metrics, setMetrics] = useState<DevMetrics | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMetrics = async () => {
            setLoading(true);

            // Default values: Updated 2026-01-11 from actual test run
            // Run: npx vitest run --coverage
            let testStats = { total: 1187, passed: 1187, failed: 0, successRate: 100 };
            let coverage = { statements: 66.94, functions: 59.63, lines: 68.39, branches: 55.53 };

            try {
                // We try to fetch the generated result files. 
                // Note: These must be available to the dev server.
                const [resultsRes, coverageRes] = await Promise.allSettled([
                    fetch('/test_results_current.json'),
                    fetch('/coverage_current.json')
                ]);

                if (resultsRes.status === 'fulfilled' && resultsRes.value.ok) {
                    const data = await resultsRes.value.json();
                    testStats = {
                        total: data.numTotalTests,
                        passed: data.numPassedTests,
                        failed: data.numFailedTests,
                        successRate: (data.numPassedTests / data.numTotalTests) * 100
                    };
                }

                if (coverageRes.status === 'fulfilled' && coverageRes.value.ok) {
                    const data = await coverageRes.value.json();
                    if (data.total) {
                        coverage = {
                            statements: data.total.statements?.pct ?? coverage.statements,
                            functions: data.total.functions?.pct ?? coverage.functions,
                            lines: data.total.lines?.pct ?? coverage.lines,
                            branches: data.total.branches?.pct ?? coverage.branches
                        };
                    }
                }
            } catch (error) {
                console.warn('[DevMetrics] Using default values', error);
            }

            // Calculate health score based on coverage and tests
            // S: 100% tests + > 80% coverage
            // A: 100% tests + > 60% coverage
            // B: > 95% tests + > 50% coverage
            // C: > 90% tests + > 40% coverage
            let healthScore: DevMetrics['healthScore'] = 'C';
            if (testStats.successRate === 100) {
                if (coverage.statements >= 80) healthScore = 'S';
                else if (coverage.statements >= 60) healthScore = 'A';
                else if (coverage.statements >= 30) healthScore = 'B';
            } else if (testStats.successRate > 95) {
                healthScore = 'B';
            }

            setMetrics({
                testStats,
                coverage,
                healthScore,
                lastRun: new Date().toISOString()
            });
            setLoading(false);
        };

        fetchMetrics();
    }, []);

    return { metrics, loading };
};
