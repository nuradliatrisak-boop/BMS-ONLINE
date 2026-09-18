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
  emptyText: { type: String, default: "Belum ada titik lokasi untuk ditampilkan." },
});

const WARNA = {
  alat_berat: "#c8a04a",
  solar: "#4a7fc9",
  default: "#4a9c6d",
};

const elPeta = ref(null);
let peta = null;
let layerTitik = null;

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
    peta.fitBounds(bounds.pad(0.25));
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
});

onBeforeUnmount(() => {
  if (peta) {
    peta.remove();
    peta = null;
  }
});

watch(() => props.points, gambarTitik, { deep: true });
</script>

<template>
  <div class="peta-wrap">
    <div v-if="!points?.length" class="peta-kosong" :style="{ height: height + 'px' }">
      {{ emptyText }}
    </div>
    <div v-show="points?.length" ref="elPeta" class="peta-el" :style="{ height: height + 'px' }"></div>
  </div>
</template>

<style scoped>
.peta-wrap {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(127, 127, 127, 0.25);
}
.peta-el {
  width: 100%;
}
.peta-kosong {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  opacity: 0.65;
  background: rgba(127, 127, 127, 0.06);
  padding: 12px;
  text-align: center;
}
</style>
