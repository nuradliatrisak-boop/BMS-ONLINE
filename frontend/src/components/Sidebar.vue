<script setup>
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const router = useRouter();

function doLogout() {
  auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="mark">BMS</div>
      <div class="name">PT Bintang Muara Sejati</div>
      <div class="sub">{{ auth.user?.role === 'ADMIN' ? 'Administrator' : ('Divisi ' + auth.user?.divisi) }}</div>
    </div>
    <nav>
      <router-link to="/"><span class="ic">📊</span> Dashboard</router-link>
      <router-link to="/customers"><span class="ic">👤</span> Customer</router-link>
      <router-link to="/armada"><span class="ic">🚚</span> Armada</router-link>
      <router-link to="/material"><span class="ic">📦</span> Material</router-link>
      <router-link to="/invoices"><span class="ic">🧾</span> Invoice</router-link>
      <router-link to="/surat-jalan"><span class="ic">📄</span> Surat Jalan</router-link>
      <router-link to="/laporan-divisi"><span class="ic">📈</span> Laporan Divisi</router-link>
      <router-link v-if="auth.isAdmin" to="/users"><span class="ic">🔐</span> Kelola Staf</router-link>
    </nav>
    <div class="sidebar-foot">
      <div style="margin-bottom:8px; color:#C3D2E0;">{{ auth.user?.nama }}</div>
      <a href="#" @click.prevent="doLogout" style="color:#9AB0C4;">Keluar</a>
    </div>
  </aside>
</template>
