import type { ServerResponse } from 'http';
import { handleReverseGeocode } from '../../server/apiHandlers';
import {
  getQueryParam,
  sendJson,
  type ServerlessRequest,
} from '../../server/vercelAdapter';

export default async function handler(
  req: ServerlessRequest,
  res: ServerResponse
) {
  if (req.method !== 'GET') {
    sendJson(res, {
      status: 405,
      body: { error: 'Method not allowed. Use GET.' },
    });
    return;
  }

  const lat = getQueryParam(req, 'lat');
  const lng = getQueryParam(req, 'lng');
  const result = await handleReverseGeocode(lat, lng);
  sendJson(res, result);
}
