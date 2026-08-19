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
      <div class="mark">
        <img src="/bms-logo.jpeg" alt="BMS Logo" />
      </div>

      <div class="name">PT Bintang Muara Sejati</div>

      <div class="sub">
        {{
          auth.user?.role === "ADMIN"
            ? "Administrator"
            : "Divisi " + auth.user?.divisi
        }}
      </div>
    </div>

    <nav>
      <router-link to="/">
        <span class="ic">📊</span>
        <span>Dashboard</span>
      </router-link>

      <router-link to="/customers">
        <span class="ic">👤</span>
        <span>Customer</span>
      </router-link>

      <router-link to="/armada">
        <span class="ic">🚚</span>
        <span>Armada</span>
      </router-link>

      <router-link to="/material">
        <span class="ic">📦</span>
        <span>Material</span>
      </router-link>

      <router-link to="/invoices">
        <span class="ic">🧾</span>
        <span>Invoice</span>
      </router-link>

      <router-link to="/surat-jalan">
        <span class="ic">📄</span>
        <span>Surat Jalan</span>
      </router-link>

      <router-link to="/laporan-divisi">
        <span class="ic">📈</span>
        <span>Laporan Divisi</span>
      </router-link>

      <router-link v-if="auth.isAdmin" to="/users">
        <span class="ic">🔐</span>
        <span>Kelola Staf</span>
      </router-link>
    </nav>

    <div class="sidebar-foot">
      <div class="sidebar-user">
        {{ auth.user?.nama }}
      </div>

      <a href="#" @click.prevent="doLogout" class="logout-link">
        Keluar
      </a>
    </div>
  </aside>
</template>