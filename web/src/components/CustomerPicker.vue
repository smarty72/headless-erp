<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Check, Search, UserPlus, X } from 'lucide-vue-next';
import type { Customer } from '../lib/api';
import { tapi } from '../lib/tenant';
import { addressLine } from '../lib/format';

// Klant kiezen, of ter plekke een nieuwe aanmaken (alleen naam en telefoon).
const model = defineModel<Customer | null>({ required: true });
const customers = ref<Customer[]>([]);
const search = ref('');
const adding = ref(false);
const busy = ref(false);
const error = ref('');
const draft = reactive({ name: '', phone: '' });

onMounted(async () => {
  try {
    customers.value = await tapi<Customer[]>('/customers');
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? customers.value.filter((c) => [c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(q))) : customers.value;
});

async function create() {
  busy.value = true;
  error.value = '';
  try {
    const c = await tapi<Customer>('/customers', {
      method: 'POST',
      json: { name: draft.name.trim(), phone: draft.phone.trim() || undefined },
    });
    customers.value.push(c);
    model.value = c;
    adding.value = false;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div v-if="model" class="bg-base-100 rounded-box flex items-center gap-3 p-4 shadow-sm">
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">{{ model.name }}</p>
        <p class="text-base-content/60 truncate text-sm">{{ addressLine(model.address) || model.phone || 'Geen adres' }}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" @click="model = null">Wijzig</button>
    </div>

    <div v-else-if="adding" class="bg-base-100 rounded-box flex flex-col gap-3 p-4 shadow-sm">
      <label class="floating-label">
        <span>Naam klant *</span>
        <input v-model="draft.name" class="input input-lg w-full" placeholder="Naam klant *" autofocus />
      </label>
      <label class="floating-label">
        <span>Telefoon</span>
        <input v-model="draft.phone" type="tel" class="input input-lg w-full" placeholder="Telefoon" />
      </label>
      <div class="flex gap-2">
        <button type="button" class="btn btn-ghost" @click="adding = false"><X class="size-4" /> Annuleer</button>
        <button type="button" class="btn btn-primary flex-1" :disabled="!draft.name.trim() || busy" @click="create">
          <span v-if="busy" class="loading loading-spinner" /><Check v-else class="size-4" /> Klant toevoegen
        </button>
      </div>
    </div>

    <div v-else class="bg-base-100 rounded-box shadow-sm">
      <div class="flex gap-2 p-3">
        <label class="input w-full">
          <Search class="size-4 opacity-50" />
          <input v-model="search" type="search" placeholder="Zoek klant" />
        </label>
        <button type="button" class="btn btn-soft btn-primary" @click="adding = true; draft.name = search">
          <UserPlus class="size-4" /> Nieuw
        </button>
      </div>
      <ul class="menu max-h-72 w-full flex-nowrap overflow-y-auto p-2 pt-0">
        <li v-for="c in filtered" :key="c.id">
          <button type="button" class="py-3" @click="model = c">
            <span class="min-w-0 flex-1 truncate text-left">{{ c.name }}</span>
            <span class="text-base-content/50 truncate text-xs">{{ c.address?.city }}</span>
          </button>
        </li>
        <li v-if="!filtered.length" class="text-base-content/60 p-3 text-sm">Geen klanten gevonden.</li>
      </ul>
    </div>
    <p v-if="error" class="text-error mt-2 text-sm">{{ error }}</p>
  </div>
</template>
