<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { supabase } from '../lib/supabase';
import AppLogo from '../components/AppLogo.vue';

const router = useRouter();
const route = useRoute();

const mode = ref<'login' | 'signup'>('login');
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');

async function submit() {
  error.value = '';
  notice.value = '';
  busy.value = true;
  try {
    if (mode.value === 'login') {
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value });
      if (e) throw e;
      await router.replace((route.query.terug as string | undefined) ?? '/');
    } else {
      const { data, error: e } = await supabase.auth.signUp({
        email: email.value,
        password: password.value,
        options: { emailRedirectTo: `${window.location.origin}/login` },
      });
      if (e) throw e;
      if (data.session) await router.replace('/welkom');
      else notice.value = 'Check je mail en klik op de bevestigingslink. Daarna kun je hier inloggen.';
    }
  } catch (e) {
    error.value = translate((e as Error).message);
  } finally {
    busy.value = false;
  }
}

function translate(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'E-mailadres of wachtwoord klopt niet.';
  if (/email not confirmed/i.test(message)) return 'Bevestig eerst je e-mailadres via de link in je mail.';
  if (/already registered/i.test(message)) return 'Er bestaat al een account met dit e-mailadres. Log in.';
  if (/at least 6 characters/i.test(message)) return 'Kies een wachtwoord van minimaal 6 tekens.';
  if (/rate limit/i.test(message)) return 'Even te veel pogingen. Probeer het over een paar minuten opnieuw.';
  return message;
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
    <div class="mb-8 flex flex-col items-center gap-3 text-center">
      <AppLogo class="size-14" />
      <h1 class="text-3xl font-bold">Vakwerk</h1>
      <p class="text-base-content/70">Offertes, uren en facturen. Zonder gedoe.</p>
    </div>

    <div class="card bg-base-100 shadow-sm">
      <form class="card-body gap-4" @submit.prevent="submit">
        <div role="tablist" class="tabs tabs-box grid grid-cols-2">
          <button type="button" role="tab" class="tab h-11" :class="{ 'tab-active': mode === 'login' }" @click="mode = 'login'">
            Inloggen
          </button>
          <button type="button" role="tab" class="tab h-11" :class="{ 'tab-active': mode === 'signup' }" @click="mode = 'signup'">
            Account maken
          </button>
        </div>

        <label class="floating-label">
          <span>E-mailadres</span>
          <input v-model="email" type="email" class="input input-lg w-full" placeholder="E-mailadres" autocomplete="email" required />
        </label>
        <label class="floating-label">
          <span>Wachtwoord</span>
          <input
            v-model="password"
            type="password"
            class="input input-lg w-full"
            placeholder="Wachtwoord"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            minlength="6"
            required
          />
        </label>

        <div v-if="error" role="alert" class="alert alert-error alert-soft">{{ error }}</div>
        <div v-if="notice" role="status" class="alert alert-success alert-soft">{{ notice }}</div>

        <button class="btn btn-primary btn-lg w-full" :disabled="busy">
          <span v-if="busy" class="loading loading-spinner" />
          {{ mode === 'login' ? 'Inloggen' : 'Account maken' }}
        </button>
      </form>
    </div>
  </main>
</template>
