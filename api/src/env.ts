function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Omgevingsvariabele ${name} ontbreekt (zie .env.example)`);
  return value;
}

export const env = {
  supabaseUrl: required('SUPABASE_URL'),
  // Publishable (anon) key: elke query draait met het JWT van de gebruiker, dus RLS geldt altijd.
  supabaseKey: required('SUPABASE_PUBLISHABLE_KEY'),
  port: Number(process.env.PORT ?? 3000),
  // Frontends die de API vanuit de browser mogen aanroepen (komma-gescheiden).
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
};
