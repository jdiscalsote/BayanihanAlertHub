import type { IncomingMessage, ServerResponse } from 'http';
import type { ApiHandlerResult } from './apiHandlers';

export interface ServerlessRequest extends IncomingMessage {
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export function sendJson(
  res: ServerResponse,
  result: ApiHandlerResult
): void {
  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(result.body));
}

export async function readJsonBody(req: ServerlessRequest): Promise<unknown> {
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      return req.body.trim() ? JSON.parse(req.body) : {};
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const MAX_BYTES = 1024 * 1024;

    req.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      totalBytes += buf.length;
      if (totalBytes > MAX_BYTES) {
        reject(new Error('Request payload too large.'));
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON request body.'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

export function getQueryParam(
  req: ServerlessRequest,
  key: string
): string | undefined {
  if (req.query && req.query[key] !== undefined) {
    const val = req.query[key];
    return Array.isArray(val) ? val[0] : val;
  }
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      return parsed.searchParams.get(key) ?? undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
