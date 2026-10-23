import type { AssistantReply, ChatItem, AnalyzeResult, Credits, Lookup, PostBody, PostsPage, Territory, CodeSent, Report, Published, ReportBody, ReportCreated, Locality, Municipality, RegisterBody, User } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

async function call(path: string, init: { method?: string; body?: BodyInit; type?: string }): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      credentials: 'include',
      headers: init.type ? { 'Content-Type': init.type } : undefined,
      body: init.body,
    });
  } catch {
    throw new ApiError(0, 'network', 'No hay conexión. Revisa tu internet e intenta otra vez.');
  }
  if (!res.ok) {
    const data: unknown = await res.json().catch(() => null);
    const e = (data ?? {}) as { error?: string; message?: string; retryAfterSec?: number };
    const header = Number(res.headers.get('Retry-After'));
    const retry = e.retryAfterSec ?? (header > 0 ? header : undefined);
    throw new ApiError(res.status, e.error ?? 'unknown', e.message ?? 'Algo salió mal. Intenta de nuevo.', retry);
  }
  return res;
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await call(path, {
    method: init.method,
    body: init.body ? JSON.stringify(init.body) : undefined,
    type: init.body ? 'application/json' : undefined,
  });
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => null)) as T;
}

/** Cuerpo binario crudo (no multipart). */
const raw = <T>(path: string, blob: Blob, type: string) => call(path, { body: blob, type }).then((r) => r.json() as Promise<T>);

export const api = {
  municipalities: (q: string) =>
    request<{ items: Municipality[] }>(`/locations/municipalities?q=${encodeURIComponent(q)}`),
  localities: () => request<{ items: Locality[] }>('/locations/bogota-localities'),
  register: (b: RegisterBody) => request<CodeSent>('/auth/register', { body: b }),
  resendCode: (phone: string) => request<CodeSent>('/auth/resend-code', { body: { phone } }),
  verify: (phone: string, code: string) => request<User>('/auth/verify', { body: { phone, code } }),
  forgotPassword: (phone: string) => request<CodeSent>('/auth/forgot-password', { body: { phone } }),
  resetPassword: (phone: string, code: string, password: string) => request<User>('/auth/reset-password', { body: { phone, code, password } }),
  webCall: (sdp: string) => request<{ sdp: string; type: 'answer' }>('/voice/web-call', { body: { sdp, type: 'offer' } }),
  login: (phone: string, password: string) => request<User>('/auth/login', { body: { phone, password } }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),
  analyze: (text: string) => request<AnalyzeResult>('/analyze', { body: { text } }),
  assistantMessage: (text: string) => request<AssistantReply>('/assistant/message', { body: { text } }),
  assistantAudio: (blob: Blob) => raw<AssistantReply>('/assistant/audio', blob, blob.type || 'audio/webm;codecs=opus'),
  assistantImage: (blob: Blob) => raw<AssistantReply>('/assistant/image', blob, blob.type),
  assistantHistory: () => request<{ items: ChatItem[] }>('/assistant/history'),
  analyzeAudio: (blob: Blob) => raw<AnalyzeResult>('/analyze/audio', blob, blob.type || 'audio/webm;codecs=opus'),
  analyzeImage: (blob: Blob) => raw<AnalyzeResult>('/analyze/image', blob, blob.type),
  speak: (text: string) =>
    call('/voice/speak', { body: JSON.stringify({ text }), type: 'application/json' }).then((r) => r.blob()),
  createReport: (b: ReportBody) => request<ReportCreated>('/reports', { body: b }),
  publishCase: (caseId: number) => request<Published>(`/cases/${caseId}/publish`, { method: 'POST' }),
  reports: () => request<{ items: Report[] }>('/reports'),
  donate: () => request<{ url: string }>('/donations/checkout', { body: {} }),
  myPosts: () => request<PostsPage>('/posts/mine'),
  posts: (before?: string | null) => request<PostsPage>(`/posts${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  createPost: (b: PostBody) => request<{ id: number; body: string }>('/posts', { body: b }),
  confirmPost: (id: number) => request<void>(`/posts/${id}/confirm`, { method: 'POST' }),
  unconfirmPost: (id: number) => request<void>(`/posts/${id}/confirm`, { method: 'DELETE' }),
  deletePost: (id: number) => request<void>(`/posts/${id}`, { method: 'DELETE' }),
  lookup: (q: string) => request<Lookup>(`/lookup?q=${encodeURIComponent(q)}`),
  territory: () => request<Territory>('/territory'),
  bogotaGeojson: () => request<GeoJSON.FeatureCollection>('/territory/bogota-geojson'),
  credits: () => request<Credits>('/credits'),
  checkout: () => request<{ url: string }>('/credits/checkout', { method: 'POST' }),
  reportPdf: (id: number) => call(`/reports/${id}/pdf`, {}).then((r) => r.blob()),
};

export function formatWait(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Mensaje amable para cualquier error de la API (404 = función aún no lista). */
export function errMsg(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Algo salió mal. Intenta de nuevo.';
  if (e.status === 404) return 'Pronto disponible: estamos terminando esta función.';
  if (e.status === 429 && e.retryAfterSec) return `${e.message} (${formatWait(e.retryAfterSec)})`;
  return e.message;
}
