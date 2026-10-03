export function domainError(reason: string, statusCode = 409) {
  return Object.assign(new Error(reason), { statusCode, reason });
}
