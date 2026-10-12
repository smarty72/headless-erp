<script setup lang="ts">
import type { Address, Line, TenantFull, Totals } from '../lib/api';
import { addressLine, amount, euro } from '../lib/format';
import TotalsBlock from './TotalsBlock.vue';

// Offerte of factuur zoals de klant hem ziet; ook de printversie (Afdrukken / PDF).
defineProps<{
  kind: 'Offerte' | 'Factuur';
  number: string | null;
  tenant: TenantFull | null;
  customer: { name?: string; address?: Address | null; vat_number?: string | null } | null;
  lines: Line[];
  totals: Totals;
  meta: { label: string; value: string | null }[];
  title?: string | null;
  notes?: string | null;
  footer?: string;
}>();
</script>

<template>
  <article class="bg-base-100 rounded-box print-sheet p-5 shadow-sm sm:p-8">
    <header class="mb-6 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <img v-if="tenant?.logo_url" :src="tenant.logo_url" alt="" class="mb-2 h-12 max-w-40 object-contain" />
        <p class="font-bold">{{ tenant?.name }}</p>
        <p class="text-base-content/70 text-sm">{{ addressLine(tenant?.address) }}</p>
        <p class="text-base-content/70 text-sm">{{ [tenant?.phone, tenant?.email].filter(Boolean).join(' · ') }}</p>
      </div>
      <div class="text-right">
        <p class="text-2xl font-bold">{{ kind }}</p>
        <p class="text-base-content/70 text-sm">{{ number ?? 'concept' }}</p>
      </div>
    </header>

    <div class="mb-6 grid gap-4 sm:grid-cols-2">
      <div>
        <p class="text-base-content/60 text-xs uppercase">Aan</p>
        <p class="font-semibold">{{ customer?.name }}</p>
        <p class="text-sm">{{ addressLine(customer?.address) }}</p>
        <p v-if="customer?.vat_number" class="text-sm">Btw: {{ customer.vat_number }}</p>
      </div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 text-sm sm:justify-self-end">
        <template v-for="m in meta.filter((x) => x.value)" :key="m.label">
          <dt class="text-base-content/60">{{ m.label }}</dt>
          <dd>{{ m.value }}</dd>
        </template>
      </dl>
    </div>

    <p v-if="title" class="mb-3 font-semibold">{{ title }}</p>

    <table class="table-sm mb-4 table">
      <thead>
        <tr>
          <th>Omschrijving</th>
          <th class="text-right">Aantal</th>
          <th class="hidden text-right sm:table-cell print:table-cell">Prijs</th>
          <th class="hidden text-right sm:table-cell print:table-cell">Btw</th>
          <th class="text-right">Bedrag</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(l, i) in lines" :key="l.id ?? i">
          <td>{{ l.description }}</td>
          <td class="text-right whitespace-nowrap">{{ amount(l.quantity) }} {{ l.unit }}</td>
          <td class="hidden text-right whitespace-nowrap sm:table-cell print:table-cell">{{ euro(l.unit_price) }}</td>
          <td class="hidden text-right sm:table-cell print:table-cell">{{ l.vat_rate }}%</td>
          <td class="text-right whitespace-nowrap tabular-nums">{{ euro(l.quantity * l.unit_price) }}</td>
        </tr>
      </tbody>
    </table>

    <TotalsBlock :totals="totals" />

    <p v-if="notes" class="mt-6 text-sm whitespace-pre-line">{{ notes }}</p>
    <p v-if="footer" class="text-base-content/70 mt-6 text-sm">{{ footer }}</p>
    <p class="text-base-content/50 mt-6 text-xs">
      {{ [tenant?.kvk_number && `KvK ${tenant.kvk_number}`, tenant?.vat_number && `Btw ${tenant.vat_number}`, tenant?.iban && `IBAN ${tenant.iban}`].filter(Boolean).join(' · ') }}
    </p>
  </article>
</template>
