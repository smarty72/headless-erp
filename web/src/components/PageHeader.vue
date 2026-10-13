<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next';

withDefaults(defineProps<{ title: string; subtitle?: string; back?: string }>(), { back: '/' });
</script>

<template>
  <header class="no-print mb-4 flex items-center gap-2">
    <RouterLink :to="back" class="btn btn-ghost btn-circle -ml-2 shrink-0" aria-label="Terug"><ArrowLeft class="size-5" /></RouterLink>
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-2xl font-bold">{{ title }}</h1>
      <p v-if="subtitle" class="text-base-content/60 truncate text-sm">{{ subtitle }}</p>
    </div>
    <slot />
  </header>
</template>
