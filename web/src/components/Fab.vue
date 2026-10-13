<script setup lang="ts">
import { Plus } from 'lucide-vue-next';

defineProps<{ to: string; label: string }>();
</script>

<!-- Zwevende knop rechtsonder; op pc een gewone knop in de lijst-header. -->
<template>
  <RouterLink
    :to="to"
    class="btn btn-primary btn-lg no-print fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 rounded-full shadow-lg"
  >
    <Plus class="size-5" /> {{ label }}
  </RouterLink>
</template>
