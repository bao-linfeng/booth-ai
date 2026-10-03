export function bomError(reason: string, statusCode: number): Error & { statusCode: number; reason: string } {
  return Object.assign(new Error(reason), { statusCode, reason });
}
