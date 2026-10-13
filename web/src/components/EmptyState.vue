<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{ icon: Component; title: string; text?: string }>();
</script>

<template>
  <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
    <component :is="icon" class="text-base-content/30 size-12" :stroke-width="1.5" />
    <p class="font-semibold">{{ title }}</p>
    <p v-if="text" class="text-base-content/60 max-w-xs text-sm">{{ text }}</p>
    <slot />
  </div>
</template>
