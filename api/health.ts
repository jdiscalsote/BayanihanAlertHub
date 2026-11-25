import type { ServerResponse } from 'http';
import { handleHealth } from '../server/apiHandlers';
import { sendJson, type ServerlessRequest } from '../server/vercelAdapter';

export default async function handler(
  _req: ServerlessRequest,
  res: ServerResponse
) {
  sendJson(res, handleHealth());
}
