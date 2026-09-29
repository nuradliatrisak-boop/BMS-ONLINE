<!--
  RapikanNamaModal -- menggabungkan nama yang sebenarnya satu orang tapi
  ditulis beda (mis. "Warto" & "Wartono"). Saran dihitung backend
  (GET /solar-tx/nama-mirip); staf yang memutuskan nama mana yang dipakai.
-->
<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import LainnyaModal from "./LainnyaModal.vue";

const emit = defineEmits(["close", "selesai"]);
const grup = ref([]);
const loading = ref(true);
const pilihan = ref({}); // { [indexGrup]: nama tujuan }
const proses = ref(-1);

onMounted(async () => {
  try {
    grup.value = await api.get("/solar-tx/nama-mirip");
    grup.value.forEach((g, i) => (pilihan.value[i] = g.saran));
  } finally {
    loading.value = false;
  }
});

async function gabung(g, i) {
  const ke = pilihan.value[i];
  const dari = g.nama.flatMap((n) => n.semuaEjaan).filter((n) => n !== ke);
  if (!confirm(`Ubah semua penulisan ${g.nama.map((n) => `"${n.nama}"`).join(", ")} menjadi "${ke}"?`)) return;
  proses.value = i;
  try {
    const r = await api.post("/solar-tx/gabung-nama", { dari, ke });
    toast(`${r.diubah} catatan diseragamkan menjadi "${r.ke}"`);
    grup.value = grup.value.filter((_, idx) => idx !== i);
    emit("selesai");
  } catch (e) {
    toast(e.message || "Gagal menggabungkan nama");
  } finally {
    proses.value = -1;
  }
}
</script>

<template>
  <LainnyaModal title="Rapikan Nama Sopir / Operator" lebar="720px" @close="emit('close')">
    <div class="msub" style="margin-bottom: 12px">
      Nama di bawah kemungkinan orang yang sama karena yang satu adalah potongan dari yang lain. Pilih nama yang
      benar lalu klik Gabungkan &mdash; semua catatan lama ikut diseragamkan. Ke depannya, mengetik potongan nama
      otomatis diarahkan ke nama lengkap.
    </div>
    <div v-if="loading" class="empty">Memuat…</div>
    <div v-else-if="!grup.length" class="empty">Tidak ada nama yang perlu digabung. Semua sudah rapi 👍</div>
    <div v-else>
      <div v-for="(g, i) in grup" :key="i" class="card" style="margin-bottom: 10px; padding: 12px 14px">
        <div v-for="n in g.nama" :key="n.nama" style="display: flex; align-items: center; gap: 8px; padding: 3px 0">
          <label style="display: flex; gap: 8px; align-items: center; cursor: pointer">
            <input v-model="pilihan[i]" type="radio" :value="n.nama" />
            <b>{{ n.nama }}</b>
          </label>
          <span class="msub">{{ n.jumlah }} catatan</span>
        </div>
        <button class="btn btn-primary btn-sm" style="margin-top: 8px" :disabled="proses === i" @click="gabung(g, i)">
          {{ proses === i ? "Menggabungkan…" : `Gabungkan semua jadi "${pilihan[i]}"` }}
        </button>
      </div>
    </div>
  </LainnyaModal>
</template>
