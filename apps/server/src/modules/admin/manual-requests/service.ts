import type pg from 'pg';

const columns = `id, user_id AS "userId", contact_name AS "contactName", contact_detail AS "contactDetail", original_text AS "originalText", requirement,
  unresolved_questions AS "unresolvedQuestions", scheme_context AS "schemeContext", status, follow_up_note AS "followUpNote",
  followed_by AS "followedBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listManualRequests(pool: pg.Pool, query: { page?: number; pageSize?: number; status?: string }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where = query.status ? ' WHERE status=$1' : '';
  const args = query.status ? [query.status] : [];
  const [records, count] = await Promise.all([
    pool.query(`SELECT ${columns} FROM manual_requests${where} ORDER BY created_at DESC,id DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, (page - 1) * pageSize]),
    pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM manual_requests${where}`, args),
  ]);
  return { data: records.rows, total: Number(count.rows[0]?.total ?? 0), page, pageSize };
}

export async function getManualRequest(pool: pg.Pool, id: string) {
  const record = (await pool.query(`SELECT ${columns} FROM manual_requests WHERE id=$1`, [id])).rows[0];
  if (!record) throw Object.assign(new Error('Manual request not found'), { statusCode: 404 });
  return record;
}

export async function followUpManualRequest(pool: pg.Pool, id: string, adminId: string, input: { status: 'pending' | 'following_up' | 'completed'; followUpNote: string }) {
  const result = await pool.query(`UPDATE manual_requests SET status=$2,follow_up_note=$3,followed_by=$4,updated_at=now() WHERE id=$1 RETURNING ${columns}`,
    [id, input.status, input.followUpNote.trim(), adminId]);
  if (!result.rows[0]) throw Object.assign(new Error('Manual request not found'), { statusCode: 404 });
  return result.rows[0];
}
