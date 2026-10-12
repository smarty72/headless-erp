import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clientForToken } from './supabase.js';

export type AuthVariables = { db: SupabaseClient; userId: string };

// Verifieert het Supabase-JWT en zet een client met de rechten van de gebruiker klaar.
export const requireUser = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) throw new HTTPException(401, { message: 'Bearer-token ontbreekt' });

  const db = clientForToken(token);
  const { data, error } = await db.auth.getClaims(token);
  if (error || !data?.claims.sub) throw new HTTPException(401, { message: 'Ongeldig of verlopen token' });

  c.set('db', db);
  c.set('userId', data.claims.sub);
  await next();
});
