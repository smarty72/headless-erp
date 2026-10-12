<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { BadgeEuro, Check, ClipboardList, Eye, PenLine, Printer, Stamp, Trash2 } from 'lucide-vue-next';
import type { Address, Invoice, Line } from '../lib/api';
import { tapi } from '../lib/tenant';
import { date, euro, isOverdue, lineTotals, today } from '../lib/format';
import { loadCurrentTenant, state } from '../lib/session';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import LinesEditor from '../components/LinesEditor.vue';
import PrintDocument from '../components/PrintDocument.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const invoice = ref<Invoice | null>(null);
const lines = ref<Line[]>([]);
const preview = ref(false);
const busy = ref('');
const error = ref('');
type Party = { name?: string; address?: Address | null; vat_number?: string | null };
const customer = ref<Party | null>(null);
const print = () => window.print();

function fill(inv: Invoice) {
  invoice.value = inv;
  lines.value = inv.lines.map((l) => ({ ...l }));
}

onMounted(async () => {
  try {
    await loadCurrentTenant();
    fill(await tapi<Invoice>(`/invoices/${props.id}`));
    // Concept: actuele klantgegevens. Definitief: wat er bij uitgifte is vastgelegd.
    customer.value = invoice.value!.customer_snapshot ?? (await tapi<Party>(`/customers/${invoice.value!.customer.id}`));
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const concept = computed(() => invoice.value?.status === 'concept');
const totals = computed(() => (concept.value || !invoice.value ? lineTotals(lines.value) : invoice.value));
const canSave = computed(() => lines.value.every((l) => l.description.trim() && Number(l.quantity) > 0));

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

const payload = () => ({
  lines: lines.value.map(({ item_id: _i, ...l }) => ({ ...l, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
});
const save = () => run('save', async () => fill(await tapi<Invoice>(`/invoices/${props.id}`, { method: 'PATCH', json: payload() })));

const finalizeDialog = ref<HTMLDialogElement | null>(null);
const finalize = () =>
  run('finalize', async () => {
    await tapi(`/invoices/${props.id}`, { method: 'PATCH', json: payload() });
    fill(await tapi<Invoice>(`/invoices/${props.id}/finalize`, { method: 'POST' }));
    customer.value = invoice.value!.customer_snapshot;
    finalizeDialog.value?.close();
    preview.value = false;
  });

const remove = () =>
  run('remove', async () => {
    if (!confirm('Conceptfactuur verwijderen? Uren en materiaal komen weer vrij.')) return;
    const jobId = invoice.value?.job?.id;
    await tapi(`/invoices/${props.id}`, { method: 'DELETE' });
    await router.replace(jobId ? `/opdrachten/${jobId}` : '/facturen');
  });

const payDialog = ref<HTMLDialogElement | null>(null);
const pay = reactive({ amount: 0 as number | null, paid_on: today(), method: 'bank' });
function openPay() {
  Object.assign(pay, { amount: invoice.value?.open_amount ?? 0, paid_on: today(), method: 'bank' });
  payDialog.value?.showModal();
}
const registerPayment = () =>
  run('pay', async () => {
    fill(await tapi<Invoice>(`/invoices/${props.id}/payments`, { method: 'POST', json: { ...pay } }));
    payDialog.value?.close();
  });

const iban = computed(() => state.tenant?.iban);
const footer = computed(() =>
  invoice.value && !concept.value && invoice.value.status !== 'betaald'
    ? `Graag ${euro(invoice.value.total_incl)} overmaken vóór ${date(invoice.value.due_on)}${iban.value ? ` op ${iban.value}` : ''} o.v.v. factuurnummer ${invoice.value.number}.`
    : undefined,
);
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-32 sm:px-6 sm:pt-8">
    <PageHeader :title="invoice?.number ?? 'Conceptfactuur'" :subtitle="invoice ? `Factuur voor ${invoice.customer.name}` : undefined" back="/facturen">
      <span v-if="invoice && isOverdue(invoice.due_on, invoice.status)" class="badge badge-error">Te laat</span>
      <StatusBadge v-else-if="invoice" type="invoice" :status="invoice.status" />
    </PageHeader>
    <ErrorAlert :message="error" />

    <template v-if="invoice">
      <RouterLink v-if="invoice.job" :to="`/opdrachten/${invoice.job.id}`" class="btn btn-soft btn-sm no-print mb-4 self-start">
        <ClipboardList class="size-4" /> {{ invoice.job.title }}
      </RouterLink>

      <section v-if="concept && !preview">
        <p class="text-base-content/60 mb-3 text-sm">Controleer de regels. Na definitief maken krijgt de factuur een nummer en ligt hij vast.</p>
        <LinesEditor v-model="lines" />
      </section>

      <PrintDocument
        v-else
        kind="Factuur"
        :number="invoice.number"
        :tenant="state.tenant"
        :customer="customer"
        :lines="concept ? lines : invoice.lines"
        :totals="totals"
        :footer="footer"
        :meta="[
          { label: 'Factuurdatum', value: date(invoice.issued_on) || date(today()) },
          { label: 'Vervaldatum', value: date(invoice.due_on) },
        ]"
      />

      <section v-if="invoice.payments.length" class="no-print mt-4">
        <h2 class="mb-2 font-semibold">Betalingen</h2>
        <ul class="bg-base-100 rounded-box divide-base-200 divide-y text-sm shadow-sm">
          <li v-for="p in invoice.payments" :key="p.id" class="flex justify-between p-3">
            <span>{{ date(p.paid_on) }}<span v-if="p.method" class="text-base-content/50"> · {{ p.method }}</span></span>
            <span class="tabular-nums">{{ euro(p.amount) }}</span>
          </li>
          <li class="flex justify-between p-3 font-semibold"><span>Nog open</span><span class="tabular-nums">{{ euro(invoice.open_amount) }}</span></li>
        </ul>
      </section>
    </template>

    <div v-if="invoice" class="no-print bg-base-200/95 border-base-300 fixed inset-x-0 bottom-0 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div class="mx-auto flex max-w-3xl gap-2">
        <template v-if="concept">
          <button class="btn btn-ghost btn-square btn-lg" :aria-label="preview ? 'Bewerken' : 'Voorbeeld'" @click="preview = !preview">
            <PenLine v-if="preview" class="size-5" /><Eye v-else class="size-5" />
          </button>
          <button class="btn btn-lg" :disabled="!canSave || !!busy" @click="save">
            <span v-if="busy === 'save'" class="loading loading-spinner" /><Check v-else class="size-5" /> Opslaan
          </button>
          <button class="btn btn-primary btn-lg flex-1" :disabled="!canSave || !lines.length || !!busy" @click="finalizeDialog?.showModal()">
            <Stamp class="size-5" /> Definitief
          </button>
        </template>
        <template v-else>
          <button class="btn btn-lg" :class="{ 'flex-1': invoice.status === 'betaald' }" @click="print"><Printer class="size-5" /> Afdrukken / PDF</button>
          <button v-if="invoice.status !== 'betaald'" class="btn btn-primary btn-lg flex-1" @click="openPay"><BadgeEuro class="size-5" /> Betaald</button>
        </template>
      </div>
      <div v-if="concept" class="mx-auto mt-1 flex max-w-3xl">
        <button class="btn btn-ghost btn-xs text-error" @click="remove"><Trash2 class="size-3" /> Concept verwijderen</button>
      </div>
    </div>

    <dialog ref="finalizeDialog" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 class="text-lg font-bold">Factuur definitief maken?</h2>
        <p class="text-base-content/70 my-3">
          De factuur van {{ euro(totals.total_incl) }} krijgt een doorlopend nummer en de datum van vandaag. Daarna kun je hem niet meer wijzigen; corrigeren gaat met een creditfactuur.
        </p>
        <div class="modal-action">
          <form method="dialog"><button class="btn btn-ghost">Nog niet</button></form>
          <button class="btn btn-primary" :disabled="busy === 'finalize'" @click="finalize">
            <span v-if="busy === 'finalize'" class="loading loading-spinner" /> Definitief maken
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
    </dialog>

    <dialog ref="payDialog" class="modal modal-bottom sm:modal-middle">
      <form class="modal-box flex flex-col gap-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]" @submit.prevent="registerPayment">
        <h2 class="text-lg font-bold">Betaling ontvangen</h2>
        <label class="input input-lg w-full">
          <span class="opacity-50">€</span>
          <input v-model.number="pay.amount" type="number" inputmode="decimal" step="0.01" min="0.01" required aria-label="Bedrag" />
        </label>
        <input v-model="pay.paid_on" type="date" class="input w-full" aria-label="Datum" required />
        <div class="join w-full">
          <input v-for="m in ['bank', 'pin', 'contant']" :key="m" v-model="pay.method" :value="m" type="radio" name="method" class="join-item btn flex-1 capitalize" :aria-label="m" />
        </div>
        <button class="btn btn-primary btn-lg" :disabled="!pay.amount || busy === 'pay'">
          <span v-if="busy === 'pay'" class="loading loading-spinner" /> Vastleggen
        </button>
      </form>
      <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
    </dialog>
  </main>
</template>
