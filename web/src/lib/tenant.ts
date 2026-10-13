import { api } from './api';
import { loadCurrentTenant } from './session';

type Options = Parameters<typeof api>[1];

// API-aanroep binnen het actieve bedrijf: tapi('/quotes') -> /tenants/<id>/quotes.
export async function tapi<T>(path: string, options?: Options): Promise<T> {
  const tenant = await loadCurrentTenant();
  if (!tenant) throw new Error('Geen bedrijf gevonden');
  return api<T>(`/tenants/${tenant.id}${path}`, options);
}
