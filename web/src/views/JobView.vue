<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight, Clock, FileText, Lock, MapPin, PackagePlus, Phone, Play, Plus, Receipt, Trash2 } from 'lucide-vue-next';
import type { Item, Job, JobStatus } from '../lib/api';
import { tapi } from '../lib/tenant';
import { addressLine, amount, euro, hours, shortDate, today } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import ItemPicker from '../components/ItemPicker.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const job = ref<Job | null>(null);
const busy = ref('');
const error = ref('');

const closed = computed(() => job.value?.status === 'gefactureerd' || job.value?.status === 'geannuleerd');
const address = computed(() => addressLine(job.value?.site_address ?? job.value?.customer.address));

onMounted(async () => {
  try {
    job.value = await tapi<Job>(`/jobs/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
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

const setStatus = (status: JobStatus) =>
  run('status', async () => {
    job.value = await tapi<Job>(`/jobs/${props.id}`, { method: 'PATCH', json: { status } });
  });

const startTimer = () =>
  run('timer', async () => {
    await tapi('/timer/start', { method: 'POST', json: { job_id: props.id } });
    await router.push('/aan-het-werk');
  });

const makeInvoice = () =>
  run('invoice', async () => {
    const { invoice_id } = await tapi<{ invoice_id: string }>(`/jobs/${props.id}/invoice`, { method: 'POST' });
    await router.push(`/facturen/${invoice_id}`);
  });

// Uren achteraf invullen.
const hoursDialog = ref<HTMLDialogElement | null>(null);
const hoursForm = reactive({ hours: 1 as number | null, work_date: today(), billable: true, note: '' });
function openHours() {
  Object.assign(hoursForm, { hours: null, work_date: today(), billable: !job.value?.quote_id, note: '' });
  hoursDialog.value?.showModal();
}
const addHours = () =>
  run('hours', async () => {
    job.value = await tapi<Job>(`/jobs/${props.id}/time-entries`, {
      method: 'POST',
      json: { hours: hoursForm.hours, work_date: hoursForm.work_date, billable: hoursForm.billable, note: hoursForm.note.trim() || undefined },
    });
    hoursDialog.value?.close();
  });
const removeEntry = (entryId: string) =>
  run('hours', async () => {
    job.value = await tapi<Job>(`/jobs/${props.id}/time-entries/${entryId}`, { method: 'DELETE' });
  });
const toggleBillable = (entryId: string, billable: boolean) =>
  run('hours', async () => {
    job.value = await tapi<Job>(`/jobs/${props.id}/time-entries/${entryId}`, { method: 'PATCH', json: { billable } });
  });

// Materiaal: kies een artikel, dan het aantal.
const picker = ref<InstanceType<typeof ItemPicker> | null>(null);
const materialDialog = ref<HTMLDialogElement | null>(null);
const material = reactive({ item: null as Item | null, quantity: 1 as number | null, billable: true });
function pickedItem(item: Item) {
  Object.assign(material, { item, quantity: 1, billable: !job.value?.quote_id });
  materialDialog.value?.showModal();
}
const addMaterial = () =>
  run('material', async () => {
    job.value = await tapi<Job>(`/jobs/${props.id}/materials`, {
      method: 'POST',
      json: { item_id: material.item!.id, quantity: material.quantity, billable: material.billable },
    });
    materialDialog.value?.close();
  });
const removeMaterial = (usageId: string) =>
  run('material', async () => {
    job.value = await tapi<Job>(`/jobs/${props.id}/materials/${usageId}`, { method: 'DELETE' });
  });

const steps: JobStatus[] = ['gepland', 'bezig', 'opgeleverd'];
const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader :title="job?.title ?? 'Opdracht'" back="/opdrachten">
      <StatusBadge v-if="job" type="job" :status="job.status" />
    </PageHeader>
    <ErrorAlert :message="error" />

    <template v-if="job">
      <section class="bg-base-100 rounded-box mb-4 flex flex-col gap-3 p-4 shadow-sm">
        <RouterLink :to="`/klanten/${job.customer.id}`" class="flex items-center justify-between font-semibold">
          {{ job.customer.name }} <ChevronRight class="size-4 opacity-40" />
        </RouterLink>
        <div class="flex flex-wrap gap-2">
          <a v-if="address" :href="mapsUrl(address)" target="_blank" rel="noopener" class="btn btn-soft btn-sm"><MapPin class="size-4" /> {{ address }}</a>
          <a v-if="job.customer.phone" :href="`tel:${job.customer.phone}`" class="btn btn-soft btn-sm"><Phone class="size-4" /> Bellen</a>
          <RouterLink v-if="job.quote" :to="`/offertes/${job.quote.id}`" class="btn btn-soft btn-sm"><FileText class="size-4" /> Offerte {{ job.quote.number }}</RouterLink>
        </div>
        <p v-if="job.starts_on" class="text-base-content/60 text-sm">Start {{ shortDate(job.starts_on) }}</p>
      </section>

      <div v-if="!closed" class="mb-4 grid grid-cols-2 gap-3">
        <button class="btn btn-primary btn-lg" :disabled="!!busy" @click="startTimer">
          <span v-if="busy === 'timer'" class="loading loading-spinner" /><Play v-else class="size-5 fill-current" /> Start uren
        </button>
        <button class="btn btn-lg" :disabled="!!busy" @click="makeInvoice">
          <span v-if="busy === 'invoice'" class="loading loading-spinner" /><Receipt v-else class="size-5" /> Factuur
        </button>
      </div>

      <div v-if="!closed" class="join mb-6 w-full">
        <button v-for="s in steps" :key="s" class="join-item btn btn-sm flex-1 capitalize" :class="{ 'btn-neutral': job.status === s }" :disabled="!!busy" @click="setStatus(s)">{{ s }}</button>
      </div>

      <!-- Uren -->
      <section class="mb-6">
        <div class="mb-2 flex items-end justify-between">
          <h2 class="font-semibold">Uren <span class="text-base-content/60 font-normal">· {{ hours(job.total_hours) }}</span></h2>
          <button v-if="!closed" class="btn btn-ghost btn-sm" @click="openHours"><Plus class="size-4" /> Uren invullen</button>
        </div>
        <p v-if="job.quote_id" class="text-base-content/60 mb-2 text-xs">Met offerte gelden uren als nacalculatie. Zet meerwerk op "factureren".</p>
        <ul v-if="job.time_entries.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
          <li v-for="e in job.time_entries" :key="e.id" class="flex items-center gap-3 p-3">
            <Clock class="size-4 shrink-0 opacity-50" />
            <span class="min-w-0 flex-1">
              <span class="block">{{ e.hours === null ? 'Timer loopt…' : hours(e.hours) }} <span class="text-base-content/50 text-sm">· {{ shortDate(e.work_date) }}</span></span>
              <span v-if="e.note" class="text-base-content/60 block truncate text-sm">{{ e.note }}</span>
            </span>
            <Lock v-if="e.invoiced" class="size-4 opacity-40" aria-label="Gefactureerd" />
            <template v-else-if="e.hours !== null">
              <button class="badge badge-sm cursor-pointer" :class="e.billable ? 'badge-primary badge-soft' : 'badge-ghost'" @click="toggleBillable(e.id, !e.billable)">
                {{ e.billable ? 'factureren' : 'nacalculatie' }}
              </button>
              <button class="btn btn-ghost btn-xs btn-square" aria-label="Verwijderen" @click="removeEntry(e.id)"><Trash2 class="size-4" /></button>
            </template>
          </li>
        </ul>
        <p v-else class="text-base-content/50 text-sm">Nog geen uren.</p>
      </section>

      <!-- Materiaal -->
      <section class="mb-6">
        <div class="mb-2 flex items-end justify-between">
          <h2 class="font-semibold">Materiaal</h2>
          <button v-if="!closed" class="btn btn-ghost btn-sm" @click="picker?.open(['materiaal', 'overig'])"><PackagePlus class="size-4" /> Toevoegen</button>
        </div>
        <ul v-if="job.materials.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
          <li v-for="m in job.materials" :key="m.id" class="flex items-center gap-3 p-3">
            <span class="min-w-0 flex-1">
              <span class="block truncate">{{ amount(m.quantity) }} {{ m.unit }} {{ m.description }}</span>
              <span class="text-base-content/50 text-sm">{{ euro((m.unit_price ?? 0) * m.quantity) }} · {{ m.billable ? 'factureren' : 'nacalculatie' }}</span>
            </span>
            <Lock v-if="m.invoiced" class="size-4 opacity-40" aria-label="Gefactureerd" />
            <button v-else class="btn btn-ghost btn-xs btn-square" aria-label="Verwijderen" @click="removeMaterial(m.id)"><Trash2 class="size-4" /></button>
          </li>
        </ul>
        <p v-else class="text-base-content/50 text-sm">Nog geen materiaal. Wat je hier boekt, gaat van de voorraad af.</p>
      </section>

      <!-- Facturen -->
      <section v-if="job.invoices.length" class="mb-6">
        <h2 class="mb-2 font-semibold">Facturen</h2>
        <ul class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
          <li v-for="f in job.invoices" :key="f.id">
            <RouterLink :to="`/facturen/${f.id}`" class="flex items-center gap-3 p-3">
              <span class="flex-1">{{ f.number ?? 'Conceptfactuur' }}</span>
              <span v-if="f.total_incl !== null" class="tabular-nums">{{ euro(f.total_incl) }}</span>
              <StatusBadge type="invoice" :status="f.status" />
            </RouterLink>
          </li>
        </ul>
      </section>

      <button v-if="!closed" class="btn btn-ghost btn-sm text-error self-center" @click="setStatus('geannuleerd')">Opdracht annuleren</button>
    </template>

    <ItemPicker ref="picker" @pick="pickedItem" />

    <dialog ref="hoursDialog" class="modal modal-bottom sm:modal-middle">
      <form class="modal-box flex flex-col gap-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]" @submit.prevent="addHours">
        <h2 class="text-lg font-bold">Uren invullen</h2>
        <div class="grid grid-cols-4 gap-2">
          <button v-for="h in [1, 2, 4, 8]" :key="h" type="button" class="btn" :class="{ 'btn-primary': hoursForm.hours === h }" @click="hoursForm.hours = h">{{ h }} uur</button>
        </div>
        <label class="input input-lg w-full">
          <input v-model.number="hoursForm.hours" type="number" inputmode="decimal" step="0.25" min="0.25" max="24" placeholder="Aantal uren" required />
          <span class="opacity-50">uur</span>
        </label>
        <input v-model="hoursForm.work_date" type="date" class="input w-full" aria-label="Datum" required />
        <input v-model="hoursForm.note" class="input w-full" placeholder="Wat heb je gedaan? (optioneel)" />
        <label class="flex items-center justify-between">
          <span>Factureren</span>
          <input v-model="hoursForm.billable" type="checkbox" class="toggle toggle-primary" />
        </label>
        <button class="btn btn-primary btn-lg" :disabled="!hoursForm.hours || busy === 'hours'">
          <span v-if="busy === 'hours'" class="loading loading-spinner" /> Opslaan
        </button>
      </form>
      <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
    </dialog>

    <dialog ref="materialDialog" class="modal modal-bottom sm:modal-middle">
      <form class="modal-box flex flex-col gap-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]" @submit.prevent="addMaterial">
        <h2 class="text-lg font-bold">{{ [material.item?.brand, material.item?.name].filter(Boolean).join(' ') }}</h2>
        <div class="flex items-center gap-2">
          <button type="button" class="btn btn-square btn-lg" @click="material.quantity = Math.max(1, (material.quantity ?? 1) - 1)">−</button>
          <input v-model.number="material.quantity" type="number" inputmode="decimal" step="any" min="0" class="input input-lg flex-1 text-center" aria-label="Aantal" />
          <button type="button" class="btn btn-square btn-lg" @click="material.quantity = (material.quantity ?? 0) + 1">+</button>
          <span class="w-12 opacity-60">{{ material.item?.unit }}</span>
        </div>
        <p v-if="material.item?.track_stock" class="text-base-content/60 text-sm">Op voorraad: {{ amount(material.item.stock_quantity) }} {{ material.item.unit }}</p>
        <label class="flex items-center justify-between">
          <span>Factureren</span>
          <input v-model="material.billable" type="checkbox" class="toggle toggle-primary" />
        </label>
        <button class="btn btn-primary btn-lg" :disabled="!material.quantity || busy === 'material'">
          <span v-if="busy === 'material'" class="loading loading-spinner" /> Toevoegen
        </button>
      </form>
      <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
    </dialog>
  </main>
</template>
