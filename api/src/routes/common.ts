import { z, type OpenAPIHono } from '@hono/zod-openapi';
import type { AuthVariables } from '../auth.js';
import { ErrorBody, Uuid } from '../schemas.js';

export type App = OpenAPIHono<{ Variables: AuthVariables }>;
export type Db = AuthVariables['db'];

export const pathId = (name: string) => Uuid.openapi({ param: { name, in: 'path' } });

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

const error = (description: string) => json(ErrorBody, description);
export const notFound = { 404: error('Niet gevonden') };
export const conflict = { 409: error('Kan niet in deze status') };
export const invalid = { 422: error('Verwijst naar iets dat niet bestaat') };

export const VatRate = z.union([z.literal(0), z.literal(9), z.literal(21)]);
export const Address = z
  .object({ street: z.string().optional(), postal_code: z.string().optional(), city: z.string().optional() })
  .openapi('Address');

// Regels met aantal, prijs (excl. btw) en btw-tarief: offertes en facturen.
export const Line = z
  .object({
    item_id: Uuid.nullable().optional(),
    description: z.string().trim().min(1, 'Omschrijving is verplicht'),
    quantity: z.number().positive('Aantal moet groter dan 0 zijn'),
    unit: z.string().min(1),
    unit_price: z.number(),
    vat_rate: VatRate,
  })
  .openapi('Line');
export type LineInput = z.infer<typeof Line>;

export const Totals = z
  .object({
    total_excl: z.number(),
    total_vat: z.number(),
    total_incl: z.number(),
    vat_breakdown: z.array(z.object({ rate: z.number(), excl: z.number(), vat: z.number() })),
  })
  .openapi('Totals');

// Afronden op centen zonder floating-point-verrassingen (3 x 18,95 = 56,85).
export const round2 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) / 100;

// Btw per tarief afronden, net als finalize_invoice in de database.
export function totals(lines: { quantity: number; unit_price: number; vat_rate: number }[]): z.infer<typeof Totals> {
  const perRate = new Map<number, number>();
  for (const l of lines) perRate.set(Number(l.vat_rate), (perRate.get(Number(l.vat_rate)) ?? 0) + l.quantity * l.unit_price);
  const vat_breakdown = [...perRate.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, sum]) => {
      const excl = round2(sum);
      return { rate, excl, vat: round2((excl * rate) / 100) };
    });
  const total_excl = round2(vat_breakdown.reduce((s, r) => s + r.excl, 0));
  const total_vat = round2(vat_breakdown.reduce((s, r) => s + r.vat, 0));
  return { total_excl, total_vat, total_incl: round2(total_excl + total_vat), vat_breakdown };
}

export const CustomerRef = z.object({ id: Uuid, name: z.string() }).openapi('CustomerRef');

// Zoekterm veilig maken voor een PostgREST-filterstring.
export const searchTerm = (search?: string) => search?.replace(/[^\p{L}\p{N} .@-]/gu, '').trim() || undefined;
