import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface FlowPerformanceBudgetConfig {
  flows: Record<string, { enforcedMaxMs: number; targetMs: number }>;
}

const readFlowPerformanceBudgetConfig = (): FlowPerformanceBudgetConfig =>
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'scripts/config/flow-performance-budgets.json'),
      'utf8'
    )
  ) as FlowPerformanceBudgetConfig;

describe('flow performance budget config', () => {
  it('keeps the clinical census hard cap below two seconds', () => {
    const config = readFlowPerformanceBudgetConfig();

    expect(config.flows.censoVisibleMs).toMatchObject({
      targetMs: 1500,
      enforcedMaxMs: 2000,
    });
  });
});
