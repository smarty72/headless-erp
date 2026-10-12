import { HTTPException } from 'hono/http-exception';
import type { PostgrestError } from '@supabase/supabase-js';

// Vertaalt Postgres/PostgREST-fouten naar HTTP-statussen die kanalen begrijpen.
const statusByCode: Record<string, 400 | 403 | 404 | 409 | 422> = {
  '42501': 403, // RLS of ontbrekende rechten
  '23503': 422, // foreign key, bijv. klant van een ander bedrijf
  '23505': 409, // uniek, bijv. dubbel nummer
  '23514': 409, // check of onveranderlijke factuur
  '22P02': 400, // ongeldige uuid of waarde
  P0002: 404, // no_data_found uit een functie
  PGRST116: 404, // .single() zonder resultaat
};

export function dbError(error: PostgrestError): never {
  const status = statusByCode[error.code] ?? 500;
  throw new HTTPException(status, { message: status === 500 ? 'Databasefout' : error.message, cause: error });
}
