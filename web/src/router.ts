import { createRouter, createWebHistory } from 'vue-router';
import { initSession, loadTenants, state } from './lib/session';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/welkom', component: () => import('./views/OnboardingView.vue') },
    { path: '/', component: () => import('./views/DashboardView.vue') },
    { path: '/klanten/nieuw', component: () => import('./views/NewCustomerView.vue') },
    { path: '/binnenkort/:onderdeel', component: () => import('./views/ComingSoonView.vue'), props: true },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

// Niet ingelogd → login. Ingelogd zonder bedrijf → onboarding.
router.beforeEach(async (to) => {
  await initSession();
  if (to.meta.public) return state.session && to.path === '/login' ? '/' : true;
  if (!state.session) return { path: '/login', query: to.fullPath === '/' ? {} : { terug: to.fullPath } };

  try {
    const tenants = await loadTenants();
    if (tenants.length === 0 && to.path !== '/welkom') return '/welkom';
  } catch {
    // API onbereikbaar: laat de pagina zelf de fout tonen.
  }
  return true;
});
