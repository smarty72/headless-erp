<script setup lang="ts">
import { computed } from 'vue';
import { invoiceStatus, jobStatus, quoteStatus } from '../lib/format';

const props = defineProps<{ type: 'quote' | 'job' | 'invoice'; status: string }>();
const badge = computed(() => {
  const map = { quote: quoteStatus, job: jobStatus, invoice: invoiceStatus }[props.type] as Record<string, { label: string; class: string }>;
  return map[props.status] ?? { label: props.status, class: 'badge-ghost' };
});
</script>

<template>
  <span class="badge badge-sm shrink-0 whitespace-nowrap" :class="badge.class">{{ badge.label }}</span>
</template>
