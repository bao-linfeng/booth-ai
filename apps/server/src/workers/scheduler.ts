import { errorCode, type Logger } from '../infra/logger.js';

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  // A critical task that has not succeeded within this window makes the worker unhealthy.
  staleAfterMs: number;
  critical?: boolean;
  run: () => Promise<unknown>;
}

export interface TaskStatus {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  lastDurationMs: number | null;
}

export interface HealthReport {
  healthy: boolean;
  checkedAt: string;
  problems: string[];
  consumers: Record<string, boolean>;
  tasks: Record<string, TaskStatus & { critical: boolean; stale: boolean }>;
}

// Each task runs and fails independently: a broken queue or table must not stall the other dispatchers.
// Tasks run sequentially to keep database pool usage at one connection for scheduling work.
export function createScheduler(tasks: ScheduledTask[], log: Logger, now: () => number = Date.now) {
  const state = new Map(tasks.map(task => [task.name, {
    nextRunAt: 0, lastSuccessAt: null as number | null, lastFailureAt: null as number | null,
    lastErrorCode: null as string | null, consecutiveFailures: 0, lastDurationMs: null as number | null,
  }]));

  async function tick(isStopping: () => boolean = () => false) {
    for (const task of tasks) {
      const current = state.get(task.name)!;
      if (isStopping()) return;
      if (now() < current.nextRunAt) continue;
      const started = now();
      try {
        await task.run();
        if (current.consecutiveFailures) log.info({ task: task.name, failures: current.consecutiveFailures }, 'Scheduled task recovered');
        current.lastSuccessAt = now();
        current.consecutiveFailures = 0;
        current.lastErrorCode = null;
      } catch (error) {
        current.lastFailureAt = now();
        current.lastErrorCode = errorCode(error);
        current.consecutiveFailures++;
        // Log the first failure and then periodically, so a persistent outage does not flood logs every second.
        if (current.consecutiveFailures === 1 || current.consecutiveFailures % 60 === 0) {
          log.error({ task: task.name, code: current.lastErrorCode, failures: current.consecutiveFailures }, 'Scheduled task failed; pending work retained for retry');
        }
      }
      current.lastDurationMs = now() - started;
      current.nextRunAt = started + task.intervalMs;
    }
  }

  function health(consumers: Record<string, boolean>): HealthReport {
    const at = now();
    const problems = Object.entries(consumers).filter(([, ok]) => !ok).map(([name]) => `consumer:${name}`);
    const report: HealthReport['tasks'] = {};
    for (const task of tasks) {
      const current = state.get(task.name)!;
      const critical = task.critical ?? true;
      const stale = current.lastSuccessAt === null || at - current.lastSuccessAt > task.staleAfterMs;
      if (critical && stale) problems.push(`task:${task.name}`);
      report[task.name] = {
        critical, stale, consecutiveFailures: current.consecutiveFailures, lastErrorCode: current.lastErrorCode, lastDurationMs: current.lastDurationMs,
        lastSuccessAt: current.lastSuccessAt === null ? null : new Date(current.lastSuccessAt).toISOString(),
        lastFailureAt: current.lastFailureAt === null ? null : new Date(current.lastFailureAt).toISOString(),
      };
    }
    return { healthy: problems.length === 0, checkedAt: new Date(at).toISOString(), problems, consumers, tasks: report };
  }

  return { tick, health };
}
