<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ChevronRight, ClipboardList } from 'lucide-vue-next';
import type { JobSummary } from '../lib/api';
import { tapi } from '../lib/tenant';
import { shortDate } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import EmptyState from '../components/EmptyState.vue';
import Fab from '../components/Fab.vue';

const jobs = ref<JobSummary[]>([]);
const filter = ref<'open' | 'gefactureerd' | 'geannuleerd'>('open');
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  try {
    jobs.value = await tapi<JobSummary[]>(`/jobs?status=${filter.value}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(filter, load);

const filters = [
  { key: 'open', label: 'Lopend' },
  { key: 'gefactureerd', label: 'Gefactureerd' },
  { key: 'geannuleerd', label: 'Geannuleerd' },
] as const;
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-28 sm:px-6 sm:pt-8">
    <PageHeader title="Opdrachten" />
    <div class="mb-4 flex gap-2 overflow-x-auto">
      <button v-for="f in filters" :key="f.key" class="btn btn-sm rounded-full" :class="filter === f.key ? 'btn-neutral' : 'btn-ghost bg-base-100'" @click="filter = f.key">{{ f.label }}</button>
    </div>
    <ErrorAlert :message="error" />
    <div v-if="loading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg" /></div>

    <ul v-else-if="jobs.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
      <li v-for="j in jobs" :key="j.id">
        <RouterLink :to="`/opdrachten/${j.id}`" class="flex items-center gap-3 p-4">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ j.title }}</span>
            <span class="text-base-content/60 block truncate text-sm">{{ j.customer.name }}<template v-if="j.starts_on"> · {{ shortDate(j.starts_on) }}</template></span>
          </span>
          <StatusBadge type="job" :status="j.status" />
          <ChevronRight class="size-4 opacity-40" />
        </RouterLink>
      </li>
    </ul>
    <EmptyState v-else :icon="ClipboardList" title="Geen opdrachten" text="Een opdracht ontstaat uit een geaccepteerde offerte, of je start hem direct als regiewerk." />

    <Fab to="/opdrachten/nieuw" label="Opdracht" />
  </main>
</template>
