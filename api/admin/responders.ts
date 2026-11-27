import type { ServerResponse } from 'http';
import { handleAdminResponders } from '../../server/apiHandlers';
import {
  getQueryParam,
  readJsonBody,
  sendJson,
  type ServerlessRequest,
} from '../../server/vercelAdapter';

export default async function handler(
  req: ServerlessRequest,
  res: ServerResponse
) {
  let body: unknown = {};
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(res, {
        status: 400,
        body: {
          error:
            err instanceof Error ? err.message : 'Invalid JSON request body.',
        },
      });
      return;
    }
  }

  const authHeader =
    typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : undefined;

  const result = await handleAdminResponders({
    method,
    authHeader,
    queryId: getQueryParam(req, 'id'),
    body,
  });

  sendJson(res, result);
}
