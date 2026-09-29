<!--
  RingkasList -- peringkat singkat (batang horizontal) yang hanya menampilkan
  beberapa teratas; sisanya masuk "Lainnya (n)" -> klik untuk daftar lengkap.
  rows: [{ label, value, sub }]  (sudah terurut dari terbesar)
-->
<script setup>
import { computed, ref } from "vue";
import LainnyaModal from "./LainnyaModal.vue";
import { fmtL } from "../utils/solarUtil.js";

const props = defineProps({
  title: String,
  rows: { type: Array, default: () => [] },
  limit: { type: Number, default: 5 },
  satuan: { type: String, default: "L" },
  aktif: { type: String, default: "" }, // label yang sedang dipilih (sorot)
  klikable: { type: Boolean, default: false },
  kosong: { type: String, default: "Belum ada data." },
  warna: { type: String, default: "#2459a6" },
});
const emit = defineEmits(["pilih"]);

const buka = ref(false);
const cari = ref("");
const top = computed(() => props.rows.slice(0, props.limit));
const sisa = computed(() => props.rows.slice(props.limit));
const maks = computed(() => Math.max(1, ...props.rows.map((r) => r.value)));
const total = computed(() => props.rows.reduce((s, r) => s + r.value, 0));
const hasil = computed(() => {
  const q = cari.value.trim().toLowerCase();
  return q ? props.rows.filter((r) => r.label.toLowerCase().includes(q)) : props.rows;
});
const persen = (v) => (total.value ? Math.round((v / total.value) * 100) : 0);
function klik(r) {
  if (props.klikable) emit("pilih", r.label);
  buka.value = false;
}
</script>

<template>
  <div class="rl">
    <div class="rl-title">{{ title }}</div>
    <div v-if="!rows.length" class="msub" style="padding: 8px 0">{{ kosong }}</div>
    <template v-else>
      <div
        v-for="r in top"
        :key="r.label"
        class="rl-row"
        :class="{ klik: klikable, aktif: aktif === r.label }"
        @click="klik(r)"
      >
        <div class="rl-line">
          <span class="rl-label">{{ r.label }}</span>
          <span class="mono rl-val">{{ fmtL(r.value) }} {{ satuan }}</span>
        </div>
        <div class="rl-bar"><i :style="{ width: (r.value / maks) * 100 + '%', background: warna }"></i></div>
        <div v-if="r.sub" class="msub rl-sub">{{ r.sub }}</div>
      </div>
      <button v-if="sisa.length" class="btn btn-ghost btn-sm" style="margin-top: 6px" @click="buka = true">
        Lainnya ({{ sisa.length }}) &rsaquo;
      </button>
    </template>

    <LainnyaModal v-if="buka" :title="title" lebar="640px" @close="buka = false">
      <input v-model="cari" placeholder="Cari…" style="margin-bottom: 10px" />
      <div class="table-wrap" style="max-height: 60vh; overflow-y: auto">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nama</th>
              <th class="num">Jumlah ({{ satuan }})</th>
              <th class="num">Porsi</th>
              <th>Keterangan</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in hasil" :key="r.label" :style="klikable ? 'cursor: pointer' : ''" @click="klik(r)">
              <td class="mono">{{ rows.indexOf(r) + 1 }}</td>
              <td>{{ r.label }}</td>
              <td class="num mono">{{ fmtL(r.value) }}</td>
              <td class="num mono">{{ persen(r.value) }}%</td>
              <td class="msub">{{ r.sub || "-" }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><b>Total</b></td>
              <td class="num mono"><b>{{ fmtL(total) }}</b></td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div v-if="klikable" class="desc" style="margin-top: 8px">Klik baris untuk memfilter daftar transaksi.</div>
    </LainnyaModal>
  </div>
</template>

<style scoped>
.rl-title {
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 8px;
}
.rl-row {
  padding: 5px 6px;
  border-radius: 8px;
  margin: 0 -6px;
}
.rl-row.klik {
  cursor: pointer;
}
.rl-row.klik:hover,
.rl-row.aktif {
  background: var(--bms-blue-soft, #eaf1fb);
}
.rl-line {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}
.rl-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rl-val {
  white-space: nowrap;
  font-weight: 600;
}
.rl-bar {
  height: 6px;
  background: #eef2f7;
  border-radius: 4px;
  margin-top: 3px;
  overflow: hidden;
}
.rl-bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
}
.rl-sub {
  font-size: 11px;
  margin-top: 2px;
}
</style>
