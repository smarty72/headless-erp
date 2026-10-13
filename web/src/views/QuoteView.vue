<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Check, ClipboardList, Eye, PenLine, Printer, Send, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-vue-next';
import type { Customer, Line, Quote } from '../lib/api';
import { tapi } from '../lib/tenant';
import { date, lineTotals } from '../lib/format';
import { loadCurrentTenant, state } from '../lib/session';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import CustomerPicker from '../components/CustomerPicker.vue';
import LinesEditor from '../components/LinesEditor.vue';
import PrintDocument from '../components/PrintDocument.vue';

// Eén scherm voor nieuw, bewerken (concept) en bekijken (verstuurd en verder).
const props = defineProps<{ id?: string }>();
const route = useRoute();
const router = useRouter();
const quote = ref<Quote | null>(null);
const customer = ref<Customer | null>(null);
const form = reactive({ title: '', notes: '', valid_until: '', lines: [] as Line[] });
const preview = ref(false);
const busy = ref('');
const error = ref('');

const editable = computed(() => !props.id || quote.value?.status === 'concept');

function fill(q: Quote) {
  quote.value = q;
  Object.assign(form, { title: q.title ?? '', notes: q.notes ?? '', valid_until: q.valid_until ?? '', lines: q.lines.map((l) => ({ ...l })) });
}

async function load() {
  try {
    await loadCurrentTenant();
    if (props.id) {
      const q = await tapi<Quote>(`/quotes/${props.id}`);
      fill(q);
      customer.value = await tapi<Customer>(`/customers/${q.customer.id}`);
    } else if (route.query.klant) {
      customer.value = await tapi<Customer>(`/customers/${route.query.klant}`);
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
// Na opslaan van een nieuwe offerte blijft dit scherm staan (nieuw -> /offertes/:id).
watch(() => props.id, load);

const body = () => ({
  customer_id: customer.value?.id,
  title: form.title.trim() || null,
  notes: form.notes.trim() || null,
  valid_until: form.valid_until || null,
  lines: form.lines.map(({ id: _id, ...l }) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
});

async function run(name: string, fn: () => Promise<void>) {
  busy.value = name;
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

const save = () =>
  run('save', async () => {
    if (props.id) fill(await tapi<Quote>(`/quotes/${props.id}`, { method: 'PATCH', json: body() }));
    else {
      const { title, notes, valid_until, ...rest } = body();
      const q = await tapi<Quote>('/quotes', {
        method: 'POST',
        json: { ...rest, title: title ?? undefined, notes: notes ?? undefined, valid_until: valid_until ?? undefined },
      });
      await router.replace(`/offertes/${q.id}`);
    }
  });

const send = () =>
  run('send', async () => {
    await tapi(`/quotes/${props.id}`, { method: 'PATCH', json: body() });
    fill(await tapi<Quote>(`/quotes/${props.id}/send`, { method: 'POST', json: {} }));
    preview.value = false;
  });

const accept = () =>
  run('accept', async () => {
    if (quote.value?.status === 'concept') await tapi(`/quotes/${props.id}`, { method: 'PATCH', json: body() });
    const { job_id } = await tapi<{ job_id: string }>(`/quotes/${props.id}/accept`, { method: 'POST', json: {} });
    await router.push(`/opdrachten/${job_id}`);
  });

const decline = () =>
  run('decline', async () => {
    fill(await tapi<Quote>(`/quotes/${props.id}/decline`, { method: 'POST' }));
  });

const remove = () =>
  run('remove', async () => {
    if (!confirm('Conceptofferte verwijderen?')) return;
    await tapi(`/quotes/${props.id}`, { method: 'DELETE' });
    await router.replace('/offertes');
  });

const shownTotals = computed(() => (editable.value || !quote.value ? lineTotals(form.lines) : quote.value));
const canSave = computed(() => !!customer.value && form.lines.every((l) => l.description.trim() && Number(l.quantity) > 0));
const print = () => window.print();
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-32 sm:px-6 sm:pt-8">
    <PageHeader :title="quote?.number ?? (id ? 'Conceptofferte' : 'Nieuwe offerte')" :subtitle="quote ? `Offerte voor ${quote.customer.name}` : undefined" back="/offertes">
      <StatusBadge v-if="quote" type="quote" :status="quote.status" />
    </PageHeader>
    <ErrorAlert :message="error" />

    <!-- Bewerken -->
    <div v-if="editable && !preview" class="flex flex-col gap-5">
      <section>
        <h2 class="text-base-content/70 mb-2 text-sm font-semibold">Klant</h2>
        <CustomerPicker v-model="customer" />
      </section>
      <label class="floating-label">
        <span>Omschrijving van het werk</span>
        <input v-model="form.title" class="input input-lg w-full" placeholder="Bijv. Buitenschilderwerk kozijnen" />
      </label>
      <section>
        <h2 class="text-base-content/70 mb-2 text-sm font-semibold">Regels</h2>
        <LinesEditor v-model="form.lines" />
      </section>
      <label class="floating-label">
        <span>Toelichting voor de klant</span>
        <textarea v-model="form.notes" class="textarea w-full" rows="3" placeholder="Toelichting, bijv. planning of voorwaarden" />
      </label>
      <label class="floating-label">
        <span>Geldig tot</span>
        <input v-model="form.valid_until" type="date" class="input w-full" />
      </label>
    </div>

    <!-- Bekijken / afdrukken -->
    <PrintDocument
      v-else
      kind="Offerte"
      :number="quote?.number ?? null"
      :tenant="state.tenant"
      :customer="customer"
      :lines="editable ? form.lines : quote?.lines ?? []"
      :totals="shownTotals"
      :title="editable ? form.title : quote?.title"
      :notes="editable ? form.notes : quote?.notes"
      :meta="[
        { label: 'Datum', value: date(quote?.created_at) || date(new Date().toISOString()) },
        { label: 'Geldig tot', value: date(editable ? form.valid_until : quote?.valid_until) },
      ]"
    />

    <RouterLink v-if="quote?.job_id" :to="`/opdrachten/${quote.job_id}`" class="btn btn-soft btn-primary no-print mt-4">
      <ClipboardList class="size-4" /> Naar de opdracht
    </RouterLink>

    <!-- Acties onderin -->
    <div class="no-print bg-base-200/95 border-base-300 fixed inset-x-0 bottom-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div class="mx-auto flex max-w-3xl flex-wrap gap-2">
        <template v-if="!id">
          <button class="btn btn-primary btn-lg flex-1" :disabled="!canSave || !!busy" @click="save">
            <span v-if="busy === 'save'" class="loading loading-spinner" /><Check v-else class="size-5" /> Opslaan
          </button>
        </template>
        <template v-else-if="quote?.status === 'concept'">
          <button class="btn btn-ghost btn-square btn-lg" :aria-label="preview ? 'Bewerken' : 'Voorbeeld'" @click="preview = !preview">
            <PenLine v-if="preview" class="size-5" /><Eye v-else class="size-5" />
          </button>
          <button class="btn btn-lg" :disabled="!canSave || !!busy" @click="save">
            <span v-if="busy === 'save'" class="loading loading-spinner" /> Opslaan
          </button>
          <button class="btn btn-primary btn-lg flex-1" :disabled="!canSave || !form.lines.length || !!busy" @click="send">
            <span v-if="busy === 'send'" class="loading loading-spinner" /><Send v-else class="size-5" /> Versturen
          </button>
        </template>
        <template v-else-if="quote?.status === 'verzonden'">
          <button class="btn btn-ghost btn-square btn-lg" aria-label="Afdrukken" @click="print"><Printer class="size-5" /></button>
          <button class="btn btn-lg" :disabled="!!busy" @click="decline"><ThumbsDown class="size-5" /> Afgewezen</button>
          <button class="btn btn-primary btn-lg flex-1" :disabled="!!busy" @click="accept">
            <span v-if="busy === 'accept'" class="loading loading-spinner" /><ThumbsUp v-else class="size-5" /> Akkoord
          </button>
        </template>
        <template v-else-if="quote">
          <button class="btn btn-lg flex-1" @click="print"><Printer class="size-5" /> Afdrukken of PDF</button>
        </template>
      </div>
      <div v-if="quote?.status === 'concept'" class="mx-auto mt-1 flex max-w-3xl justify-between">
        <button class="btn btn-ghost btn-xs text-error" @click="remove"><Trash2 class="size-3" /> Verwijderen</button>
        <button class="btn btn-ghost btn-xs" :disabled="!canSave || !form.lines.length || !!busy" @click="accept">Klant is al akkoord</button>
      </div>
    </div>
  </main>
</template>
