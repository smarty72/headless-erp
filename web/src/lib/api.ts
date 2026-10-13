import { supabase } from './supabase';

const baseUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Options = { method?: string; json?: unknown; form?: FormData };

export async function api<T>(path: string, { method = 'GET', json, form }: Options = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
  if (json !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(baseUrl + path, { method, headers, body: form ?? (json !== undefined ? JSON.stringify(json) : undefined) });
  } catch {
    throw new ApiError(0, 'Geen verbinding met de server. Draait de API?');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `Fout ${res.status}`);
  return body as T;
}

export type Industry = {
  key: string;
  label: string;
  icon: string;
  suggested_hourly_rate: number;
  default_labour_vat_rate: number;
};

export type Address = { street?: string; postal_code?: string; city?: string };

export type TenantSummary = { id: string; name: string; industry: string; role: string };

export type TenantDetails = {
  id: string;
  name: string;
  industry: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: Address | null;
  settings: Record<string, unknown>;
  logo_url: string | null;
};
