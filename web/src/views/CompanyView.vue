<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Check, ImageUp, Package } from 'lucide-vue-next';
import { api, type TenantDetails } from '../lib/api';
import { loadCurrentTenant, setCurrentTenant, state } from '../lib/session';
import PageHeader from '../components/PageHeader.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import AppLogo from '../components/AppLogo.vue';

// Bedrijfsgegevens: alles wat op offertes en facturen komt.
const form = reactive({
  name: '', contact_name: '', email: '', phone: '', street: '', postal_code: '', city: '',
  kvk_number: '', vat_number: '', iban: '', payment_days: 14,
});
const saving = ref(false);
const saved = ref(false);
const error = ref('');

onMounted(async () => {
  try {
    const t = await loadCurrentTenant();
    if (!t) return;
    Object.assign(form, {
      name: t.name, contact_name: t.contact_name ?? '', email: t.email ?? '', phone: t.phone ?? '',
      street: t.address?.street ?? '', postal_code: t.address?.postal_code ?? '', city: t.address?.city ?? '',
      kvk_number: t.kvk_number ?? '', vat_number: t.vat_number ?? '', iban: t.iban ?? '',
      payment_days: Number(t.settings.payment_days ?? 14),
    });
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const blank = (s: string) => s.trim() || null;

async function save() {
  saving.value = true;
  saved.value = false;
  error.value = '';
  try {
    const address = { street: form.street.trim() || undefined, postal_code: form.postal_code.trim() || undefined, city: form.city.trim() || undefined };
    const t = await api<TenantDetails>(`/tenants/${state.tenant!.id}`, {
      method: 'PATCH',
      json: {
        name: form.name.trim(), contact_name: blank(form.contact_name), email: blank(form.email), phone: blank(form.phone),
        address: Object.values(address).some(Boolean) ? address : null,
        kvk_number: blank(form.kvk_number), vat_number: blank(form.vat_number), iban: blank(form.iban)?.replace(/\s/g, '').toUpperCase() ?? null,
        payment_days: form.payment_days,
      },
    });
    setCurrentTenant(t);
    saved.value = true;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function uploadLogo(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = '';
  try {
    const data = new FormData();
    data.append('file', file);
    setCurrentTenant(await api<TenantDetails>(`/tenants/${state.tenant!.id}/logo`, { method: 'POST', form: data }));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader title="Bedrijfsgegevens" subtitle="Dit staat op je offertes en facturen" />
    <ErrorAlert :message="error" />

    <form class="flex flex-col gap-4" @submit.prevent="save">
      <label class="bg-base-100 rounded-box flex cursor-pointer items-center gap-4 p-4 shadow-sm">
        <span class="bg-base-200 grid size-16 shrink-0 place-items-center overflow-hidden rounded-box">
          <img v-if="state.tenant?.logo_url" :src="state.tenant.logo_url" alt="Logo" class="size-full object-contain p-1" />
          <AppLogo v-else class="size-10 opacity-40" />
        </span>
        <span class="flex-1">
          <span class="block font-medium">Logo</span>
          <span class="text-base-content/60 text-sm">PNG, JPG, WebP of SVG, max 2 MB</span>
        </span>
        <ImageUp class="size-5 opacity-60" />
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="hidden" @change="uploadLogo" />
      </label>

      <label class="floating-label"><span>Bedrijfsnaam *</span><input v-model="form.name" class="input input-lg w-full" placeholder="Bedrijfsnaam *" required /></label>
      <label class="floating-label"><span>Jouw naam</span><input v-model="form.contact_name" class="input input-lg w-full" placeholder="Jouw naam" /></label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="floating-label"><span>E-mail</span><input v-model="form.email" type="email" class="input input-lg w-full" placeholder="E-mail" /></label>
        <label class="floating-label"><span>Telefoon</span><input v-model="form.phone" type="tel" class="input input-lg w-full" placeholder="Telefoon" /></label>
      </div>
      <label class="floating-label"><span>Straat en huisnummer</span><input v-model="form.street" class="input input-lg w-full" placeholder="Straat en huisnummer" /></label>
      <div class="grid grid-cols-[2fr_3fr] gap-4">
        <label class="floating-label"><span>Postcode</span><input v-model="form.postal_code" class="input input-lg w-full uppercase" placeholder="Postcode" /></label>
        <label class="floating-label"><span>Plaats</span><input v-model="form.city" class="input input-lg w-full" placeholder="Plaats" /></label>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="floating-label"><span>KvK-nummer</span><input v-model="form.kvk_number" inputmode="numeric" class="input input-lg w-full" placeholder="KvK-nummer" /></label>
        <label class="floating-label"><span>Btw-nummer</span><input v-model="form.vat_number" class="input input-lg w-full uppercase" placeholder="Btw-nummer" /></label>
      </div>
      <label class="floating-label"><span>IBAN</span><input v-model="form.iban" class="input input-lg w-full uppercase" placeholder="IBAN" /></label>
      <div>
        <p class="mb-2 text-sm font-semibold">Betaaltermijn facturen</p>
        <div class="join w-full">
          <input v-for="d in [7, 14, 30]" :key="d" v-model.number="form.payment_days" :value="d" type="radio" name="days" class="join-item btn flex-1 whitespace-nowrap" :aria-label="`${d} dagen`" />
        </div>
      </div>

      <div v-if="saved" role="status" class="alert alert-success alert-soft">Opgeslagen.</div>
      <button class="btn btn-primary btn-lg" :disabled="saving || !form.name.trim()">
        <span v-if="saving" class="loading loading-spinner" /><Check v-else class="size-5" /> Opslaan
      </button>
      <RouterLink to="/artikelen" class="btn btn-ghost"><Package class="size-4" /> Tarieven en artikelen beheren</RouterLink>
    </form>
  </main>
</template>
