<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check } from 'lucide-vue-next';
import type { Customer } from '../lib/api';
import { tapi } from '../lib/tenant';
import PageHeader from '../components/PageHeader.vue';
import ErrorAlert from '../components/ErrorAlert.vue';

// Nieuwe klant, of een bestaande bewerken (/klanten/:id/bewerken).
const props = defineProps<{ id?: string }>();
const router = useRouter();
const route = useRoute();
const saving = ref(false);
const error = ref('');

const form = reactive({
  kind: 'particulier' as Customer['kind'],
  name: '',
  email: '',
  phone: '',
  street: '',
  postal_code: '',
  city: '',
  vat_number: '',
});

onMounted(async () => {
  if (!props.id) return;
  try {
    const c = await tapi<Customer>(`/customers/${props.id}`);
    Object.assign(form, {
      kind: c.kind,
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      street: c.address?.street ?? '',
      postal_code: c.address?.postal_code ?? '',
      city: c.address?.city ?? '',
      vat_number: c.vat_number ?? '',
    });
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const blank = (s: string) => (s.trim() ? s.trim() : null);

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const address = { street: blank(form.street) ?? undefined, postal_code: blank(form.postal_code) ?? undefined, city: blank(form.city) ?? undefined };
    const hasAddress = Object.values(address).some(Boolean);
    const body = {
      kind: form.kind,
      name: form.name.trim(),
      email: blank(form.email),
      phone: blank(form.phone),
      vat_number: form.kind === 'zakelijk' ? blank(form.vat_number) : null,
      address: hasAddress ? address : null,
    };
    const saved = props.id
      ? await tapi<Customer>(`/customers/${props.id}`, { method: 'PATCH', json: body })
      : await tapi<Customer>('/customers', {
          method: 'POST',
          // Bij aanmaken laten we lege velden weg.
          json: Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)),
        });
    // Terug naar waar je vandaan kwam (bijv. een nieuwe offerte), anders naar de klant.
    const back = route.query.terug as string | undefined;
    await router.replace(back ? `${back}${back.includes('?') ? '&' : '?'}klant=${saved.id}` : `/klanten/${saved.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader :title="id ? 'Klant bewerken' : 'Nieuwe klant'" :back="id ? `/klanten/${id}` : '/klanten'" />

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

      <ErrorAlert :message="error" />

      <button class="btn btn-primary btn-lg mt-2 w-full" :disabled="saving || !form.name.trim()">
        <span v-if="saving" class="loading loading-spinner" />
        <Check v-else class="size-5" /> Klant opslaan
      </button>
    </form>
  </main>
</template>
