export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  RELAYRUN_WORKER_SECRET: string;
}

export class SupabaseRestClient {
  private baseUrl: string;
  private apiKey: string;
  private workerSecret: string;

  constructor(env: SupabaseEnv) {
    this.baseUrl = env.SUPABASE_URL.replace(/\/$/, '');
    this.apiKey = env.SUPABASE_PUBLISHABLE_KEY;
    this.workerSecret = env.RELAYRUN_WORKER_SECRET;
  }

  async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      operatorKey?: string;
      prefer?: string;
    } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'x-relayrun-worker': this.workerSecret
    };
    if (options.operatorKey) {
      headers['x-operator-key'] = options.operatorKey;
    }
    if (options.prefer) {
      headers.Prefer = options.prefer;
    }

    const res = await fetch(`${this.baseUrl}/rest/v1/${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Supabase REST error ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
