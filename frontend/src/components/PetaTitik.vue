<script setup>
// PETA TITIK LOKASI (reusable)
// =============================
// Komponen peta kecil berbasis Leaflet + OpenStreetMap (gratis, tanpa API
// key). Dipakai di 3 tempat:
//   - Rekap Sewa Alat  -> titik lokasi sewa alat berat
//   - Laporan Divisi (tab Stok Solar) -> titik lokasi Solar Keluar
//   - Dashboard -> "Peta Strategis" gabungan alat berat + solar
//
// PENTING: titik-titik di peta ini SELALU otomatis dari data (lokasi yang
// staf ketik di form lalu digeocode di backend) -- TIDAK ADA fitur tambah
// titik manual/klik-peta di sini, sesuai permintaan (staf cukup ketik nama
// lokasi seperti biasa, titiknya muncul sendiri).
//
// Props:
//   points: [{ lat, lng, label, value, valueLabel, jenis? }]
//     - jenis (opsional): dipakai untuk warna beda per jenis titik (mis.
//       "alat_berat" vs "solar") saat menampilkan gabungan.
//   height: tinggi peta dalam px (default 260 -- sengaja tidak besar)
//   emptyText: teks kalau belum ada titik sama sekali
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps({
  points: { type: Array, default: () => [] },
  height: { type: Number, default: 260 },
  // emptyText dipertahankan supaya pemanggil lama tidak error, tapi tidak lagi
  // ditampilkan: peta kosong tetap tampil demi estetika.
  emptyText: { type: String, default: "" },
});

const WARNA = {
  alat_berat: "#c8a04a",
  solar: "#4a7fc9",
  default: "#4a9c6d",
};

const elPeta = ref(null);
let peta = null;
let layerTitik = null;
let pengamatUkuran = null;
let timerUkuran = null;
let lebarTerakhir = 0;

function buatIkon(warna) {
  return L.divIcon({
    className: "peta-titik-marker",
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${warna};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -7],
  });
}

function gambarTitik() {
  if (!peta) return;
  if (layerTitik) {
    peta.removeLayer(layerTitik);
    layerTitik = null;
  }
  const valid = (props.points || []).filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  );
  if (!valid.length) return;

  // Kalau wadah peta belum punya ukuran (mis. tab/kartu masih tersembunyi),
  // fitBounds akan menghitung zoom dari ukuran 0 -> peta jadi zoom paling jauh
  // (kelihatan seluruh dunia) dan tile cuma termuat sepotong. Jadi ditunda
  // sampai wadah punya ukuran; pengamat ukuran di onMounted akan memanggil
  // ulang fungsi ini begitu wadahnya tampil.
  const ukuran = peta.getSize();
  if (!ukuran.x || !ukuran.y) return;

  const markers = valid.map((p) => {
    const warna = WARNA[p.jenis] || WARNA.default;
    const m = L.marker([p.lat, p.lng], { icon: buatIkon(warna) });
    const nilaiTxt = p.valueLabel || (p.value != null ? String(p.value) : "");
    m.bindPopup(
      `<b>${escapeHtml(p.label || "-")}</b>${nilaiTxt ? `<br/>${escapeHtml(nilaiTxt)}` : ""}`
    );
    return m;
  });

  layerTitik = L.layerGroup(markers).addTo(peta);
  const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
  if (valid.length === 1) {
    peta.setView(bounds.getCenter(), 12);
  } else {
    peta.fitBounds(bounds.pad(0.25), { maxZoom: 14 });
  }
}

// Dipanggil tiap ukuran wadah berubah (data baru masuk, layar diputar,
// sidebar dibuka/tutup, ukuran jendela berubah): Leaflet harus diberi tahu
// supaya tile digambar penuh, lalu titik dipasang ulang ke bingkai.
function sesuaikanUkuran() {
  if (!peta || !elPeta.value) return;
  peta.invalidateSize();
  const lebar = elPeta.value.clientWidth;
  if (lebar && lebar !== lebarTerakhir) {
    lebarTerakhir = lebar;
    gambarTitik();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

onMounted(async () => {
  await nextTick();
  if (!elPeta.value) return;
  // Default view: Indonesia (Jabodetabek-ish), akan langsung fit ke titik
  // asli begitu ada data.
  peta = L.map(elPeta.value, { scrollWheelZoom: false }).setView([-6.3, 106.9], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(peta);
  gambarTitik();

  if (typeof ResizeObserver !== "undefined") {
    pengamatUkuran = new ResizeObserver(() => {
      clearTimeout(timerUkuran);
      timerUkuran = setTimeout(sesuaikanUkuran, 120);
    });
    pengamatUkuran.observe(elPeta.value);
  } else {
    window.addEventListener("resize", sesuaikanUkuran);
  }
  // Jaga-jaga: satu kali lagi setelah layout pertama selesai.
  setTimeout(sesuaikanUkuran, 250);
});

onBeforeUnmount(() => {
  clearTimeout(timerUkuran);
  if (pengamatUkuran) {
    pengamatUkuran.disconnect();
    pengamatUkuran = null;
  }
  window.removeEventListener("resize", sesuaikanUkuran);
  if (peta) {
    peta.remove();
    peta = null;
  }
});

watch(
  () => props.points,
  () => {
    if (peta) peta.invalidateSize();
    gambarTitik();
  },
  { deep: true }
);
</script>

<template>
  <div class="peta-wrap" :style="{ height: height + 'px' }">
    <!-- Peta SELALU dirender (tidak pakai v-show/v-if) supaya wadahnya punya
         ukuran nyata sejak awal; kalau disembunyikan, Leaflet gagal hitung
         ukuran dan tile-nya cuma muncul sepotong di pojok. Kalau belum ada
         titik, peta tetap tampil (default sekitar Jabodetabek) tanpa penanda. -->
    <div ref="elPeta" class="peta-el"></div>
  </div>
</template>

<style scoped>
.peta-wrap {
  position: relative;
  /* isolation: semua z-index internal Leaflet (pane 400, kontrol 1000) terkurung
     di dalam kotak peta ini, jadi peta TIDAK PERNAH menimpa sidebar/menu
     drawer, modal, atau toast di halaman. */
  isolation: isolate;
  z-index: 0;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(127, 127, 127, 0.25);
  background: #e8eef5;
  min-height: 200px;
}
.peta-el {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>
