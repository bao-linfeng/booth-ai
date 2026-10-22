import type pg from 'pg';

type Db = Pick<pg.Pool, 'query'>;

export interface LeasedOutboxSpec {
  /** 表名与列名直接拼进 SQL，只能来自代码常量 */
  table: string;
  /** 到期列：领取条件与失败退避都写这一列，默认 next_attempt_at */
  dueColumn?: string;
  /** 完成列：送达时写入，默认 delivered_at */
  doneColumn?: string;
  /** 待发条件，默认完成列与 failed_at 均为空；有其他终态（如取消）的表需要覆盖 */
  pending?: string;
  maxAttempts: number;
  backoff: { baseSeconds: number; maxSeconds: number };
}

/**
 * 租约式 outbox 的公共状态机：领取时计入一次尝试并加租约，来不及处理的释放租约并退回这次尝试，
 * 失败按指数退避顺延、永久错误或用尽次数时进入终态，送达后写完成列。
 * 表需有 id、attempts、locked_until、last_error_code、failed_at、created_at 以及到期列与完成列。
 */
export function leasedOutbox(spec: LeasedOutboxSpec) {
  const { table, dueColumn: due = 'next_attempt_at', doneColumn: done = 'delivered_at', maxAttempts, backoff } = spec;
  const pending = spec.pending ?? `${done} IS NULL AND failed_at IS NULL`;
  const backoffSeconds = (attempts: number) => Math.min(backoff.baseSeconds * 2 ** Math.max(0, attempts - 1), backoff.maxSeconds);
  return {
    backoffSeconds,
    /**
     * 领取语句的前半段：在单条语句内选出到期且未被租用的行并加租约，调用外部服务时不持有行锁。
     * 调用方接着补关联表、`WHERE <alias>.id = claimed.id …` 与 RETURNING；参数 $1 为条数，$2 为租约秒数。
     */
    claim: (alias: string) =>
      `UPDATE ${table} ${alias} SET attempts = ${alias}.attempts + 1, locked_until = now() + make_interval(secs => $2)
     FROM (SELECT id FROM ${table}
           WHERE ${pending} AND ${due} <= now() AND (locked_until IS NULL OR locked_until < now())
           ORDER BY ${due}, created_at LIMIT $1 FOR UPDATE SKIP LOCKED) claimed`,
    /** wrap 可把更新语句包进 CTE，在同一条语句里写附带记录（如项目时间线） */
    async complete(db: Db, id: string, wrap: (update: string) => string = update => update): Promise<void> {
      await db.query(
        wrap(`UPDATE ${table} SET ${done} = now(), locked_until = NULL, last_error_code = NULL WHERE id = $1 AND ${done} IS NULL`),
        [id],
      );
    },
    /** 本批来不及处理的已领取行：释放租约并退回本次计入的尝试次数 */
    async release(db: Db, ids: string[]): Promise<void> {
      await db.query(
        `UPDATE ${table} SET locked_until = NULL, attempts = GREATEST(attempts - 1, 0) WHERE id = ANY($1::uuid[]) AND ${pending}`,
        [ids],
      );
    },
    /** permanent：重试无意义的错误（如收件地址被拒），直接进入终态。返回 true 表示已终态失败。 */
    async fail(
      db: Db,
      row: { id: string; attempts: number },
      code: string,
      permanent: boolean,
      wrap: (update: string) => string = update => update,
    ): Promise<boolean> {
      const exhausted = permanent || row.attempts >= maxAttempts;
      await db.query(
        wrap(`UPDATE ${table} SET locked_until = NULL, last_error_code = $2,
    ${due} = now() + make_interval(secs => $3), failed_at = CASE WHEN $4::boolean THEN now() END
    WHERE id = $1 AND ${done} IS NULL`),
        [row.id, code.slice(0, 64), backoffSeconds(row.attempts), exhausted],
      );
      return exhausted;
    },
  };
}
