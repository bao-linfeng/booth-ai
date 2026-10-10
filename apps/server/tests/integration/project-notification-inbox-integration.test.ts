import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {
  getNotificationInboxDetail,
  listNotificationInbox,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../src/modules/projects/notification-inbox.js';

test(
  'project notification inbox: per-admin read state, filters, delivery status and not-found',
  { skip: !process.env.PROJECT_TEST_DATABASE_URL },
  async t => {
    const pool = new pg.Pool({ connectionString: process.env.PROJECT_TEST_DATABASE_URL });
    const [first, second] = [randomUUID(), randomUUID()];
    const projectId = randomUUID();
    t.after(async () => {
      await pool.query('DELETE FROM project_notification_outbox WHERE project_id=$1', [projectId]);
      await pool.query('DELETE FROM project_events WHERE project_id=$1', [projectId]);
      await pool.query('DELETE FROM projects WHERE id=$1', [projectId]);
      await pool.query('DELETE FROM admins WHERE id=ANY($1::uuid[])', [[first, second]]);
      await pool.end();
    });
    for (const id of [first, second])
      await pool.query("INSERT INTO admins(id,external_user_id,username,roles) VALUES($1,$2,$3,ARRAY['ROLE_ADMIN'])", [
        id,
        Math.floor(Math.random() * 1e12),
        id,
      ]);
    const snapshot = { company: '测试公司', contact: { name: '联系人' }, exhibition: { name: '测试展会' } };
    await pool.query(
      "INSERT INTO projects(id,request_no,source_type,assignee_admin_id,request_snapshot) VALUES($1,$2,'manual_request',$3,$4)",
      [projectId, `MR-${projectId}`, first, JSON.stringify(snapshot)],
    );
    const notifications: string[] = [];
    for (const kind of ['accepted', 'artworks']) {
      const event = (
        await pool.query<{ id: string }>('INSERT INTO project_events(project_id,kind,payload) VALUES($1,$2,$3) RETURNING id', [
          projectId,
          kind,
          JSON.stringify({ revision: 1 }),
        ])
      ).rows[0]!;
      notifications.push(
        (
          await pool.query<{ id: string }>('INSERT INTO project_notification_outbox(project_id,event_id) VALUES($1,$2) RETURNING id', [
            projectId,
            event.id,
          ])
        ).rows[0]!.id,
      );
    }
    await pool.query('UPDATE project_notification_outbox SET delivered_at=now() WHERE id=$1', [notifications[0]]);
    const [accepted, artworks] = notifications as [string, string];
    const mine = async (adminId: string, isRead?: boolean) =>
      (await listNotificationInbox(pool, adminId, { projectNo: undefined, isRead, pageSize: 100 })).items.filter(
        row => row.projectId === projectId,
      );

    assert.equal((await mine(first, false)).length, 2);
    await markNotificationRead(pool, first, accepted);
    await markNotificationRead(pool, first, accepted);
    assert.deepEqual(
      (await mine(first, true)).map(row => row.id),
      [accepted],
    );
    assert.deepEqual(
      (await mine(first, false)).map(row => row.id),
      [artworks],
    );
    assert.equal((await mine(second, false)).length, 2, 'read state is per admin');

    const detail = await getNotificationInboxDetail(pool, first, accepted);
    assert.deepEqual(
      { kind: detail.kind, company: detail.company, exhibition: detail.exhibitionName, delivery: detail.delivery, isRead: detail.isRead },
      { kind: 'accepted', company: '测试公司', exhibition: '测试展会', delivery: 'delivered', isRead: true },
    );
    assert.equal((await getNotificationInboxDetail(pool, first, artworks)).delivery, 'pending');
    assert.equal(
      (await listNotificationInbox(pool, first, { kind: 'artworks', pageSize: 100 })).items.filter(row => row.projectId === projectId)
        .length,
      1,
    );

    assert.ok((await markAllNotificationsRead(pool, second)) >= 2);
    assert.equal((await mine(second, false)).length, 0);
    assert.equal((await listNotificationInbox(pool, second, {})).unreadCount, 0);
    await assert.rejects(getNotificationInboxDetail(pool, first, randomUUID()), { statusCode: 404 });
    await assert.rejects(markNotificationRead(pool, first, randomUUID()), { statusCode: 404 });
  },
);
