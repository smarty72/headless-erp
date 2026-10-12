<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Check } from 'lucide-vue-next';
import { api } from '../lib/api';
import { loadCurrentTenant } from '../lib/session';

const router = useRouter();
const saving = ref(false);
const error = ref('');
const saved = ref('');

const form = reactive({
  kind: 'particulier' as 'particulier' | 'zakelijk',
  name: '',
  email: '',
  phone: '',
  street: '',
  postal_code: '',
  city: '',
  vat_number: '',
});

const blank = (s: string) => (s.trim() ? s.trim() : undefined);

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const tenant = await loadCurrentTenant();
    if (!tenant) throw new Error('Geen bedrijf gevonden');
    const address = { street: blank(form.street), postal_code: blank(form.postal_code), city: blank(form.city) };
    await api(`/tenants/${tenant.id}/customers`, {
      method: 'POST',
      json: {
        kind: form.kind,
        name: form.name.trim(),
        email: blank(form.email),
        phone: blank(form.phone),
        vat_number: form.kind === 'zakelijk' ? blank(form.vat_number) : undefined,
        address: Object.values(address).some(Boolean) ? address : undefined,
      },
    });
    saved.value = form.name.trim();
    setTimeout(() => router.replace('/'), 900);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <header class="mb-4 flex items-center gap-2">
      <RouterLink to="/" class="btn btn-ghost btn-circle" aria-label="Terug"><ArrowLeft class="size-5" /></RouterLink>
      <h1 class="text-2xl font-bold">Nieuwe klant</h1>
    </header>

    <form class="flex flex-col gap-4" @submit.prevent="save">
      <div class="join w-full">
        <input v-model="form.kind" value="particulier" type="radio" name="kind" class="join-item btn btn-lg flex-1" aria-label="Particulier" />
        <input v-model="form.kind" value="zakelijk" type="radio" name="kind" class="join-item btn btn-lg flex-1" aria-label="Zakelijk" />
      </div>

      <label class="floating-label">
        <span>{{ form.kind === 'zakelijk' ? 'Bedrijfsnaam' : 'Naam' }} *</span>
        <input v-model="form.name" class="input input-lg w-full" :placeholder="`${form.kind === 'zakelijk' ? 'Bedrijfsnaam' : 'Naam'} *`" required />
      </label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="floating-label">
          <span>Telefoon</span>
          <input v-model="form.phone" type="tel" class="input input-lg w-full" placeholder="Telefoon" />
        </label>
        <label class="floating-label">
          <span>E-mail</span>
          <input v-model="form.email" type="email" class="input input-lg w-full" placeholder="E-mail" />
        </label>
      </div>
      <label class="floating-label">
        <span>Straat en huisnummer</span>
        <input v-model="form.street" class="input input-lg w-full" placeholder="Straat en huisnummer" />
      </label>
      <div class="grid grid-cols-[2fr_3fr] gap-4">
        <label class="floating-label">
          <span>Postcode</span>
          <input v-model="form.postal_code" class="input input-lg w-full uppercase" placeholder="Postcode" />
        </label>
        <label class="floating-label">
          <span>Plaats</span>
          <input v-model="form.city" class="input input-lg w-full" placeholder="Plaats" />
        </label>
      </div>
      <label v-if="form.kind === 'zakelijk'" class="floating-label">
        <span>Btw-nummer</span>
        <input v-model="form.vat_number" class="input input-lg w-full uppercase" placeholder="Btw-nummer" />
      </label>

      <div v-if="error" role="alert" class="alert alert-error alert-soft">{{ error }}</div>
      <div v-if="saved" role="status" class="alert alert-success alert-soft">{{ saved }} is toegevoegd.</div>

      <button class="btn btn-primary btn-lg mt-2 w-full" :disabled="saving || !form.name.trim() || !!saved">
        <span v-if="saving" class="loading loading-spinner" />
        <Check v-else class="size-5" /> Klant opslaan
      </button>
    </form>
  </main>
</template>
