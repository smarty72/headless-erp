import { computed, onUnmounted, ref } from 'vue';

// Lopende tijd sinds een tijdstip als u:mm:ss, ververst elke seconde.
export function useElapsed(since: () => string | null) {
  const now = ref(Date.now());
  const timer = setInterval(() => (now.value = Date.now()), 1000);
  onUnmounted(() => clearInterval(timer));
  return computed(() => {
    const start = since();
    if (!start) return '';
    const s = Math.max(0, Math.floor((now.value - Date.parse(start)) / 1000));
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
}
