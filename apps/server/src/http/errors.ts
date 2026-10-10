import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// 错误响应契约：code 只区分大类（VALIDATION_ERROR 为请求 schema 校验失败），前端按 reason 区分具体业务错误，
// details 是领域代码构造的补充信息（仅在带 reason 的 4xx 中出现）。message 是通用文案，不透传异常信息。
export const ERROR_CODES = ['VALIDATION_ERROR', 'REQUEST_ERROR', 'INTERNAL_ERROR'] as const;

export const errorResponseSchema = {
  $id: 'ErrorResponse',
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string', enum: ERROR_CODES },
        reason: { type: 'string', description: '业务错误原因，如 INSUFFICIENT_CREDITS、RESOURCE_NOT_FOUND' },
        details: { description: '与 reason 对应的补充信息，结构由具体 reason 决定' },
        message: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
} as const;

type DomainError = FastifyError & { reason?: string; details?: unknown };

export function sendError(error: DomainError, request: FastifyRequest, reply: FastifyReply) {
  const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  // Error messages can include upstream credentials; only emit stable diagnostic codes and details built by domain code.
  request.log[status >= 500 ? 'error' : 'warn']({ code: error.code ?? 'REQUEST_ERROR', statusCode: status }, 'request failed');
  const { reason, details } = error;
  const assignmentUnavailable = status === 503 && reason === 'ASSIGNMENT_UNAVAILABLE';
  const code = error.validation ? 'VALIDATION_ERROR' : assignmentUnavailable ? 'REQUEST_ERROR' : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  const message = assignmentUnavailable ? 'Request acceptance is temporarily unavailable' : status >= 500 ? 'Internal server error' : 'Invalid request';
  return reply.code(status).send({ error: {
    code, ...(reason && (status < 500 || assignmentUnavailable) ? { reason } : {}), ...(reason && details !== undefined && status < 500 ? { details } : {}),
    message, requestId: request.id,
  } });
}

/** Registers the shared error contract: handler, unknown-route response and the error schema on every route's 4xx/5xx. */
export function registerErrorContract(app: FastifyInstance) {
  app.addSchema(errorResponseSchema);
  app.setErrorHandler(sendError);
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'REQUEST_ERROR', reason: 'ROUTE_NOT_FOUND', message: 'Route not found', requestId: request.id } }));
  // Routes keep their own explicit status schemas (e.g. readiness 503); everything else documents and serializes the shared shape.
  app.addHook('onRoute', route => {
    const schema = route.schema ?? {};
    if (schema.hide) return;
    route.schema = { ...schema, response: { '4xx': { $ref: 'ErrorResponse#' }, '5xx': { $ref: 'ErrorResponse#' }, ...(schema.response as object | undefined) } };
  });
}
