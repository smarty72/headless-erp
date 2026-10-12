import type { InvoiceStatus, JobStatus, QuoteStatus } from './api';

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const num = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 3 });
const day = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
const dayShort = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });

export const euro = (n: number | null | undefined) => eur.format(n ?? 0);
export const amount = (n: number | null | undefined) => num.format(n ?? 0);
export const hours = (n: number | null | undefined) => `${num.format(n ?? 0)} uur`;

// Datums uit de API zijn yyyy-mm-dd (lokaal) of ISO-tijdstempels.
const parse = (s: string) => (s.length === 10 ? new Date(`${s}T12:00:00`) : new Date(s));
export const date = (s: string | null | undefined) => (s ? day.format(parse(s)) : '');
export const shortDate = (s: string | null | undefined) => (s ? dayShort.format(parse(s)) : '');
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isOverdue = (due: string | null, status: InvoiceStatus) =>
  !!due && (status === 'definitief' || status === 'vervallen') && due < today();

type Badge = { label: string; class: string };
export const quoteStatus: Record<QuoteStatus, Badge> = {
  concept: { label: 'Concept', class: 'badge-ghost' },
  verzonden: { label: 'Verstuurd', class: 'badge-info badge-soft' },
  geaccepteerd: { label: 'Akkoord', class: 'badge-success badge-soft' },
  afgewezen: { label: 'Afgewezen', class: 'badge-error badge-soft' },
  verlopen: { label: 'Verlopen', class: 'badge-warning badge-soft' },
};
export const jobStatus: Record<JobStatus, Badge> = {
  gepland: { label: 'Gepland', class: 'badge-ghost' },
  bezig: { label: 'Bezig', class: 'badge-primary badge-soft' },
  opgeleverd: { label: 'Opgeleverd', class: 'badge-success badge-soft' },
  gefactureerd: { label: 'Gefactureerd', class: 'badge-info badge-soft' },
  geannuleerd: { label: 'Geannuleerd', class: 'badge-error badge-soft' },
};
export const invoiceStatus: Record<InvoiceStatus, Badge> = {
  concept: { label: 'Concept', class: 'badge-ghost' },
  definitief: { label: 'Openstaand', class: 'badge-warning badge-soft' },
  betaald: { label: 'Betaald', class: 'badge-success badge-soft' },
  vervallen: { label: 'Vervallen', class: 'badge-error badge-soft' },
};

export const addressLine = (a: { street?: string; postal_code?: string; city?: string } | null | undefined) =>
  a ? [a.street, [a.postal_code, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

// Live totalen voor een regel-editor; zelfde afronding als de API (btw per tarief).
const r2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;
export function lineTotals(lines: { quantity: number; unit_price: number; vat_rate: number }[]) {
  const per = new Map<number, number>();
  for (const l of lines) per.set(l.vat_rate, (per.get(l.vat_rate) ?? 0) + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
  const vat_breakdown = [...per.entries()].sort(([a], [b]) => b - a).map(([rate, s]) => ({ rate, excl: r2(s), vat: r2((r2(s) * rate) / 100) }));
  const total_excl = r2(vat_breakdown.reduce((s, r) => s + r.excl, 0));
  const total_vat = r2(vat_breakdown.reduce((s, r) => s + r.vat, 0));
  return { total_excl, total_vat, total_incl: r2(total_excl + total_vat), vat_breakdown };
}
