<script setup lang="ts">
import { computed } from 'vue';
import { ArrowLeft, Construction } from 'lucide-vue-next';

const props = defineProps<{ onderdeel: string }>();

const titles: Record<string, string> = {
  'aan-het-werk': 'Aan het werk',
  'nieuwe-opdracht': 'Nieuwe opdracht',
  artikelen: 'Artikelen en tarieven',
  bedrijfsgegevens: 'Bedrijfsgegevens',
};
const title = computed(() => titles[props.onderdeel] ?? 'Binnenkort');
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-4 sm:px-6 sm:pt-8">
    <header class="mb-4 flex items-center gap-2">
      <RouterLink to="/" class="btn btn-ghost btn-circle" aria-label="Terug"><ArrowLeft class="size-5" /></RouterLink>
      <h1 class="text-2xl font-bold">{{ title }}</h1>
    </header>
    <div class="flex flex-1 flex-col items-center justify-center gap-3 pb-24 text-center">
      <Construction class="text-primary size-14" :stroke-width="1.5" />
      <p class="text-lg font-semibold">Hier wordt aan gewerkt</p>
      <p class="text-base-content/70 max-w-xs">Dit scherm komt in een volgende stap.</p>
    </div>
  </main>
</template>
