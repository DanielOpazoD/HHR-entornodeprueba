import { spawn } from 'node:child_process';
import os from 'node:os';

export const resolveCommandConcurrency = (defaultMax = 4, env = process.env) => {
  const configured = Number.parseInt(env?.HHR_CHECK_CONCURRENCY ?? '', 10);
  if (Number.isInteger(configured) && configured >= 1) {
    return configured;
  }
  const available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 4;
  return Math.max(1, Math.min(defaultMax, available));
};

const runBufferedCommand = ({ command, args, cwd, env }) =>
  new Promise(resolve => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      resolve({
        status,
        error,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    };

    const child = spawn(command, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', error => finish(1, error));
    child.on('close', code => finish(code ?? 1, null));
  });

export const runCommandsWithConcurrency = async (
  tasks,
  { concurrency = resolveCommandConcurrency(), cwd = process.cwd(), env = process.env } = {}
) => {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));
  const results = new Array(tasks.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      const task = tasks[index];
      const outcome = await runBufferedCommand({
        command: task.command,
        args: task.args,
        cwd,
        env,
      });
      results[index] = { task, ...outcome };
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};
