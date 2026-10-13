<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronRight, Package, Search, TriangleAlert } from 'lucide-vue-next';
import type { Item, ItemKind } from '../lib/api';
import { tapi } from '../lib/tenant';
import { amount, euro } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import EmptyState from '../components/EmptyState.vue';
import Fab from '../components/Fab.vue';

const items = ref<Item[]>([]);
const kind = ref<ItemKind | 'alles'>('alles');
const search = ref('');
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    items.value = await tapi<Item[]>('/items');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

const tabs: { key: ItemKind | 'alles'; label: string }[] = [
  { key: 'alles', label: 'Alles' },
  { key: 'arbeid', label: 'Arbeid' },
  { key: 'materiaal', label: 'Materiaal' },
  { key: 'overig', label: 'Overig' },
];
const low = (i: Item) => i.track_stock && i.min_stock !== null && i.stock_quantity < i.min_stock;
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter(
    (i) => (kind.value === 'alles' || i.kind === kind.value) && (!q || [i.name, i.brand, i.sku].some((v) => v?.toLowerCase().includes(q))),
  );
});
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-28 sm:px-6 sm:pt-8">
    <PageHeader title="Artikelen en tarieven" subtitle="Prijzen exclusief btw" />
    <div role="tablist" class="tabs tabs-box mb-3 grid grid-cols-4">
      <button v-for="t in tabs" :key="t.key" role="tab" class="tab" :class="{ 'tab-active': kind === t.key }" @click="kind = t.key">{{ t.label }}</button>
    </div>
    <label class="input mb-4 w-full">
      <Search class="size-4 opacity-50" />
      <input v-model="search" type="search" placeholder="Zoek op naam, merk of code" />
    </label>
    <ErrorAlert :message="error" />
    <div v-if="loading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg" /></div>

    <ul v-else-if="filtered.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
      <li v-for="i in filtered" :key="i.id">
        <RouterLink :to="`/artikelen/${i.id}`" class="flex items-center gap-3 p-4">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ [i.brand, i.name].filter(Boolean).join(' ') }}</span>
            <span class="text-base-content/60 flex items-center gap-1 text-sm">
              {{ euro(i.sale_price) }} / {{ i.unit }} · {{ i.vat_rate }}% btw
              <template v-if="i.track_stock">
                · <span :class="{ 'text-warning font-semibold': low(i) }">voorraad {{ amount(i.stock_quantity) }}</span>
                <TriangleAlert v-if="low(i)" class="text-warning size-4" />
              </template>
            </span>
          </span>
          <ChevronRight class="size-4 opacity-40" />
        </RouterLink>
      </li>
    </ul>
    <EmptyState v-else :icon="Package" title="Geen artikelen" text="Leg je uurtarieven, materialen en vaste posten vast. Dan heb je ze met één tik op een offerte." />

    <Fab to="/artikelen/nieuw" label="Artikel" />
  </main>
</template>
