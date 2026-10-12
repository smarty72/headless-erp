<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronRight, ClipboardPlus, FilePlus, Mail, MapPin, Pencil, Phone, Trash2 } from 'lucide-vue-next';
import type { CustomerDetail } from '../lib/api';
import { tapi } from '../lib/tenant';
import { addressLine, date, euro } from '../lib/format';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ErrorAlert from '../components/ErrorAlert.vue';

const props = defineProps<{ id: string }>();
const router = useRouter();
const customer = ref<CustomerDetail | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    customer.value = await tapi<CustomerDetail>(`/customers/${props.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  }
});

const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

async function archive() {
  if (!confirm('Klant archiveren? Offertes en facturen blijven bewaard.')) return;
  try {
    await tapi(`/customers/${props.id}`, { method: 'DELETE' });
    await router.replace('/klanten');
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
    <PageHeader :title="customer?.name ?? 'Klant'" :subtitle="customer?.kind === 'zakelijk' ? 'Zakelijk' : 'Particulier'" back="/klanten">
      <RouterLink :to="`/klanten/${id}/bewerken`" class="btn btn-ghost btn-circle" aria-label="Bewerken"><Pencil class="size-5" /></RouterLink>
    </PageHeader>
    <ErrorAlert :message="error" />

    <template v-if="customer">
      <div class="mb-4 grid grid-cols-3 gap-2">
        <a :href="customer.phone ? `tel:${customer.phone}` : undefined" class="btn btn-soft h-auto flex-col py-3" :class="{ 'btn-disabled': !customer.phone }">
          <Phone class="size-5" /> Bellen
        </a>
        <a :href="customer.email ? `mailto:${customer.email}` : undefined" class="btn btn-soft h-auto flex-col py-3" :class="{ 'btn-disabled': !customer.email }">
          <Mail class="size-5" /> Mailen
        </a>
        <a :href="customer.address ? mapsUrl(addressLine(customer.address)) : undefined" target="_blank" rel="noopener" class="btn btn-soft h-auto flex-col py-3" :class="{ 'btn-disabled': !customer.address }">
          <MapPin class="size-5" /> Route
        </a>
      </div>

      <dl class="bg-base-100 rounded-box mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm shadow-sm">
        <dt class="text-base-content/60">Adres</dt><dd>{{ addressLine(customer.address) || '—' }}</dd>
        <dt class="text-base-content/60">Telefoon</dt><dd>{{ customer.phone || '—' }}</dd>
        <dt class="text-base-content/60">E-mail</dt><dd class="break-all">{{ customer.email || '—' }}</dd>
        <template v-if="customer.vat_number"><dt class="text-base-content/60">Btw</dt><dd>{{ customer.vat_number }}</dd></template>
      </dl>

      <div class="mb-6 grid grid-cols-2 gap-3">
        <RouterLink :to="`/offertes/nieuw?klant=${id}`" class="btn btn-primary btn-lg"><FilePlus class="size-5" /> Offerte</RouterLink>
        <RouterLink :to="`/opdrachten/nieuw?klant=${id}`" class="btn btn-lg"><ClipboardPlus class="size-5" /> Opdracht</RouterLink>
      </div>

      <section v-for="block in [
        { title: 'Opdrachten', type: 'job' as const, rows: customer.jobs.map((j) => ({ id: j.id, to: `/opdrachten/${j.id}`, label: j.title, sub: date(j.created_at), status: j.status })) },
        { title: 'Offertes', type: 'quote' as const, rows: customer.quotes.map((q) => ({ id: q.id, to: `/offertes/${q.id}`, label: q.title || q.number || 'Offerte', sub: [q.number, date(q.created_at)].filter(Boolean).join(' · '), status: q.status })) },
        { title: 'Facturen', type: 'invoice' as const, rows: customer.invoices.map((f) => ({ id: f.id, to: `/facturen/${f.id}`, label: f.number ?? 'Conceptfactuur', sub: f.total_incl != null ? euro(f.total_incl) : date(f.created_at), status: f.status })) },
      ]" :key="block.title" class="mb-5">
        <h2 class="text-base-content/70 mb-2 text-sm font-semibold">{{ block.title }}</h2>
        <ul v-if="block.rows.length" class="bg-base-100 rounded-box divide-base-200 divide-y shadow-sm">
          <li v-for="r in block.rows" :key="r.id">
            <RouterLink :to="r.to" class="flex items-center gap-3 p-4">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ r.label }}</span>
                <span class="text-base-content/60 text-sm">{{ r.sub }}</span>
              </span>
              <StatusBadge :type="block.type" :status="r.status" />
              <ChevronRight class="size-4 opacity-40" />
            </RouterLink>
          </li>
        </ul>
        <p v-else class="text-base-content/50 text-sm">Nog geen {{ block.title.toLowerCase() }}.</p>
      </section>

      <button class="btn btn-ghost text-error mt-4 self-center" @click="archive"><Trash2 class="size-4" /> Klant archiveren</button>
    </template>
  </main>
</template>
