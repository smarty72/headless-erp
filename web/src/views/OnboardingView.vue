<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, ArrowRight, Check, ImagePlus, X } from 'lucide-vue-next';
import { api, type Industry, type TenantDetails } from '../lib/api';
import { iconFor } from '../lib/icons';
import { loadTenants, setCurrentTenant, state } from '../lib/session';
import AppLogo from '../components/AppLogo.vue';

const router = useRouter();
const DRAFT_KEY = 'vakwerk.onboarding';

const steps = ['Branche', 'Bedrijf', 'Tarieven', 'Klaar'] as const;
const step = ref(0);

const industries = ref<Industry[]>([]);
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');

const form = reactive({
  industry: '',
  name: '',
  contact_name: '',
  email: '',
  phone: '',
  street: '',
  postal_code: '',
  city: '',
  hourly_rate: null as number | null,
  labour_vat_rate: 21 as 0 | 9 | 21,
  call_out_fee: null as number | null,
  payment_days: 14,
  kvk_number: '',
  vat_number: '',
  iban: '',
});

// Logo blijft in het geheugen; het concept zelf overleeft een herlaadactie.
const logoFile = ref<File | null>(null);
const logoPreview = ref<string | null>(null);
const logoError = ref('');

const industry = computed(() => industries.value.find((i) => i.key === form.industry));
const ninePercentApplies = computed(() => industry.value?.default_labour_vat_rate === 9);

onMounted(async () => {
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) Object.assign(form, JSON.parse(draft));
  } catch {
    /* geen concept */
  }
  if (!form.email && state.session?.user.email) form.email = state.session.user.email;
  try {
    industries.value = await api<Industry[]>('/industries');
  } catch (e) {
    loadError.value = (e as Error).message;
  }
});

watch(form, (value) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
  } catch {
    /* privémodus */
  }
});

function chooseIndustry(item: Industry) {
  const changed = form.industry !== item.key;
  form.industry = item.key;
  if (changed || form.hourly_rate === null) form.hourly_rate = item.suggested_hourly_rate;
  if (changed) form.labour_vat_rate = item.default_labour_vat_rate as 0 | 9 | 21;
  step.value = 1;
}

function onLogo(event: Event) {
  logoError.value = '';
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)) {
    logoError.value = 'Kies een PNG, JPG, WebP of SVG.';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    logoError.value = 'Het logo mag maximaal 2 MB zijn.';
    return;
  }
  logoFile.value = file;
  logoPreview.value = URL.createObjectURL(file);
}

function clearLogo() {
  logoFile.value = null;
  logoPreview.value = null;
}

const emailValid = computed(() => !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email));
const canContinue = computed(() => {
  if (step.value === 0) return !!form.industry;
  if (step.value === 1) return form.name.trim().length > 0 && emailValid.value;
  if (step.value === 2) return (form.hourly_rate ?? 0) > 0;
  return true;
});

function next() {
  if (canContinue.value && step.value < steps.length - 1) step.value++;
}
function back() {
  if (step.value > 0) step.value--;
}

const euro = (n: number | null) =>
  n == null ? '' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
const blank = (s: string) => (s.trim() ? s.trim() : undefined);

async function finish() {
  saving.value = true;
  saveError.value = '';
  try {
    const address = { street: blank(form.street), postal_code: blank(form.postal_code), city: blank(form.city) };
    let tenant = await api<TenantDetails>('/onboarding', {
      method: 'POST',
      json: {
        industry: form.industry,
        name: form.name.trim(),
        contact_name: blank(form.contact_name),
        email: blank(form.email),
        phone: blank(form.phone),
        address: Object.values(address).some(Boolean) ? address : undefined,
        hourly_rate: form.hourly_rate ?? undefined,
        labour_vat_rate: form.labour_vat_rate,
        call_out_fee: form.call_out_fee || undefined,
        payment_days: form.payment_days,
        kvk_number: blank(form.kvk_number),
        vat_number: blank(form.vat_number),
        iban: blank(form.iban)?.replace(/\s+/g, '').toUpperCase(),
      },
    });
    if (logoFile.value) {
      const data = new FormData();
      data.append('file', logoFile.value);
      // Een mislukt logo houdt de start niet tegen; het kan later opnieuw.
      tenant = await api<TenantDetails>(`/tenants/${tenant.id}/logo`, { method: 'POST', form: data }).catch(() => tenant);
    }
    setCurrentTenant(tenant);
    await loadTenants(true);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* niets */
    }
    await router.replace('/');
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-6 pb-32 sm:px-6 sm:pt-10">
    <header class="mb-6 flex items-center gap-3">
      <AppLogo class="size-9" />
      <ul class="steps steps-horizontal flex-1 text-xs">
        <li v-for="(label, i) in steps" :key="label" class="step" :class="{ 'step-primary': i <= step }">
          <span class="hidden sm:inline">{{ label }}</span>
        </li>
      </ul>
    </header>

    <div v-if="loadError" role="alert" class="alert alert-error alert-soft">{{ loadError }}</div>

    <!-- 1. Branche -->
    <section v-if="step === 0">
      <h1 class="text-2xl font-bold sm:text-3xl">Wat voor werk doe je?</h1>
      <p class="text-base-content/70 mt-1 mb-5">Dan zetten we alvast de juiste tarieven en velden klaar.</p>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          v-for="item in industries"
          :key="item.key"
          type="button"
          class="card bg-base-100 border-2 p-4 text-left transition active:scale-[0.98]"
          :class="form.industry === item.key ? 'border-primary bg-primary/5' : 'border-transparent shadow-sm hover:border-base-300'"
          @click="chooseIndustry(item)"
        >
          <component :is="iconFor(item.icon)" class="text-primary mb-3 size-8" :stroke-width="1.75" />
          <span class="font-semibold">{{ item.label }}</span>
        </button>
        <template v-if="!industries.length && !loadError">
          <div v-for="n in 6" :key="n" class="skeleton h-24" />
        </template>
      </div>
    </section>

    <!-- 2. Bedrijf -->
    <section v-else-if="step === 1" class="flex flex-col gap-4">
      <div>
        <h1 class="text-2xl font-bold sm:text-3xl">Jouw bedrijf</h1>
        <p class="text-base-content/70 mt-1">Dit komt op je offertes en facturen.</p>
      </div>

      <div class="flex items-center gap-4">
        <label class="bg-base-100 border-base-300 hover:border-primary relative grid size-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-box border-2 border-dashed">
          <img v-if="logoPreview" :src="logoPreview" alt="Logo" class="size-full object-contain p-1" />
          <ImagePlus v-else class="text-base-content/50 size-7" />
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" class="sr-only" @change="onLogo" />
        </label>
        <div class="text-sm">
          <p class="font-medium">Logo <span class="text-base-content/60 font-normal">(mag ook later)</span></p>
          <p class="text-base-content/60">PNG, JPG of SVG, max 2 MB</p>
          <button v-if="logoPreview" type="button" class="btn btn-ghost btn-xs mt-1 -ml-2" @click="clearLogo">
            <X class="size-3" /> Weghalen
          </button>
          <p v-if="logoError" class="text-error">{{ logoError }}</p>
        </div>
      </div>

      <label class="floating-label">
        <span>Bedrijfsnaam *</span>
        <input v-model="form.name" class="input input-lg w-full" placeholder="Bedrijfsnaam *" autocomplete="organization" required />
      </label>
      <label class="floating-label">
        <span>Jouw naam</span>
        <input v-model="form.contact_name" class="input input-lg w-full" placeholder="Jouw naam" autocomplete="name" />
      </label>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="floating-label">
          <span>E-mail</span>
          <input
            v-model="form.email"
            type="email"
            class="input input-lg w-full"
            :class="{ 'input-error': !emailValid }"
            placeholder="E-mail"
            autocomplete="email"
          />
        </label>
        <label class="floating-label">
          <span>Telefoon</span>
          <input v-model="form.phone" type="tel" class="input input-lg w-full" placeholder="Telefoon" autocomplete="tel" />
        </label>
      </div>
      <label class="floating-label">
        <span>Straat en huisnummer</span>
        <input v-model="form.street" class="input input-lg w-full" placeholder="Straat en huisnummer" autocomplete="street-address" />
      </label>
      <div class="grid grid-cols-[2fr_3fr] gap-4">
        <label class="floating-label">
          <span>Postcode</span>
          <input v-model="form.postal_code" class="input input-lg w-full uppercase" placeholder="Postcode" autocomplete="postal-code" />
        </label>
        <label class="floating-label">
          <span>Plaats</span>
          <input v-model="form.city" class="input input-lg w-full" placeholder="Plaats" autocomplete="address-level2" />
        </label>
      </div>
    </section>

    <!-- 3. Tarieven -->
    <section v-else-if="step === 2" class="flex flex-col gap-5">
      <div>
        <h1 class="text-2xl font-bold sm:text-3xl">Je tarieven</h1>
        <p class="text-base-content/70 mt-1">Bedragen zijn exclusief btw. Je kunt ze altijd aanpassen.</p>
      </div>

      <fieldset class="fieldset">
        <legend class="fieldset-legend text-base">Uurtarief</legend>
        <label class="input input-lg w-full">
          <span class="text-base-content/60">€</span>
          <input v-model.number="form.hourly_rate" type="number" inputmode="decimal" min="0" step="0.5" class="grow" />
          <span class="text-base-content/60">per uur</span>
        </label>
        <p v-if="industry" class="label">
          Suggestie: {{ euro(industry.suggested_hourly_rate) }}. Pas gerust aan.
        </p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend text-base">Btw op arbeid</legend>
        <div class="join w-full">
          <input v-model="form.labour_vat_rate" :value="21" type="radio" name="vat" class="join-item btn btn-lg flex-1" aria-label="21%" />
          <input v-model="form.labour_vat_rate" :value="9" type="radio" name="vat" class="join-item btn btn-lg flex-1" aria-label="9%" />
        </div>
        <p class="label whitespace-normal">
          <template v-if="ninePercentApplies">
            9% geldt voor {{ industry?.label.toLowerCase() }}swerk aan woningen ouder dan 2 jaar. Per klus aan te passen.
          </template>
          <template v-else>Het standaardtarief is 21%. Per klus aan te passen.</template>
        </p>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend text-base">Voorrijkosten <span class="font-normal opacity-60">(optioneel)</span></legend>
        <label class="input input-lg w-full">
          <span class="text-base-content/60">€</span>
          <input v-model.number="form.call_out_fee" type="number" inputmode="decimal" min="0" step="0.5" class="grow" placeholder="0" />
          <span class="text-base-content/60">per keer</span>
        </label>
      </fieldset>

      <fieldset class="fieldset">
        <legend class="fieldset-legend text-base">Betaaltermijn</legend>
        <div class="join w-full">
          <input v-for="d in [7, 14, 30]" :key="d" v-model="form.payment_days" :value="d" type="radio" name="days" class="join-item btn btn-lg flex-1 whitespace-nowrap px-2" :aria-label="`${d} dagen`" />
        </div>
      </fieldset>

      <details class="collapse collapse-arrow bg-base-100 shadow-sm">
        <summary class="collapse-title font-medium">Voor op je facturen <span class="font-normal opacity-60">(kan later)</span></summary>
        <div class="collapse-content flex flex-col gap-4">
          <label class="floating-label">
            <span>KvK-nummer</span>
            <input v-model="form.kvk_number" inputmode="numeric" class="input w-full" placeholder="KvK-nummer" />
          </label>
          <label class="floating-label">
            <span>Btw-nummer</span>
            <input v-model="form.vat_number" class="input w-full uppercase" placeholder="Btw-nummer" />
          </label>
          <label class="floating-label">
            <span>IBAN</span>
            <input v-model="form.iban" class="input w-full uppercase" placeholder="IBAN" autocomplete="off" />
          </label>
        </div>
      </details>
    </section>

    <!-- 4. Klaar -->
    <section v-else class="flex flex-col gap-5">
      <div>
        <h1 class="text-2xl font-bold sm:text-3xl">Klaar om te beginnen</h1>
        <p class="text-base-content/70 mt-1">Klopt dit? Je kunt alles later nog wijzigen.</p>
      </div>
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body gap-4">
          <div class="flex items-center gap-4">
            <div class="bg-base-200 grid size-16 shrink-0 place-items-center overflow-hidden rounded-box">
              <img v-if="logoPreview" :src="logoPreview" alt="" class="size-full object-contain p-1" />
              <component :is="iconFor(industry?.icon ?? '')" v-else class="text-primary size-8" />
            </div>
            <div class="min-w-0">
              <p class="truncate text-lg font-semibold">{{ form.name }}</p>
              <p class="text-base-content/70">{{ industry?.label }}</p>
            </div>
          </div>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <template v-if="form.contact_name"><dt class="opacity-60">Naam</dt><dd>{{ form.contact_name }}</dd></template>
            <template v-if="form.email"><dt class="opacity-60">E-mail</dt><dd class="truncate">{{ form.email }}</dd></template>
            <template v-if="form.phone"><dt class="opacity-60">Telefoon</dt><dd>{{ form.phone }}</dd></template>
            <template v-if="form.street || form.city">
              <dt class="opacity-60">Adres</dt>
              <dd>{{ [form.street, [form.postal_code, form.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') }}</dd>
            </template>
            <dt class="opacity-60">Uurtarief</dt>
            <dd>{{ euro(form.hourly_rate) }} + {{ form.labour_vat_rate }}% btw</dd>
            <template v-if="form.call_out_fee"><dt class="opacity-60">Voorrijkosten</dt><dd>{{ euro(form.call_out_fee) }}</dd></template>
            <dt class="opacity-60">Betaaltermijn</dt>
            <dd>{{ form.payment_days }} dagen</dd>
          </dl>
        </div>
      </div>
      <div v-if="saveError" role="alert" class="alert alert-error alert-soft">{{ saveError }}</div>
    </section>

    <!-- Navigatie: onderin, met de duim bereikbaar -->
    <nav
      v-if="step > 0"
      class="bg-base-200/90 fixed inset-x-0 bottom-0 border-t border-base-300 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      <div class="mx-auto flex max-w-xl gap-3">
        <button type="button" class="btn btn-lg btn-ghost" :disabled="saving" @click="back">
          <ArrowLeft class="size-5" /> <span class="hidden sm:inline">Vorige</span>
        </button>
        <button v-if="step < steps.length - 1" type="button" class="btn btn-lg btn-primary flex-1" :disabled="!canContinue" @click="next">
          Volgende <ArrowRight class="size-5" />
        </button>
        <button v-else type="button" class="btn btn-lg btn-primary flex-1" :disabled="saving" @click="finish">
          <span v-if="saving" class="loading loading-spinner" />
          <Check v-else class="size-5" /> Aan de slag
        </button>
      </div>
    </nav>
  </main>
</template>
