<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";

const stats = ref(null);
const loading = ref(true);

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

onMounted(async () => {
  stats.value = await api.get("/dashboard");
  loading.value = false;
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Dashboard</h1>
      <div class="desc">Ringkasan kondisi bisnis saat ini</div>
    </div>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else class="grid g4">
      <div class="stat">
        <div class="lbl">Total Invoice</div>
        <div class="val">{{ stats.totalInvoice }}</div>
        <div class="note">{{ stats.invoiceBelumLunas }} belum lunas</div>
      </div>
      <div class="stat">
        <div class="lbl">Total Tagihan</div>
        <div class="val">{{ rupiah(stats.totalTagihan) }}</div>
      </div>
      <div class="stat">
        <div class="lbl">Sisa Piutang</div>
        <div class="val">{{ rupiah(stats.sisaPiutang) }}</div>
      </div>
      <div class="stat">
        <div class="lbl">Surat Jalan</div>
        <div class="val">{{ stats.suratJalanDraft }} draft</div>
        <div class="note">{{ stats.suratJalanBelumTTD }} belum TTD</div>
      </div>
    </div>
  </div>
</template>
