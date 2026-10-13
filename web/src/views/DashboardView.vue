<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Building2, ChevronRight, ClipboardList, ClipboardPlus, Ellipsis, FileText, LogOut, Package, Receipt, Timer, UserPlus, Users } from 'lucide-vue-next';
import type { Overview } from '../lib/api';
import { tapi } from '../lib/tenant';
import { euro, hours } from '../lib/format';
import { useElapsed } from '../lib/elapsed';
import { loadCurrentTenant, signOut, state } from '../lib/session';

const router = useRouter();
const error = ref('');
const more = ref<HTMLDialogElement | null>(null);
const overview = ref<Overview | null>(null);

onMounted(async () => {
  try {
    await loadCurrentTenant();
    overview.value = await tapi<Overview>('/overview');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const elapsed = useElapsed(() => overview.value?.timer?.started_at ?? null);

const tenant = computed(() => state.tenant);
const firstName = computed(() => tenant.value?.contact_name?.split(' ')[0]);
const initials = computed(() =>
  (tenant.value?.name ?? '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join(''),
);
const greeting = computed(() => {
  const h = new Date().getHours();
  return h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond';
});

const links = [
  { to: '/klanten', label: 'Klanten', icon: Users },
  { to: '/offertes', label: 'Offertes', icon: FileText },
  { to: '/opdrachten', label: 'Opdrachten', icon: ClipboardList },
  { to: '/facturen', label: 'Facturen', icon: Receipt },
  { to: '/artikelen', label: 'Artikelen en tarieven', icon: Package },
  { to: '/bedrijf', label: 'Bedrijfsgegevens', icon: Building2 },
];

async function logout() {
  more.value?.close();
  await signOut();
  await router.replace('/login');
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-6 pb-10 sm:px-6 sm:pt-10">
    <header class="mb-8 flex items-center gap-3">
      <div class="bg-base-100 grid size-12 shrink-0 place-items-center overflow-hidden rounded-box shadow-sm">
        <img v-if="tenant?.logo_url" :src="tenant.logo_url" alt="" class="size-full object-contain p-1" />
        <span v-else class="text-primary font-bold">{{ initials }}</span>
      </div>
      <div class="min-w-0">
        <p class="truncate font-semibold">{{ tenant?.name ?? '…' }}</p>
        <p class="text-base-content/60 text-sm">{{ greeting }}{{ firstName ? `, ${firstName}` : '' }}</p>
      </div>
    </header>

    <div v-if="error" role="alert" class="alert alert-error alert-soft mb-6">{{ error }}</div>

    <div class="grid grid-cols-2 gap-4">
      <RouterLink
        to="/aan-het-werk"
        class="btn btn-primary col-span-2 h-auto min-h-32 flex-col gap-2 rounded-box text-xl shadow-md sm:min-h-40"
      >
        <Timer class="size-10" :stroke-width="1.75" :class="{ 'animate-pulse': overview?.timer }" />
        <template v-if="overview?.timer">
          <span class="text-3xl font-semibold tabular-nums">{{ elapsed }}</span>
          <span class="max-w-full truncate text-sm font-normal opacity-90">{{ overview.timer.job.title }} · {{ overview.timer.job.customer.name }}</span>
        </template>
        <template v-else>
          Aan het werk
          <span class="text-sm font-normal opacity-80">Start je uren op een klus</span>
        </template>
      </RouterLink>

      <RouterLink to="/klanten/nieuw" class="btn bg-base-100 h-auto min-h-32 flex-col gap-2 rounded-box border-0 text-lg shadow-sm">
        <UserPlus class="text-primary size-9" :stroke-width="1.75" />
        Nieuwe klant
      </RouterLink>

      <RouterLink to="/opdrachten/nieuw" class="btn bg-base-100 h-auto min-h-32 flex-col gap-2 rounded-box border-0 text-lg shadow-sm">
        <ClipboardPlus class="text-primary size-9" :stroke-width="1.75" />
        Nieuwe opdracht
      </RouterLink>

      <button
        type="button"
        class="btn bg-base-100 col-span-2 h-auto min-h-16 gap-3 rounded-box border-0 text-lg shadow-sm"
        @click="more?.showModal()"
      >
        <Ellipsis class="size-6" /> Meer
      </button>
    </div>

    <div v-if="overview" class="mt-6 grid grid-cols-3 gap-3 text-center">
      <RouterLink to="/opdrachten" class="bg-base-100 rounded-box p-3 shadow-sm">
        <p class="text-2xl font-bold">{{ overview.open_jobs }}</p>
        <p class="text-base-content/60 text-xs">Lopende klussen</p>
      </RouterLink>
      <RouterLink to="/offertes" class="bg-base-100 rounded-box p-3 shadow-sm">
        <p class="text-2xl font-bold">{{ overview.open_quotes }}</p>
        <p class="text-base-content/60 text-xs">Offertes uit</p>
      </RouterLink>
      <RouterLink to="/facturen" class="bg-base-100 rounded-box p-3 shadow-sm">
        <p class="truncate text-2xl font-bold">{{ euro(overview.unpaid_amount).replace(/,00$/, '') }}</p>
        <p class="text-base-content/60 text-xs">Openstaand</p>
      </RouterLink>
    </div>
    <p v-if="overview" class="text-base-content/60 mt-3 text-center text-sm">Deze week: {{ hours(overview.hours_this_week) }}</p>

    <dialog ref="more" class="modal modal-bottom sm:modal-middle">
      <div class="modal-box pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 class="mb-2 text-lg font-bold">Meer</h2>
        <ul class="menu w-full gap-1 p-0 text-base">
          <li v-for="l in links" :key="l.to">
            <RouterLink :to="l.to" class="py-3"><component :is="l.icon" class="size-5" /> {{ l.label }} <ChevronRight class="ml-auto size-4 opacity-50" /></RouterLink>
          </li>
          <li>
            <button type="button" class="text-error py-3" @click="logout"><LogOut class="size-5" /> Uitloggen</button>
          </li>
        </ul>
      </div>
      <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
    </dialog>
  </main>
</template>
