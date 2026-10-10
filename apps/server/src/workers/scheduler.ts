import { setTimeout as delay } from 'node:timers/promises';
import { errorCode, type Logger } from '../infra/logger.js';

export const DEFAULT_LANE = 'dispatch';

export interface ScheduledTask {
  name: string;
  intervalMs: number;
  // A critical task that has not succeeded within this window makes the worker unhealthy.
  staleAfterMs: number;
  critical?: boolean;
  // Tasks in the same lane run one after another; lanes run concurrently. Defaults to DEFAULT_LANE.
  lane?: string;
  run: () => Promise<unknown>;
}

export interface TaskStatus {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  consecutiveFailures: number;
  lastDurationMs: number | null;
  runningForMs: number | null;
}

export interface HealthReport {
  healthy: boolean;
  checkedAt: string;
  problems: string[];
  consumers: Record<string, boolean>;
  tasks: Record<string, TaskStatus & { lane: string; critical: boolean; stale: boolean }>;
}

// Each task runs and fails independently: a broken queue or table must not stall the other dispatchers.
// Within a lane tasks run sequentially, so scheduling work holds at most one database connection per lane;
// slow external deliveries get their own lane so they cannot delay outbox dispatch or recovery.
// A task belongs to exactly one lane and a lane never overlaps itself, so no task is re-entered.
export function createScheduler(tasks: ScheduledTask[], log: Logger, now: () => number = Date.now) {
  const state = new Map(tasks.map(task => [task.name, {
    nextRunAt: 0, lastSuccessAt: null as number | null, lastFailureAt: null as number | null,
    lastErrorCode: null as string | null, consecutiveFailures: 0, lastDurationMs: null as number | null, startedAt: null as number | null,
  }]));
  const lanes = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    const lane = task.lane ?? DEFAULT_LANE;
    lanes.set(lane, [...lanes.get(lane) ?? [], task]);
  }
  const busy = new Set<string>();

  async function runTask(task: ScheduledTask) {
    const current = state.get(task.name)!;
    const started = now();
    current.startedAt = started;
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
    current.startedAt = null;
    current.lastDurationMs = now() - started;
    current.nextRunAt = started + task.intervalMs;
  }

  // Runs the lane's due tasks once; skipped while the lane is still busy with a previous pass.
  async function tickLane(lane: string, isStopping: () => boolean) {
    if (busy.has(lane)) return;
    busy.add(lane);
    try {
      for (const task of lanes.get(lane) ?? []) {
        if (isStopping()) return;
        if (now() < state.get(task.name)!.nextRunAt) continue;
        await runTask(task);
      }
    } finally { busy.delete(lane); }
  }

  async function tick(isStopping: () => boolean = () => false) {
    await Promise.all([...lanes.keys()].map(lane => tickLane(lane, isStopping)));
  }

  // Keeps every lane ticking about once per second until the signal aborts; resolves once in-flight tasks finish.
  async function run(signal: AbortSignal, pauseMs = 1000) {
    await Promise.all([...lanes.keys()].map(async lane => {
      while (!signal.aborted) {
        await tickLane(lane, () => signal.aborted);
        await delay(pauseMs, undefined, { signal }).catch(() => {});
      }
    }));
  }

  // Independent of lane progress: a task stuck in flight shows up through its own staleness, not by freezing the report.
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
        lane: task.lane ?? DEFAULT_LANE, critical, stale, consecutiveFailures: current.consecutiveFailures, lastErrorCode: current.lastErrorCode,
        lastDurationMs: current.lastDurationMs, runningForMs: current.startedAt === null ? null : at - current.startedAt,
        lastSuccessAt: current.lastSuccessAt === null ? null : new Date(current.lastSuccessAt).toISOString(),
        lastFailureAt: current.lastFailureAt === null ? null : new Date(current.lastFailureAt).toISOString(),
      };
    }
    return { healthy: problems.length === 0, checkedAt: new Date(at).toISOString(), problems, consumers, tasks: report };
  }

  return { tick, run, health, lanes: [...lanes.keys()] };
}
