<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <div v-if="message" role="alert" class="alert alert-error alert-soft my-3">{{ message }}</div>
</template>
