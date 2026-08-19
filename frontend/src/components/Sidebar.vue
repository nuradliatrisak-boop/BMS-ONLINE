<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const router = useRouter();

const sidebarOpen = ref(false);

function closeSidebar() {
  sidebarOpen.value = false;
}

function doLogout() {
  auth.logout();
  router.push({ name: "login" });
  closeSidebar();
}
</script>

<template>
  <!-- Tombol hamburger mobile -->
  <button
    class="mobile-menu-btn"
    @click="sidebarOpen = true"
    aria-label="Buka menu"
  >
    ☰
  </button>

  <!-- Overlay -->
  <div
    v-if="sidebarOpen"
    class="sidebar-overlay"
    @click="closeSidebar"
  ></div>

  <aside
    class="sidebar"
    :class="{ 'sidebar-open': sidebarOpen }"
  >
    <div class="brand">
      <button
        class="mobile-close-btn"
        @click="closeSidebar"
        aria-label="Tutup menu"
      >
        ×
      </button>

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
      <router-link to="/" @click="closeSidebar">
        <span class="ic">📊</span>
        <span>Dashboard</span>
      </router-link>

      <router-link to="/customers" @click="closeSidebar">
        <span class="ic">👤</span>
        <span>Customer</span>
      </router-link>

      <router-link to="/armada" @click="closeSidebar">
        <span class="ic">🚚</span>
        <span>Armada</span>
      </router-link>

      <router-link to="/material" @click="closeSidebar">
        <span class="ic">📦</span>
        <span>Material</span>
      </router-link>

      <router-link to="/invoices" @click="closeSidebar">
        <span class="ic">🧾</span>
        <span>Invoice</span>
      </router-link>

      <router-link to="/surat-jalan" @click="closeSidebar">
        <span class="ic">📄</span>
        <span>Surat Jalan</span>
      </router-link>

      <router-link to="/laporan-divisi" @click="closeSidebar">
        <span class="ic">📈</span>
        <span>Laporan Divisi</span>
      </router-link>

      <router-link
        v-if="auth.isAdmin"
        to="/users"
        @click="closeSidebar"
      >
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