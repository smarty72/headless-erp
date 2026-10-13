<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Building2, ChevronRight, ClipboardList, ClipboardPlus, Ellipsis, FileText, LogOut, Package, Receipt, Search, Timer, User, UserPlus, Users, X } from 'lucide-vue-next';
import type { Overview, SearchResults } from '../lib/api';
import { tapi } from '../lib/tenant';
import { euro, hours } from '../lib/format';
import { useElapsed } from '../lib/elapsed';
import StatusBadge from '../components/StatusBadge.vue';
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

// Zoeken op klantnaam of project; de API zoekt in klanten, opdrachten en offertes.
const query = ref('');
const results = ref<SearchResults | null>(null);
const searching = ref(false);
let debounce: ReturnType<typeof setTimeout> | undefined;
let lastQuery = '';
watch(query, (q) => {
  clearTimeout(debounce);
  const term = q.trim();
  if (term.length < 2) {
    results.value = null;
    return;
  }
  searching.value = true;
  debounce = setTimeout(async () => {
    lastQuery = term;
    try {
      const r = await tapi<SearchResults>(`/search?q=${encodeURIComponent(term)}`);
      if (lastQuery === term) results.value = r;
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      if (lastQuery === term) searching.value = false;
    }
  }, 250);
});
const nothingFound = computed(() => results.value && !results.value.customers.length && !results.value.jobs.length && !results.value.quotes.length);

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
    <header class="mb-5 flex items-center gap-3">
      <div class="bg-base-100 grid size-12 shrink-0 place-items-center overflow-hidden rounded-box shadow-sm">
        <img v-if="tenant?.logo_url" :src="tenant.logo_url" alt="" class="size-full object-contain p-1" />
        <span v-else class="text-primary font-bold">{{ initials }}</span>
      </div>
      <div class="min-w-0">
        <p class="truncate font-semibold">{{ tenant?.name ?? '…' }}</p>
        <p class="text-base-content/60 text-sm">{{ greeting }}{{ firstName ? `, ${firstName}` : '' }}</p>
      </div>
    </header>

    <div class="relative mb-6">
      <label class="input input-lg bg-base-100 w-full border-0 shadow-sm">
        <Search class="size-5 opacity-50" />
        <input v-model="query" type="text" inputmode="search" placeholder="Zoek klant of project" aria-label="Zoek klant of project" enterkeyhint="search" />
        <span v-if="searching" class="loading loading-spinner loading-sm opacity-50" />
        <button v-else-if="query" type="button" class="btn btn-ghost btn-sm btn-circle" aria-label="Wissen" @click="query = ''"><X class="size-4" /></button>
      </label>

      <div v-if="results" class="bg-base-100 rounded-box absolute inset-x-0 top-full z-20 mt-2 max-h-[70dvh] overflow-y-auto shadow-lg">
        <p v-if="nothingFound" class="text-base-content/60 p-4 text-sm">Niets gevonden voor "{{ query.trim() }}".</p>
        <ul class="menu w-full p-2">
          <template v-if="results.customers.length">
            <li class="menu-title">Klanten</li>
            <li v-for="c in results.customers" :key="c.id">
              <RouterLink :to="`/klanten/${c.id}`" class="py-3">
                <User class="size-5 opacity-60" />
                <span class="min-w-0 flex-1 truncate">{{ c.name }}<span v-if="c.city" class="text-base-content/50"> · {{ c.city }}</span></span>
              </RouterLink>
            </li>
          </template>
          <template v-if="results.jobs.length">
            <li class="menu-title">Opdrachten</li>
            <li v-for="j in results.jobs" :key="j.id">
              <RouterLink :to="`/opdrachten/${j.id}`" class="py-3">
                <ClipboardList class="size-5 opacity-60" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ j.title }}</span>
                  <span class="text-base-content/50 block truncate text-xs">{{ j.customer.name }}</span>
                </span>
                <StatusBadge type="job" :status="j.status" />
              </RouterLink>
            </li>
          </template>
          <template v-if="results.quotes.length">
            <li class="menu-title">Offertes</li>
            <li v-for="o in results.quotes" :key="o.id">
              <RouterLink :to="`/offertes/${o.id}`" class="py-3">
                <FileText class="size-5 opacity-60" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate">{{ o.title || o.number || 'Offerte' }}</span>
                  <span class="text-base-content/50 block truncate text-xs">{{ [o.number, o.customer.name].filter(Boolean).join(' · ') }}</span>
                </span>
                <StatusBadge type="quote" :status="o.status" />
              </RouterLink>
            </li>
          </template>
        </ul>
      </div>
    </div>

    <div v-if="error" role="alert" class="alert alert-error alert-soft mb-6">{{ error }}</div>

    <div class="grid grid-cols-2 gap-4">
      <RouterLink
        to="/aan-het-werk"
        class="btn btn-primary col-span-2 h-auto min-h-32 flex-col gap-2 rounded-box text-xl shadow-md sm:min-h-40"
      >
        <Timer class="size-10" :stroke-width="1.75" :class="{ 'animate-pulse': overview?.timer }" />
        <template v-if="overview?.timer">
          <span class="text-3xl font-semibold tabular-nums">{{ elapsed }}</span>
          <span class="max-w-full truncate text-sm font-normal opacity-90">{{ [overview.timer.job.title, overview.timer.note, overview.timer.job.customer.name].filter(Boolean).join(' · ') }}</span>
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
