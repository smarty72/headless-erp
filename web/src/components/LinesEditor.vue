<script setup lang="ts">
import { computed, ref } from 'vue';
import { PackagePlus, Plus, Trash2 } from 'lucide-vue-next';
import type { Item, Line } from '../lib/api';
import { euro, lineTotals } from '../lib/format';
import ItemPicker from './ItemPicker.vue';
import TotalsBlock from './TotalsBlock.vue';

// Regels van een offerte of factuur. Op mobiel als kaartjes, op pc als tabelrij.
const lines = defineModel<Line[]>({ required: true });
const picker = ref<InstanceType<typeof ItemPicker> | null>(null);

function fromItem(item: Item) {
  lines.value.push({
    item_id: item.id,
    description: [item.brand, item.name].filter(Boolean).join(' '),
    quantity: 1,
    unit: item.unit,
    unit_price: item.sale_price,
    vat_rate: item.vat_rate as Line['vat_rate'],
  });
}
function freeLine() {
  lines.value.push({ description: '', quantity: 1, unit: 'stuk', unit_price: 0, vat_rate: 21 });
}
const totals = computed(() => lineTotals(lines.value));
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="(l, i) in lines" :key="l.id ?? i" class="bg-base-100 rounded-box grid grid-cols-6 gap-2 p-3 shadow-sm sm:grid-cols-[1fr_5rem_5rem_7rem_5.5rem_auto] sm:items-center">
      <input v-model="l.description" class="input col-span-6 w-full sm:col-span-1" placeholder="Omschrijving" aria-label="Omschrijving" />
      <input v-model.number="l.quantity" type="number" inputmode="decimal" step="any" min="0" class="input col-span-2 w-full sm:col-span-1" aria-label="Aantal" />
      <input v-model="l.unit" class="input col-span-2 w-full sm:col-span-1" aria-label="Eenheid" />
      <label class="input col-span-2 w-full sm:col-span-1">
        <span class="opacity-50">€</span>
        <input v-model.number="l.unit_price" type="number" inputmode="decimal" step="0.01" aria-label="Prijs per eenheid" />
      </label>
      <select v-model.number="l.vat_rate" class="select col-span-3 w-full sm:col-span-1" aria-label="Btw">
        <option :value="21">21%</option>
        <option :value="9">9%</option>
        <option :value="0">0%</option>
      </select>
      <div class="col-span-3 flex items-center justify-end gap-1 sm:col-span-1">
        <span class="text-sm tabular-nums">{{ euro((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)) }}</span>
        <button type="button" class="btn btn-ghost btn-sm btn-square" aria-label="Regel verwijderen" @click="lines.splice(i, 1)">
          <Trash2 class="size-4" />
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <button type="button" class="btn btn-soft btn-primary" @click="picker?.open()"><PackagePlus class="size-4" /> Artikel</button>
      <button type="button" class="btn btn-soft" @click="freeLine"><Plus class="size-4" /> Vrije regel</button>
    </div>

    <TotalsBlock v-if="lines.length" :totals="totals" class="mt-2" />
    <ItemPicker ref="picker" @pick="fromItem" />
  </div>
</template>
