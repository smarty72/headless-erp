import { reactive } from 'vue';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api, type TenantDetails, type TenantSummary } from './api';

const STORAGE_KEY = 'vakwerk.tenant';

function readStoredTenant(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const state = reactive({
  ready: false,
  session: null as Session | null,
  tenants: null as TenantSummary[] | null,
  tenant: null as TenantDetails | null,
});

let initPromise: Promise<void> | null = null;

export function initSession(): Promise<void> {
  initPromise ??= (async () => {
    const { data } = await supabase.auth.getSession();
    state.session = data.session;
    supabase.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      if (!session) {
        state.tenants = null;
        state.tenant = null;
      }
    });
    state.ready = true;
  })();
  return initPromise;
}

export async function loadTenants(force = false): Promise<TenantSummary[]> {
  if (!state.tenants || force) state.tenants = await api<TenantSummary[]>('/me/tenants');
  return state.tenants;
}

// Het actieve bedrijf: het laatst gekozen, anders het eerste.
export async function loadCurrentTenant(): Promise<TenantDetails | null> {
  const tenants = await loadTenants();
  const stored = readStoredTenant();
  const pick = tenants.find((t) => t.id === stored) ?? tenants[0];
  if (!pick) return null;
  if (state.tenant?.id !== pick.id) state.tenant = await api<TenantDetails>(`/tenants/${pick.id}`);
  return state.tenant;
}

export function setCurrentTenant(tenant: TenantDetails) {
  state.tenant = tenant;
  try {
    localStorage.setItem(STORAGE_KEY, tenant.id);
  } catch {
    /* privémodus: dan kiezen we de volgende keer het eerste bedrijf */
  }
}

export async function signOut() {
  await supabase.auth.signOut();
  state.tenants = null;
  state.tenant = null;
}
