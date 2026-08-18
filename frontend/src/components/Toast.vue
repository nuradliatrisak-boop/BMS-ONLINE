<script setup>
import { useToastState } from "../services/toast.js";
const state = useToastState();
</script>

<template>
  <div v-if="state.visible" class="toast">{{ state.message }}</div>
</template>
