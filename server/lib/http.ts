import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, friendlyZodMessage(result.error));
  }
  return result.data;
}

function friendlyZodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  const field = issue.path.join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Route not found.' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: friendlyZodMessage(err) });
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  if (/duplicate key/i.test(message)) {
    return res.status(409).json({ error: 'That record already exists.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total, page, pageSize };
}
