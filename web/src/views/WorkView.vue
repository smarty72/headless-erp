<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { CircleCheck, ClipboardPlus, Play, Square } from 'lucide-vue-next';
import type { JobSummary, RunningTimer } from '../lib/api';
import { tapi } from '../lib/tenant';
import { hours, shortDate } from '../lib/format';
import { useElapsed } from '../lib/elapsed';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import EmptyState from '../components/EmptyState.vue';

// Aan het werk: timer op een klus starten of stoppen, in zo min mogelijk tikken.
const timer = ref<RunningTimer | null>(null);
const jobs = ref<JobSummary[]>([]);
const loading = ref(true);
const busy = ref('');
const error = ref('');
const booked = ref<{ hours: number; title: string } | null>(null);
const elapsed = useElapsed(() => timer.value?.started_at ?? null);

async function load() {
  const [t, j] = await Promise.all([
    tapi<{ timer: RunningTimer | null }>('/timer'),
    tapi<JobSummary[]>('/jobs?status=open'),
  ]);
  timer.value = t.timer;
  jobs.value = j;
}

onMounted(async () => {
  try {
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

async function start(job: JobSummary) {
  busy.value = job.id;
  error.value = '';
  booked.value = null;
  try {
    timer.value = await tapi<RunningTimer>('/timer/start', { method: 'POST', json: { job_id: job.id } });
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}

async function stop() {
  busy.value = 'stop';
  error.value = '';
  try {
    const title = timer.value?.job.title ?? '';
    const entry = await tapi<{ hours: number }>('/timer/stop', { method: 'POST' });
    booked.value = { hours: entry.hours, title };
    timer.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader title="Aan het werk" />
    <ErrorAlert :message="error" />

    <div v-if="loading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg" /></div>

    <template v-else>
      <section v-if="timer" class="bg-primary text-primary-content rounded-box mb-6 flex flex-col items-center gap-2 p-6 text-center shadow-md">
        <p class="text-sm opacity-80">Bezig op</p>
        <RouterLink :to="`/opdrachten/${timer.job.id}`" class="text-xl font-bold underline-offset-4 hover:underline">{{ timer.job.title }}</RouterLink>
        <p class="opacity-90">{{ timer.job.customer.name }}</p>
        <p class="my-3 text-5xl font-semibold tabular-nums">{{ elapsed }}</p>
        <button class="btn btn-lg w-full max-w-xs border-0 bg-white/95 text-black hover:bg-white" :disabled="busy === 'stop'" @click="stop">
          <span v-if="busy === 'stop'" class="loading loading-spinner" /><Square v-else class="size-5 fill-current" /> Stoppen
        </button>
        <p class="text-xs opacity-70">Afgerond op een kwartier.</p>
      </section>

      <div v-if="booked" role="status" class="alert alert-success alert-soft mb-6">
        <CircleCheck class="size-5" /> {{ hours(booked.hours) }} geboekt op {{ booked.title }}.
      </div>

      <h2 v-if="jobs.some((x) => x.id !== timer?.job.id)" class="text-base-content/70 mb-2 text-sm font-semibold">{{ timer ? 'Overstappen naar een andere klus' : 'Op welke klus ga je aan de slag?' }}</h2>
      <div class="flex flex-col gap-3">
        <button
          v-for="j in jobs.filter((x) => x.id !== timer?.job.id)"
          :key="j.id"
          class="bg-base-100 rounded-box flex items-center gap-3 p-4 text-left shadow-sm active:scale-[0.99]"
          :disabled="!!busy"
          @click="start(j)"
        >
          <span class="bg-primary/10 text-primary grid size-12 shrink-0 place-items-center rounded-full">
            <span v-if="busy === j.id" class="loading loading-spinner" /><Play v-else class="size-5 fill-current" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold">{{ j.title }}</span>
            <span class="text-base-content/60 block truncate text-sm">{{ j.customer.name }}<template v-if="j.starts_on"> · {{ shortDate(j.starts_on) }}</template></span>
          </span>
          <StatusBadge type="job" :status="j.status" />
        </button>
      </div>

      <EmptyState v-if="!jobs.length" :icon="ClipboardPlus" title="Nog geen klussen" text="Maak een opdracht aan, of accepteer een offerte. Dan kun je hier je uren starten.">
        <RouterLink to="/opdrachten/nieuw" class="btn btn-primary mt-2">Nieuwe opdracht</RouterLink>
      </EmptyState>
      <RouterLink v-else to="/opdrachten/nieuw" class="btn btn-ghost mt-4">Andere klus? Nieuwe opdracht</RouterLink>
    </template>
  </main>
</template>
