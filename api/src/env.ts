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
};
