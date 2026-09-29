import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { listAiModels } from '../../../infra/ai-models.js';

export async function registerThemeModelRoutes(app: FastifyInstance, pool: pg.Pool) {
  app.get('/theme-models', { schema: { tags: ['AI 换主题'], summary: '可选择的图像模型及每张图积分' } }, async () => {
    const models = (await listAiModels(pool)).filter(model => model.purpose === 'theme' && model.enabled &&
      model.credentialConfigured && model.unitCredits !== null);
    return { code: 0, data: models.map(({ provider, model, unitCredits, revision }) => ({ provider, model, unitCredits, revision })) };
  });
}
