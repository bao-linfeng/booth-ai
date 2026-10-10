import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../../config.js';
import { loginClient, syncClientSession } from '../identity/client-service.js';
import type { UserType } from '../identity/service.js';
import { claimAnonymousProjects } from '../projects/claims.js';
import { linkVisitorToUser } from '../selection/analytics/recording.js';

// 参展商登录的唯一编排位置：身份模块建立会话，此处把游客期间的数据归到该账号（搜索记录按访客 ID，项目按已验证的账号邮箱）。
// 新增需要在登录时认领的游客数据，加在 attributeGuestData 里，不要让 identity 依赖其他业务模块。
function attributeGuestData(pool: pg.Pool) {
  return async ({ userId, email, visitorId }: { userId: string; email: string | null; visitorId: string | null }) => {
    if (visitorId) await linkVisitorToUser(pool, visitorId, userId);
    await claimAnonymousProjects(pool, userId, email);
  };
}

export function signInClient(config: Config, pool: pg.Pool, redis: Redis, username: string, password: string, visitorId: string | null) {
  return loginClient(config, pool, redis, username, password, visitorId, attributeGuestData(pool));
}

export function signInClientWithToken(config: Config, pool: pg.Pool, redis: Redis, username: string, token: string, visitorId: string | null, type: UserType = 'client') {
  return syncClientSession(config, pool, redis, username, token, visitorId, type, attributeGuestData(pool));
}
