<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronRight, Receipt } from 'lucide-vue-next';
import type { InvoiceSummary } from '../lib/api';
import { tapi } from '../lib/tenant';
import { date, euro, isOverdue } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import EmptyState from '../components/EmptyState.vue';

const invoices = ref<InvoiceSummary[]>([]);
const filter = ref<'open' | 'concept' | 'betaald' | 'alles'>('open');
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    invoices.value = await tapi<InvoiceSummary[]>('/invoices');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

const filters = [
  { key: 'open', label: 'Openstaand' },
  { key: 'concept', label: 'Concept' },
  { key: 'betaald', label: 'Betaald' },
  { key: 'alles', label: 'Alles' },
] as const;
const filtered = computed(() =>
  invoices.value.filter((f) =>
    filter.value === 'alles' ? true : filter.value === 'open' ? f.status === 'definitief' || f.status === 'vervallen' : f.status === filter.value,
  ),
);
const openTotal = computed(() => invoices.value.reduce((s, f) => s + f.open_amount, 0));
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader title="Facturen" :subtitle="`Openstaand ${euro(openTotal)}`" />
    <div class="mb-4 flex gap-2 overflow-x-auto">
      <button v-for="f in filters" :key="f.key" class="btn btn-sm rounded-full" :class="filter === f.key ? 'btn-neutral' : 'btn-ghost bg-base-100'" @click="filter = f.key">{{ f.label }}</button>
    </div>
    <ErrorAlert :message="error" />
    <div v-if="loading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg" /></div>

    <ul v-else-if="filtered.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
      <li v-for="f in filtered" :key="f.id">
        <RouterLink :to="`/facturen/${f.id}`" class="flex items-center gap-3 p-4">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ f.customer.name }}</span>
            <span class="text-base-content/60 text-sm" :class="{ 'text-error font-semibold': isOverdue(f.due_on, f.status) }">
              {{ f.number ?? 'Concept' }}<template v-if="f.due_on"> · vervalt {{ date(f.due_on) }}</template>
            </span>
          </span>
          <span class="flex flex-col items-end gap-1">
            <span class="font-semibold tabular-nums">{{ euro(f.total_incl) }}</span>
            <span v-if="isOverdue(f.due_on, f.status)" class="badge badge-error badge-sm">Te laat</span>
            <StatusBadge v-else type="invoice" :status="f.status" />
          </span>
          <ChevronRight class="size-4 opacity-40" />
        </RouterLink>
      </li>
    </ul>
    <EmptyState v-else :icon="Receipt" title="Geen facturen" text="Maak een factuur vanuit een opdracht: offerte, uren en materiaal komen er vanzelf op." />
  </main>
</template>
