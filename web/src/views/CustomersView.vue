<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronRight, Search, Users } from 'lucide-vue-next';
import type { Customer } from '../lib/api';
import { tapi } from '../lib/tenant';
import { addressLine } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import ErrorAlert from '../components/ErrorAlert.vue';
import EmptyState from '../components/EmptyState.vue';
import Fab from '../components/Fab.vue';

const customers = ref<Customer[]>([]);
const search = ref('');
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    customers.value = await tapi<Customer[]>('/customers');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? customers.value.filter((c) => [c.name, c.phone, c.email, c.address?.city].some((v) => v?.toLowerCase().includes(q))) : customers.value;
});
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-28 sm:px-6 sm:pt-8">
    <PageHeader title="Klanten" :subtitle="`${customers.length} klanten`" />
    <label v-if="customers.length > 5" class="input input-lg mb-4 w-full">
      <Search class="size-5 opacity-50" />
      <input v-model="search" type="search" placeholder="Zoek op naam, plaats of telefoon" />
    </label>
    <ErrorAlert :message="error" />
    <div v-if="loading" class="flex justify-center py-16"><span class="loading loading-spinner loading-lg" /></div>

    <ul v-else-if="filtered.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
      <li v-for="c in filtered" :key="c.id">
        <RouterLink :to="`/klanten/${c.id}`" class="flex items-center gap-3 p-4">
          <span class="bg-base-200 grid size-10 shrink-0 place-items-center rounded-full font-semibold">{{ c.name[0]?.toUpperCase() }}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ c.name }}</span>
            <span class="text-base-content/60 block truncate text-sm">{{ addressLine(c.address) || c.phone || c.email || '—' }}</span>
          </span>
          <ChevronRight class="size-4 opacity-40" />
        </RouterLink>
      </li>
    </ul>
    <EmptyState v-else :icon="Users" :title="search ? 'Niemand gevonden' : 'Nog geen klanten'" :text="search ? undefined : 'Voeg je eerste klant toe. Dat kan ook direct vanuit een offerte.'" />

    <Fab to="/klanten/nieuw" label="Klant" />
  </main>
</template>
