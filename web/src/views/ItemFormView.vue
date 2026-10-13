<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Check, Minus, Plus, Trash2 } from 'lucide-vue-next';
import type { Item, ItemKind, StockMovement } from '../lib/api';
import { tapi } from '../lib/tenant';
import { amount, date } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import ErrorAlert from '../components/ErrorAlert.vue';

const props = defineProps<{ id?: string }>();
const router = useRouter();
const item = ref<Item | null>(null);
const movements = ref<StockMovement[]>([]);
const saving = ref(false);
const error = ref('');

const form = reactive({
  kind: 'materiaal' as ItemKind,
  name: '',
  brand: '',
  sku: '',
  unit: 'stuk',
  purchase_price: null as number | null,
  sale_price: null as number | null,
  vat_rate: 21 as 0 | 9 | 21,
  track_stock: false,
  min_stock: null as number | null,
});
const units = computed(() => (form.kind === 'arbeid' ? ['uur', 'dag', 'm2'] : form.kind === 'materiaal' ? ['stuk', 'liter', 'm2', 'm1', 'kg', 'zak'] : ['keer', 'stuk', 'post']));

async function load() {
  if (!props.id) return;
  item.value = await tapi<Item>(`/items/${props.id}`);
  const i = item.value;
  Object.assign(form, {
    kind: i.kind, name: i.name, brand: i.brand ?? '', sku: i.sku ?? '', unit: i.unit, purchase_price: i.purchase_price,
    sale_price: i.sale_price, vat_rate: i.vat_rate, track_stock: i.track_stock, min_stock: i.min_stock,
  });
  if (i.track_stock) movements.value = await tapi<StockMovement[]>(`/items/${props.id}/stock-movements`);
}
onMounted(() => load().catch((e: Error) => (error.value = e.message)));
// Na aanmaken blijft dit scherm staan (nieuw -> /artikelen/:id): dan opnieuw laden.
watch(() => props.id, () => load().catch((e: Error) => (error.value = e.message)));

function setKind(k: ItemKind) {
  form.kind = k;
  if (!units.value.includes(form.unit)) form.unit = units.value[0] ?? 'stuk';
  if (k !== 'materiaal') form.track_stock = false;
}

async function save() {
  saving.value = true;
  error.value = '';
  const text = (s: string) => s.trim() || undefined;
  const body = {
    kind: form.kind, name: form.name.trim(), brand: text(form.brand), sku: text(form.sku), unit: form.unit.trim(),
    purchase_price: form.purchase_price ?? undefined, sale_price: form.sale_price ?? 0, vat_rate: form.vat_rate,
    track_stock: form.track_stock, min_stock: form.track_stock ? (form.min_stock ?? undefined) : undefined,
  };
  try {
    const saved = props.id
      ? await tapi<Item>(`/items/${props.id}`, { method: 'PATCH', json: body })
      : await tapi<Item>('/items', { method: 'POST', json: body });
    if (props.id) {
      item.value = saved;
      await load();
    } else {
      await router.replace(saved.track_stock ? `/artikelen/${saved.id}` : '/artikelen');
    }
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// Voorraad: inkoop erbij of een telling corrigeren.
const stockQty = ref<number | null>(null);
async function book(reason: 'inkoop' | 'correctie', sign: 1 | -1) {
  if (!stockQty.value) return;
  try {
    await tapi(`/items/${props.id}/stock-movements`, { method: 'POST', json: { quantity: sign * stockQty.value, reason } });
    stockQty.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}

async function archive() {
  if (!confirm('Artikel archiveren? Het blijft op oude offertes en facturen staan.')) return;
  await tapi(`/items/${props.id}`, { method: 'DELETE' });
  await router.replace('/artikelen');
}

const reasonLabel: Record<StockMovement['reason'], string> = {
  beginvoorraad: 'Beginvoorraad', inkoop: 'Inkoop', verbruik: 'Verbruikt op klus', correctie: 'Correctie', retour: 'Retour',
};
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader :title="id ? form.name || 'Artikel' : 'Nieuw artikel'" back="/artikelen" />
    <ErrorAlert :message="error" />

    <section v-if="item?.track_stock" class="bg-base-100 rounded-box mb-6 p-4 shadow-sm">
      <div class="flex items-baseline justify-between">
        <h2 class="font-semibold">Voorraad</h2>
        <p class="text-3xl font-bold tabular-nums" :class="{ 'text-warning': item.min_stock !== null && item.stock_quantity < item.min_stock }">
          {{ amount(item.stock_quantity) }} <span class="text-base font-normal">{{ item.unit }}</span>
        </p>
      </div>
      <div class="mt-3 flex gap-2">
        <input v-model.number="stockQty" type="number" inputmode="decimal" min="0" step="any" class="input w-24" placeholder="Aantal" aria-label="Aantal" />
        <button class="btn btn-primary flex-1" :disabled="!stockQty" @click="book('inkoop', 1)"><Plus class="size-4" /> Inkoop</button>
        <button class="btn" :disabled="!stockQty" title="Telling lager dan gedacht" @click="book('correctie', -1)"><Minus class="size-4" /> Eraf</button>
      </div>
      <ul v-if="movements.length" class="mt-4 text-sm">
        <li v-for="m in movements.slice(0, 8)" :key="m.id" class="border-base-200 flex justify-between border-t py-2">
          <span>{{ reasonLabel[m.reason] }} <span class="text-base-content/50">· {{ date(m.created_at) }}</span></span>
          <span class="tabular-nums" :class="m.quantity < 0 ? 'text-error' : 'text-success'">{{ m.quantity > 0 ? '+' : '' }}{{ amount(m.quantity) }}</span>
        </li>
      </ul>
    </section>

    <form class="flex flex-col gap-4" @submit.prevent="save">
      <div v-if="!id" class="join w-full">
        <button v-for="k in (['arbeid', 'materiaal', 'overig'] as ItemKind[])" :key="k" type="button" class="join-item btn flex-1 capitalize" :class="{ 'btn-primary': form.kind === k }" @click="setKind(k)">{{ k }}</button>
      </div>
      <p v-else class="badge badge-soft badge-primary capitalize">{{ form.kind }}</p>
      <label class="floating-label">
        <span>Naam *</span>
        <input v-model="form.name" class="input input-lg w-full" :placeholder="form.kind === 'arbeid' ? 'Bijv. Schilderwerk binnen' : 'Naam *'" required />
      </label>
      <div v-if="form.kind === 'materiaal'" class="grid grid-cols-2 gap-4">
        <label class="floating-label">
          <span>Merk</span>
          <input v-model="form.brand" class="input input-lg w-full" placeholder="Merk" />
        </label>
        <label class="floating-label">
          <span>Artikelcode</span>
          <input v-model="form.sku" class="input input-lg w-full" placeholder="Artikelcode" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <label class="floating-label">
          <span>Prijs excl. btw *</span>
          <label class="input input-lg w-full">
            <span class="opacity-50">€</span>
            <input v-model.number="form.sale_price" type="number" inputmode="decimal" step="0.01" min="0" required placeholder="0,00" />
          </label>
        </label>
        <label class="floating-label">
          <span>Per</span>
          <input v-model="form.unit" list="units" class="input input-lg w-full" placeholder="Eenheid" required />
          <datalist id="units"><option v-for="u in units" :key="u" :value="u" /></datalist>
        </label>
      </div>
      <div>
        <p class="mb-2 text-sm font-semibold">Btw</p>
        <div class="join w-full">
          <input v-for="r in [21, 9, 0]" :key="r" v-model.number="form.vat_rate" :value="r" type="radio" name="vat" class="join-item btn flex-1" :aria-label="`${r}%`" />
        </div>
      </div>
      <label v-if="form.kind === 'materiaal'" class="floating-label">
        <span>Inkoopprijs excl. btw</span>
        <label class="input input-lg w-full">
          <span class="opacity-50">€</span>
          <input v-model.number="form.purchase_price" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Inkoopprijs" />
        </label>
      </label>

      <template v-if="form.kind === 'materiaal'">
        <label class="bg-base-100 rounded-box flex items-center justify-between gap-3 p-4 shadow-sm">
          <span>
            <span class="block font-medium">Voorraad bijhouden</span>
            <span class="text-base-content/60 text-sm">Verbruik op klussen boekt automatisch af.</span>
          </span>
          <input v-model="form.track_stock" type="checkbox" class="toggle toggle-primary" />
        </label>
        <label v-if="form.track_stock" class="floating-label">
          <span>Waarschuw onder</span>
          <input v-model.number="form.min_stock" type="number" inputmode="decimal" min="0" class="input input-lg w-full" placeholder="Minimumvoorraad" />
        </label>
      </template>

      <button class="btn btn-primary btn-lg mt-2 w-full" :disabled="saving || !form.name.trim() || form.sale_price === null">
        <span v-if="saving" class="loading loading-spinner" /><Check v-else class="size-5" /> Opslaan
      </button>
      <button v-if="id" type="button" class="btn btn-ghost text-error" @click="archive"><Trash2 class="size-4" /> Archiveren</button>
    </form>
  </main>
</template>
