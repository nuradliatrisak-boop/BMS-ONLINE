<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const loading = ref(true);
const saving = ref(false);

const form = ref({
  signerName: "",
});

async function load() {
  loading.value = true;
  try {
    const data = await api.get("/settings");
    form.value.signerName = data.signerName || "";
  } catch (e) {
    toast(e?.message || "Gagal memuat pengaturan");
  } finally {
    loading.value = false;
  }
}

async function submit() {
  saving.value = true;
  try {
    await api.put("/settings", { signerName: form.value.signerName.trim() });
    toast("Pengaturan berhasil disimpan");
  } catch (e) {
    toast(e?.message || "Gagal menyimpan pengaturan");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Pengaturan</h1>
      <div class="desc">Pengaturan umum yang dipakai di semua dokumen cetak</div>
    </div>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else class="card settings-card">
      <div class="section-title">Penandatangan Dokumen</div>
      <p class="settings-desc">
        Nama yang akan dicetak di kolom <strong>"Hormat kami,"</strong> pada Surat Jalan dan
        Invoice. Berlaku untuk semua dokumen yang dicetak setelah disimpan.
      </p>

      <div class="field" style="max-width: 380px">
        <label>Nama Penandatangan</label>
        <input v-model="form.signerName" placeholder="Contoh: Syamsul" />
      </div>

      <button class="btn btn-primary" :disabled="saving" @click="submit">
        {{ saving ? "Menyimpan..." : "Simpan Pengaturan" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-card { max-width: 560px; }
.settings-desc { font-size: 12.5px; color: var(--ink-soft); line-height: 1.6; margin: 4px 0 18px; }
</style>
