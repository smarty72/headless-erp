<script setup lang="ts">
import { computed, ref } from 'vue';
import { Search } from 'lucide-vue-next';
import type { Item, ItemKind } from '../lib/api';
import { tapi } from '../lib/tenant';
import { euro } from '../lib/format';

// Artikel kiezen in een bottom sheet. open(kinds) toont alleen die soorten.
const emit = defineEmits<{ pick: [item: Item] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const items = ref<Item[]>([]);
const kinds = ref<ItemKind[] | null>(null);
const search = ref('');
const loading = ref(false);

async function open(only?: ItemKind[]) {
  kinds.value = only ?? null;
  search.value = '';
  dialog.value?.showModal();
  if (!items.value.length) {
    loading.value = true;
    try {
      items.value = await tapi<Item[]>('/items');
    } finally {
      loading.value = false;
    }
  }
}
defineExpose({ open });

const kindLabel: Record<ItemKind, string> = { arbeid: 'Arbeid', materiaal: 'Materiaal', overig: 'Overig' };
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return items.value.filter(
    (i) =>
      (!kinds.value || kinds.value.includes(i.kind)) &&
      (!q || [i.name, i.brand, i.sku].some((v) => v?.toLowerCase().includes(q))),
  );
});

function pick(item: Item) {
  emit('pick', item);
  dialog.value?.close();
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle">
    <div class="modal-box flex max-h-[85dvh] flex-col p-0">
      <div class="p-4 pb-2">
        <h2 class="mb-3 text-lg font-bold">Kies een artikel</h2>
        <label class="input w-full">
          <Search class="size-4 opacity-50" />
          <input v-model="search" type="search" placeholder="Zoek op naam, merk of code" />
        </label>
      </div>
      <ul class="menu w-full flex-nowrap overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <li v-if="loading" class="p-4"><span class="loading loading-spinner mx-auto" /></li>
        <li v-for="i in filtered" :key="i.id">
          <button type="button" class="py-3" @click="pick(i)">
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate font-medium">{{ [i.brand, i.name].filter(Boolean).join(' ') }}</span>
              <span class="text-base-content/50 text-xs">
                {{ kindLabel[i.kind] }}<template v-if="i.track_stock"> · voorraad {{ i.stock_quantity }}</template>
              </span>
            </span>
            <span class="text-sm whitespace-nowrap">{{ euro(i.sale_price) }} / {{ i.unit }}</span>
          </button>
        </li>
        <li v-if="!loading && !filtered.length" class="text-base-content/60 p-4 text-sm">
          Geen artikelen. Voeg ze toe via Meer › Artikelen en tarieven.
        </li>
      </ul>
    </div>
    <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
  </dialog>
</template>
