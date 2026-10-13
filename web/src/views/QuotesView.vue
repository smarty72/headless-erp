<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronRight, FileText } from 'lucide-vue-next';
import type { QuoteStatus, QuoteSummary } from '../lib/api';
import { tapi } from '../lib/tenant';
import { date, euro } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import EmptyState from '../components/EmptyState.vue';
import Fab from '../components/Fab.vue';

const quotes = ref<QuoteSummary[]>([]);
const filter = ref<'open' | QuoteStatus | 'alles'>('open');
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    quotes.value = await tapi<QuoteSummary[]>('/quotes');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

const filters = [
  { key: 'open', label: 'Lopend' },
  { key: 'geaccepteerd', label: 'Akkoord' },
  { key: 'afgewezen', label: 'Afgewezen' },
  { key: 'alles', label: 'Alles' },
] as const;
const filtered = computed(() =>
  quotes.value.filter((q) =>
    filter.value === 'alles' ? true : filter.value === 'open' ? q.status === 'concept' || q.status === 'verzonden' : q.status === filter.value,
  ),
);
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-28 sm:px-6 sm:pt-8">
    <PageHeader title="Offertes" />
    <div class="mb-4 flex gap-2 overflow-x-auto">
      <button v-for="f in filters" :key="f.key" class="btn btn-sm rounded-full" :class="filter === f.key ? 'btn-neutral' : 'btn-ghost bg-base-100'" @click="filter = f.key">{{ f.label }}</button>
    </div>
    <ErrorAlert :message="error" />
    <div v-if="loading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg" /></div>

    <ul v-else-if="filtered.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
      <li v-for="q in filtered" :key="q.id">
        <RouterLink :to="`/offertes/${q.id}`" class="flex items-center gap-3 p-4">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ q.customer.name }}<span v-if="q.title" class="text-base-content/60 font-normal"> · {{ q.title }}</span></span>
            <span class="text-base-content/60 text-sm">{{ [q.number, date(q.created_at)].filter(Boolean).join(' · ') }}</span>
          </span>
          <span class="flex flex-col items-end gap-1">
            <span class="font-semibold tabular-nums">{{ euro(q.total_incl) }}</span>
            <StatusBadge type="quote" :status="q.status" />
          </span>
          <ChevronRight class="size-4 opacity-40" />
        </RouterLink>
      </li>
    </ul>
    <EmptyState v-else :icon="FileText" title="Geen offertes" text="Maak een offerte met je eigen tarieven en materialen. Na akkoord wordt het met één tik een opdracht." />

    <Fab to="/offertes/nieuw" label="Offerte" />
  </main>
</template>
