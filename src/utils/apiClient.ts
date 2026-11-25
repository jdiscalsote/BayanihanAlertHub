export class ApiClientError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
  }
}

export async function safeFetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const rawText = await res.text();
  const trimmed = rawText.trimStart();
  const contentType = (res.headers.get('content-type') || '').toLowerCase();

  if (trimmed.startsWith('<') || contentType.includes('text/html')) {
    throw new ApiClientError(
      'The API route returned a web page instead of JSON. Make sure the backend or serverless /api endpoints are running and configured.',
      res.status || 502,
      'HTML_FALLBACK_RESPONSE'
    );
  }

  let data: (T & { error?: string; code?: string; status?: string }) | null =
    null;

  if (trimmed.length > 0) {
    try {
      data = JSON.parse(rawText) as T & {
        error?: string;
        code?: string;
        status?: string;
      };
    } catch {
      throw new ApiClientError(
        `Unexpected response from server (${res.status}). Please try again.`,
        res.status || 502,
        'INVALID_JSON_RESPONSE'
      );
    }
  }

  if (!res.ok) {
    const code =
      data?.code ||
      (typeof data?.status === 'string' ? data.status : undefined);
    throw new ApiClientError(
      data?.error || `Request failed (${res.status}).`,
      res.status,
      code
    );
  }

  if (!data) {
    throw new ApiClientError(
      'Server returned an empty response.',
      res.status || 502,
      'EMPTY_RESPONSE'
    );
  }

  return data;
}
