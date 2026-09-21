import {
  API_VERSION,
  type ApiAction,
  type ApiActions,
  type ApiErrorCode,
  type ApiRequestBody,
  type ApiResponse,
} from '@shared/backend/contract';

// HTTPS transport to the backend web app.
//
// Runs in the main process, not the renderer: the renderer's CSP allows no
// outside connections, and keeping the endpoint here means nothing in the page
// can talk to it except through the IPC surface.
//
// Apps Script specifics, all contained in this file:
//   - the body is sent as text/plain, which Apps Script accepts and which avoids
//     a CORS preflight should this ever run from a browser;
//   - a POST is answered with a 302 to googleusercontent.com, which must be
//     followed as a GET. `fetch` does exactly that for a 302.
// A Firebase or REST backend replaces this function and nothing else.

export type Fetch = typeof fetch;

export interface TransportOptions {
  url: string;
  timeoutMs?: number;
  fetchImpl?: Fetch;
}

function error(code: ApiErrorCode, message: string): ApiResponse<never> {
  return { success: false, code, message };
}

export async function sendRequest<A extends ApiAction>(
  opts: TransportOptions,
  action: A,
  payload: ApiActions[A]['request'],
  authToken?: string,
): Promise<ApiResponse<ApiActions[A]['response']>> {
  if (!opts.url) return error('NOT_CONFIGURED', 'No backend URL is configured for this build');

  const body: ApiRequestBody<A> = { apiVersion: API_VERSION, action, payload, authToken };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);

  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return error(res.status >= 500 ? 'SERVER_ERROR' : 'NETWORK', `HTTP ${res.status}`);
    try {
      const parsed = JSON.parse(text) as ApiResponse<ApiActions[A]['response']>;
      if (typeof parsed?.success !== 'boolean') return error('SERVER_ERROR', 'Malformed response');
      return parsed;
    } catch {
      // Apps Script answers an unauthorised or broken deployment with an HTML
      // page rather than JSON.
      return error('SERVER_ERROR', 'The backend did not return JSON. Check the deployment access.');
    }
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    // The renderer only sees NETWORK; the cause is what a support log needs.
    console.warn(`[backend] ${action} failed:`, aborted ? `no answer in ${opts.timeoutMs ?? 30000} ms` : e);
    return error('NETWORK', aborted ? 'The backend did not answer in time' : 'Could not reach the backend');
  } finally {
    clearTimeout(timer);
  }
}
