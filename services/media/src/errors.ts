export class MediaError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) { super(message); }
}
