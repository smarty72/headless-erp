<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, FileText, Hammer } from 'lucide-vue-next';
import type { Customer, Job } from '../lib/api';
import { tapi } from '../lib/tenant';
import { today } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import CustomerPicker from '../components/CustomerPicker.vue';

// Nieuwe opdracht: eerst een offerte, of direct aan de slag op uurbasis (regie).
const route = useRoute();
const router = useRouter();
const mode = ref<'kies' | 'regie'>('kies');
const customer = ref<Customer | null>(null);
const form = reactive({ title: '', starts_on: today() });
const saving = ref(false);
const error = ref('');

onMounted(async () => {
  if (route.query.klant) {
    try {
      customer.value = await tapi<Customer>(`/customers/${route.query.klant}`);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
});

function withQuote() {
  router.push({ path: '/offertes/nieuw', query: customer.value ? { klant: customer.value.id } : {} });
}

async function create() {
  saving.value = true;
  error.value = '';
  try {
    const job = await tapi<Job>('/jobs', {
      method: 'POST',
      json: { customer_id: customer.value!.id, title: form.title.trim(), starts_on: form.starts_on || undefined },
    });
    await router.replace(`/opdrachten/${job.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader title="Nieuwe opdracht" :back="mode === 'regie' ? '/opdrachten/nieuw' : '/'" />
    <ErrorAlert :message="error" />

    <div v-if="mode === 'kies'" class="grid gap-4">
      <button class="bg-base-100 rounded-box flex items-center gap-4 p-5 text-left shadow-sm" @click="withQuote">
        <FileText class="text-primary size-10 shrink-0" :stroke-width="1.5" />
        <span>
          <span class="block text-lg font-semibold">Eerst een offerte</span>
          <span class="text-base-content/60 text-sm">Vaste prijs. Na akkoord wordt het vanzelf een opdracht.</span>
        </span>
      </button>
      <button class="bg-base-100 rounded-box flex items-center gap-4 p-5 text-left shadow-sm" @click="mode = 'regie'">
        <Hammer class="text-primary size-10 shrink-0" :stroke-width="1.5" />
        <span>
          <span class="block text-lg font-semibold">Direct aan de slag</span>
          <span class="text-base-content/60 text-sm">Op uurbasis (regie): je factureert de gewerkte uren en het materiaal.</span>
        </span>
      </button>
    </div>

    <form v-else class="flex flex-col gap-5" @submit.prevent="create">
      <section>
        <h2 class="text-base-content/70 mb-2 text-sm font-semibold">Klant</h2>
        <CustomerPicker v-model="customer" />
      </section>
      <label class="floating-label">
        <span>Wat ga je doen? *</span>
        <input v-model="form.title" class="input input-lg w-full" placeholder="Bijv. Lekkage badkamer verhelpen" required />
      </label>
      <label class="floating-label">
        <span>Startdatum</span>
        <input v-model="form.starts_on" type="date" class="input input-lg w-full" />
      </label>
      <button class="btn btn-primary btn-lg" :disabled="saving || !customer || !form.title.trim()">
        <span v-if="saving" class="loading loading-spinner" /><Check v-else class="size-5" /> Opdracht aanmaken
      </button>
    </form>
  </main>
</template>
