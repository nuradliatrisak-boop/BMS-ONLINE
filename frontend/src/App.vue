<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "./stores/auth.js";
import Sidebar from "./components/Sidebar.vue";
import Toast from "./components/Toast.vue";

const route = useRoute();
const auth = useAuthStore();

const showShell = computed(() => !route.meta.public && auth.isLoggedIn);
</script>

<template>
  <div v-if="showShell" id="app">
    <Sidebar />
    <main>
      <router-view />
    </main>
  </div>
  <router-view v-else />
  <Toast />
</template>
