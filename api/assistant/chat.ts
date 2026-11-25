import type { ServerResponse } from 'http';
import { handleAssistantChat } from '../../server/apiHandlers';
import {
  readJsonBody,
  sendJson,
  type ServerlessRequest,
} from '../../server/vercelAdapter';

export default async function handler(
  req: ServerlessRequest,
  res: ServerResponse
) {
  if (req.method !== 'POST') {
    sendJson(res, {
      status: 405,
      body: { error: 'Method not allowed. Use POST.' },
    });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await handleAssistantChat(body);
    sendJson(res, result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid request payload.';
    sendJson(res, { status: 400, body: { error: message } });
  }
}
