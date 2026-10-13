<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ArrowLeft, Check, Plus, Search } from 'lucide-vue-next';
import type { Item, ItemKind, VatRate } from '../lib/api';
import { tapi } from '../lib/tenant';
import { euro } from '../lib/format';

// Artikel kiezen in een bottom sheet. open(kinds) toont alleen die soorten.
// Staat het artikel er niet bij, dan maak je het hier meteen aan.
const emit = defineEmits<{ pick: [item: Item] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const items = ref<Item[]>([]);
const kinds = ref<ItemKind[] | null>(null);
const search = ref('');
const loading = ref(false);

async function open(only?: ItemKind[]) {
  kinds.value = only ?? null;
  search.value = '';
  adding.value = false;
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

// Nieuw artikel: alleen het hoogstnodige, de rest kan later bij Artikelen.
const adding = ref(false);
const busy = ref(false);
const error = ref('');
const draft = reactive({ kind: 'materiaal' as ItemKind, name: '', unit: 'stuk', sale_price: null as number | null, vat_rate: 21 as VatRate });
const draftKinds = computed(() => kinds.value ?? (['materiaal', 'arbeid', 'overig'] as ItemKind[]));
const units = computed(() => (draft.kind === 'arbeid' ? ['uur', 'dag', 'm2'] : draft.kind === 'materiaal' ? ['stuk', 'liter', 'm2', 'm1', 'kg', 'zak'] : ['keer', 'stuk', 'post']));

function startAdding() {
  const kind = draftKinds.value[0] ?? 'materiaal';
  Object.assign(draft, { kind, name: search.value.trim(), unit: kind === 'arbeid' ? 'uur' : kind === 'materiaal' ? 'stuk' : 'keer', sale_price: null, vat_rate: 21 });
  error.value = '';
  adding.value = true;
}

async function create() {
  busy.value = true;
  error.value = '';
  try {
    const item = await tapi<Item>('/items', {
      method: 'POST',
      json: { kind: draft.kind, name: draft.name.trim(), unit: draft.unit.trim(), sale_price: draft.sale_price ?? 0, vat_rate: draft.vat_rate },
    });
    items.value.push(item);
    pick(item);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <dialog ref="dialog" class="modal modal-bottom sm:modal-middle">
    <form v-if="adding" class="modal-box flex flex-col gap-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]" @submit.prevent="create">
      <div class="flex items-center gap-2">
        <button type="button" class="btn btn-ghost btn-sm btn-square" aria-label="Terug" @click="adding = false"><ArrowLeft class="size-5" /></button>
        <h2 class="text-lg font-bold">Nieuw artikel</h2>
      </div>
      <div v-if="draftKinds.length > 1" class="join w-full">
        <button v-for="k in draftKinds" :key="k" type="button" class="join-item btn flex-1" :class="{ 'btn-primary': draft.kind === k }" @click="draft.kind = k; draft.unit = units[0] ?? 'stuk'">{{ kindLabel[k] }}</button>
      </div>
      <label class="floating-label">
        <span>Naam *</span>
        <input v-model="draft.name" class="input input-lg w-full" placeholder="Bijv. Sikkens Rubbol BL Azura" required />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="floating-label">
          <span>Prijs excl. btw</span>
          <label class="input input-lg w-full">
            <span class="opacity-50">€</span>
            <input v-model.number="draft.sale_price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0,00" />
          </label>
        </label>
        <label class="floating-label">
          <span>Per</span>
          <input v-model="draft.unit" list="picker-units" class="input input-lg w-full" placeholder="Eenheid" required />
          <datalist id="picker-units"><option v-for="u in units" :key="u" :value="u" /></datalist>
        </label>
      </div>
      <div class="join w-full">
        <input v-for="r in [21, 9, 0]" :key="r" v-model.number="draft.vat_rate" :value="r" type="radio" name="picker-vat" class="join-item btn flex-1" :aria-label="`${r}% btw`" />
      </div>
      <p v-if="error" class="text-error text-sm">{{ error }}</p>
      <button class="btn btn-primary btn-lg" :disabled="busy || !draft.name.trim() || !draft.unit.trim()">
        <span v-if="busy" class="loading loading-spinner" /><Check v-else class="size-5" /> Opslaan en kiezen
      </button>
    </form>

    <div v-else class="modal-box flex max-h-[85dvh] flex-col p-0">
      <div class="p-4 pb-2">
        <h2 class="mb-3 text-lg font-bold">Kies een artikel</h2>
        <label class="input w-full">
          <Search class="size-4 opacity-50" />
          <input v-model="search" type="search" placeholder="Zoek op naam, merk of code" />
        </label>
        <button type="button" class="btn btn-soft btn-primary mt-3 w-full" @click="startAdding">
          <Plus class="size-5" /> Nieuw artikel<template v-if="search.trim()">: "{{ search.trim() }}"</template>
        </button>
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
          {{ search.trim() ? 'Niets gevonden.' : 'Nog geen artikelen.' }} Maak er hierboven een aan.
        </li>
      </ul>
    </div>
    <form method="dialog" class="modal-backdrop"><button>Sluiten</button></form>
  </dialog>
</template>
