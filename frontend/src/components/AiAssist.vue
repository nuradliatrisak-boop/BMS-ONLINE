<script setup>
// AI Assist: tombol melayang di pojok kanan bawah -> tanya apa saja soal fitur / data (pemasukan,
// pengeluaran, piutang, PO). AI hanya MEMBACA data lewat server (hak akses sesuai user), tidak mengubah apa pun.
import { ref, nextTick, onMounted } from "vue";
import { api } from "../services/api.js";

const buka = ref(false);
const aktif = ref(true);
const input = ref("");
const loading = ref(false);
const pesan = ref([{ role: "model", text: "Halo! Saya BMS Assist. Tanya apa saja soal fitur atau data, mis. “sisa tagihan Simpink berapa?”, “pengeluaran divisi Kontraktor bulan ini”, atau “PO yang belum selesai”." }]);
const kotak = ref(null);
const contoh = ["Sisa tagihan semua customer?", "Laba divisi Kontraktor bulan ini?", "PO mana yang masih terbuka?", "Cara impor progres PO?"];

onMounted(async () => {
  try { aktif.value = (await api.get("/ai/config")).aktif; } catch { aktif.value = false; }
});
function gulir() { nextTick(() => { if (kotak.value) kotak.value.scrollTop = kotak.value.scrollHeight; }); }

async function kirim(teks) {
  const q = String(teks ?? input.value).trim();
  if (!q || loading.value) return;
  const riwayat = pesan.value.slice(1).map((m) => ({ role: m.role, text: m.text }));
  pesan.value.push({ role: "user", text: q });
  input.value = "";
  loading.value = true;
  gulir();
  try {
    const r = await api.post("/ai/tanya", { pertanyaan: q, riwayat });
    pesan.value.push({ role: "model", text: r.jawaban });
  } catch (e) {
    pesan.value.push({ role: "model", text: "⚠ " + (e.message || "Gagal menghubungi AI") });
  } finally {
    loading.value = false;
    gulir();
  }
}
</script>

<template>
  <button class="ai-fab" title="AI Assist" @click="buka = !buka">{{ buka ? "×" : "✨ AI" }}</button>
  <div v-if="buka" class="ai-panel">
    <div class="ai-head">✨ BMS Assist <span class="ai-sub">hanya membaca data, tidak mengubah</span></div>
    <div v-if="!aktif" class="ai-off">AI belum aktif di server. Isi <b>GEMINI_API_KEY</b> di backend/.env lalu restart backend.</div>
    <div ref="kotak" class="ai-body">
      <div v-for="(m, i) in pesan" :key="i" class="ai-msg" :class="m.role">{{ m.text }}</div>
      <div v-if="loading" class="ai-msg model">Sedang mencari data…</div>
      <div v-if="pesan.length === 1" class="ai-contoh">
        <button v-for="c in contoh" :key="c" @click="kirim(c)">{{ c }}</button>
      </div>
    </div>
    <div class="ai-input">
      <input v-model="input" placeholder="Tulis pertanyaan…" :disabled="!aktif" @keyup.enter="kirim()" />
      <button :disabled="loading || !aktif" @click="kirim()">Kirim</button>
    </div>
  </div>
</template>

<style scoped>
.ai-fab { position: fixed; right: 18px; bottom: 18px; z-index: 900; border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 700; background: #1d3557; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.25); cursor: pointer; }
.ai-panel { position: fixed; right: 18px; bottom: 70px; z-index: 900; width: min(380px, calc(100vw - 24px)); height: min(520px, calc(100vh - 100px)); background: #fff; border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.25); display: flex; flex-direction: column; overflow: hidden; }
.ai-head { padding: 10px 14px; font-weight: 700; background: #1d3557; color: #fff; }
.ai-sub { font-weight: 400; font-size: 11px; opacity: .8; margin-left: 6px; }
.ai-off { padding: 8px 12px; background: #fff4e0; font-size: 12px; color: #8a5a00; }
.ai-body { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; background: #f7f8fa; }
.ai-msg { max-width: 88%; padding: 8px 11px; border-radius: 10px; font-size: 13px; line-height: 1.45; white-space: pre-wrap; }
.ai-msg.user { align-self: flex-end; background: #1d3557; color: #fff; }
.ai-msg.model { align-self: flex-start; background: #fff; border: 1px solid #e3e3e3; }
.ai-contoh { display: flex; flex-direction: column; gap: 6px; }
.ai-contoh button { text-align: left; border: 1px solid #cfd6e0; background: #fff; border-radius: 8px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.ai-input { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #eee; }
.ai-input input { flex: 1; padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px; }
.ai-input button { border: 0; background: #1d3557; color: #fff; padding: 0 14px; border-radius: 8px; cursor: pointer; }
.ai-input button:disabled { opacity: .5; }
</style>
