import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Een client per request, met het token van de gebruiker. De API heeft zelf geen
// bijzondere rechten: wat de gebruiker niet mag, mag de API namens hem ook niet.
export function clientForToken(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl, env.supabaseKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
