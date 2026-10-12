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
  kvk_number: string | null;
  vat_number: string | null;
  iban: string | null;
  settings: Record<string, unknown>;
  logo_url: string | null;
};

export type TenantFull = TenantDetails;

export type Ref = { id: string; name: string };
export type VatRate = 0 | 9 | 21;

export type Customer = {
  id: string;
  kind: 'particulier' | 'zakelijk';
  name: string;
  email: string | null;
  phone: string | null;
  vat_number: string | null;
  address: Address | null;
};
export type CustomerDetail = Customer & {
  quotes: { id: string; number: string | null; title: string | null; status: QuoteStatus; created_at: string }[];
  jobs: { id: string; title: string; status: JobStatus; created_at: string }[];
  invoices: { id: string; number: string | null; status: InvoiceStatus; total_incl: number | null; created_at: string }[];
};

export type ItemKind = 'arbeid' | 'materiaal' | 'overig';
export type Item = {
  id: string;
  kind: ItemKind;
  name: string;
  brand: string | null;
  sku: string | null;
  unit: string;
  purchase_price: number | null;
  sale_price: number;
  vat_rate: number;
  track_stock: boolean;
  stock_quantity: number;
  min_stock: number | null;
};
export type StockMovement = {
  id: number;
  quantity: number;
  reason: 'beginvoorraad' | 'inkoop' | 'verbruik' | 'correctie' | 'retour';
  job_id: string | null;
  note: string | null;
  created_at: string;
};

export type Line = {
  id?: string;
  item_id?: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  vat_rate: VatRate;
};
export type Totals = {
  total_excl: number;
  total_vat: number;
  total_incl: number;
  vat_breakdown: { rate: number; excl: number; vat: number }[];
};

export type QuoteStatus = 'concept' | 'verzonden' | 'geaccepteerd' | 'afgewezen' | 'verlopen';
export type QuoteSummary = {
  id: string;
  number: string | null;
  title: string | null;
  status: QuoteStatus;
  valid_until: string | null;
  created_at: string;
  customer: Ref;
  total_incl: number;
};
export type Quote = Omit<QuoteSummary, 'total_incl'> &
  Totals & { notes: string | null; lines: Line[]; job_id: string | null };

export type JobStatus = 'gepland' | 'bezig' | 'opgeleverd' | 'gefactureerd' | 'geannuleerd';
export type JobSummary = {
  id: string;
  title: string;
  status: JobStatus;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  customer: Ref;
  quote_id: string | null;
};
export type TimeEntry = {
  id: string;
  work_date: string;
  hours: number | null;
  started_at: string | null;
  billable: boolean;
  note: string | null;
  invoiced: boolean;
};
export type MaterialUsage = {
  id: string;
  item_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number | null;
  billable: boolean;
  invoiced: boolean;
};
export type Job = JobSummary & {
  site_address: Address | null;
  customer: Ref & { phone: string | null; address: Address | null };
  quote: { id: string; number: string | null; title: string | null } | null;
  time_entries: TimeEntry[];
  materials: MaterialUsage[];
  invoices: { id: string; number: string | null; status: InvoiceStatus; total_incl: number | null }[];
  total_hours: number;
  uninvoiced_billable_hours: number;
};

export type RunningTimer = {
  id: string;
  started_at: string;
  note: string | null;
  job: { id: string; title: string; customer: Ref };
};
export type Overview = {
  timer: RunningTimer | null;
  open_jobs: number;
  open_quotes: number;
  unpaid_invoices: number;
  unpaid_amount: number;
  hours_this_week: number;
};

export type InvoiceStatus = 'concept' | 'definitief' | 'betaald' | 'vervallen';
export type InvoiceSummary = {
  id: string;
  number: string | null;
  kind: 'factuur' | 'credit';
  status: InvoiceStatus;
  issued_on: string | null;
  due_on: string | null;
  created_at: string;
  customer: Ref;
  total_incl: number;
  open_amount: number;
};
export type Invoice = Omit<InvoiceSummary, 'total_incl'> &
  Totals & {
    job: { id: string; title: string } | null;
    customer_snapshot: { name?: string; address?: Address; vat_number?: string; email?: string } | null;
    lines: Line[];
    payments: { id: string; amount: number; paid_on: string; method: string | null }[];
    paid_amount: number;
  };
