import { setTimeout as delay } from 'node:timers/promises';
import { ImageGenerationError, providerJson, requestSignal } from '../image.js';
import type { ActiveAiModel, ImageModelAdapter } from '../types.js';

async function poll(model: ActiveAiModel, taskId: string, deadline: Date): Promise<string[]> {
  const pollDeadline = new Date(Math.min(deadline.getTime(), Date.now() + 180_000));
  for (let attempt = 0; attempt < 60; attempt++) {
    if (pollDeadline.getTime() <= Date.now()) throw new ImageGenerationError('PROVIDER_POLL_UNAVAILABLE', true);
    await delay(2000, undefined, { signal: requestSignal(pollDeadline, 180_000) });
    const body = await providerJson(`https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${model.apiKey}` },
    }, pollDeadline, false) as { output?: { task_status?: string; results?: { url?: string }[] } };
    if (body?.output?.task_status === 'SUCCEEDED') {
      if (!Array.isArray(body.output.results)) throw new ImageGenerationError('PROVIDER_POLL_UNAVAILABLE', true);
      return body.output.results.flatMap(item => typeof item?.url === 'string' && item.url ? [item.url] : []);
    }
    if (body?.output?.task_status === 'FAILED' || body?.output?.task_status === 'CANCELED') throw new ImageGenerationError('PROVIDER_GENERATION_FAILED');
  }
  throw new ImageGenerationError('PROVIDER_POLL_UNAVAILABLE', true);
}

// https://help.aliyun.com/zh/model-studio/wanx-image-edit-api-reference — asynchronous task, polled until terminal.
export const wanxImage: ImageModelAdapter = {
  maxImagesPerRequest: 4,
  downloadHosts: ['aliyuncs.com'],
  async edit(model, { prompt, count, deadline, sourceUrl, onSubmitted, onProviderRequest }) {
    const body = await providerJson('https://dashscope.aliyuncs.com/api/v1/services/aigc/image2image/image-synthesis', {
      method: 'POST', headers: { Authorization: `Bearer ${model.apiKey}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({ model: model.model, input: { function: 'description_edit', prompt, base_image_url: sourceUrl }, parameters: { n: count } }),
    }, deadline, true, onProviderRequest) as { output?: { task_id?: string } };
    if (typeof body?.output?.task_id !== 'string' || !body.output.task_id) throw new ImageGenerationError('PROVIDER_OUTCOME_UNKNOWN', false, true);
    await onSubmitted?.(body.output.task_id);
    return poll(model, body.output.task_id, deadline);
  },
  poll,
};
