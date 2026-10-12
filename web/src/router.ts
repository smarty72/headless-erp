import { createRouter, createWebHistory } from 'vue-router';
import { initSession, loadTenants, state } from './lib/session';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/welkom', component: () => import('./views/OnboardingView.vue') },
    { path: '/', component: () => import('./views/DashboardView.vue') },
    { path: '/aan-het-werk', component: () => import('./views/WorkView.vue') },
    { path: '/klanten', component: () => import('./views/CustomersView.vue') },
    { path: '/klanten/nieuw', component: () => import('./views/CustomerFormView.vue') },
    { path: '/klanten/:id', component: () => import('./views/CustomerView.vue'), props: true },
    { path: '/klanten/:id/bewerken', component: () => import('./views/CustomerFormView.vue'), props: true },
    { path: '/artikelen', component: () => import('./views/ItemsView.vue') },
    { path: '/artikelen/nieuw', component: () => import('./views/ItemFormView.vue') },
    { path: '/artikelen/:id', component: () => import('./views/ItemFormView.vue'), props: true },
    { path: '/offertes', component: () => import('./views/QuotesView.vue') },
    { path: '/offertes/nieuw', component: () => import('./views/QuoteView.vue') },
    { path: '/offertes/:id', component: () => import('./views/QuoteView.vue'), props: true },
    { path: '/opdrachten', component: () => import('./views/JobsView.vue') },
    { path: '/opdrachten/nieuw', component: () => import('./views/NewJobView.vue') },
    { path: '/opdrachten/:id', component: () => import('./views/JobView.vue'), props: true },
    { path: '/facturen', component: () => import('./views/InvoicesView.vue') },
    { path: '/facturen/:id', component: () => import('./views/InvoiceView.vue'), props: true },
    { path: '/bedrijf', component: () => import('./views/CompanyView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
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
