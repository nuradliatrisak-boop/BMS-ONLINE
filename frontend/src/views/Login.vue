<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);

const auth = useAuthStore();
const router = useRouter();

async function submit() {
  error.value = "";
  loading.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    router.push({ name: "dashboard" });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <div class="mark">BMS</div>
      <h1>Sistem BMS</h1>
      <div class="sub">PT Bintang Muara Sejati</div>

      <div v-if="error" class="error-msg">{{ error }}</div>

      <div class="field">
        <label>Username</label>
        <input v-model="username" type="text" autocomplete="username" required />
      </div>
      <div class="field">
        <label>Password</label>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <button class="btn btn-primary" style="width:100%; justify-content:center;" :disabled="loading">
        {{ loading ? "Memproses…" : "Masuk" }}
      </button>
    </form>
  </div>
</template>
