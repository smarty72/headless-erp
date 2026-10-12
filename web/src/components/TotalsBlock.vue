<script setup lang="ts">
import { euro } from '../lib/format';

defineProps<{
  totals: { total_excl: number; total_vat: number; total_incl: number; vat_breakdown: { rate: number; excl: number; vat: number }[] };
}>();
</script>

<template>
  <dl class="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
    <dt class="text-base-content/70">Subtotaal</dt>
    <dd class="text-right tabular-nums">{{ euro(totals.total_excl) }}</dd>
    <template v-for="r in totals.vat_breakdown" :key="r.rate">
      <dt class="text-base-content/70">Btw {{ r.rate }}% over {{ euro(r.excl) }}</dt>
      <dd class="text-right tabular-nums">{{ euro(r.vat) }}</dd>
    </template>
    <dt class="border-base-300 mt-1 border-t pt-2 text-base font-bold">Totaal</dt>
    <dd class="border-base-300 mt-1 border-t pt-2 text-right text-base font-bold tabular-nums">{{ euro(totals.total_incl) }}</dd>
  </dl>
</template>
