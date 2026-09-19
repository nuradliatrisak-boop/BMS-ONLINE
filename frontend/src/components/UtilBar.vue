<script setup>
// UTIL BAR (global, tampil di semua halaman setelah login)
// ========================================================
// Strip tipis di paling atas area konten: sapaan di kiri, dan di pojok kanan
// "kartu jam" yang menampilkan hari, tanggal, tahun, dan jam berjalan (WIB).
// Dipasang sekali di App.vue, jadi otomatis muncul di SEMUA menu tanpa perlu
// menyentuh tiap halaman.
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useAuthStore } from "../stores/auth.js";

const auth = useAuthStore();
const TZ = "Asia/Jakarta"; // WIB -- patokan perusahaan, apa pun setelan zona HP/PC

const sekarang = ref(new Date());
let timer = null;

const fmtLengkap = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const fmtBulanPendek = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, month: "short" });

const bagian = computed(() => {
  const o = {};
  for (const p of fmtLengkap.formatToParts(sekarang.value)) o[p.type] = p.value;
  return o;
});
const bulanPendek = computed(() => fmtBulanPendek.format(sekarang.value).replace(".", ""));
const jam = computed(() => String(bagian.value.hour || "00").padStart(2, "0"));
const menit = computed(() => String(bagian.value.minute || "00").padStart(2, "0"));
const detik = computed(() => String(bagian.value.second || "00").padStart(2, "0"));

const sapaan = computed(() => {
  const h = Number(jam.value);
  if (h >= 4 && h < 11) return "Selamat pagi";
  if (h >= 11 && h < 15) return "Selamat siang";
  if (h >= 15 && h < 18) return "Selamat sore";
  return "Selamat malam";
});

function tick() {
  sekarang.value = new Date();
}
function saatTabKembali() {
  if (!document.hidden) tick();
}

onMounted(() => {
  timer = setInterval(tick, 1000);
  document.addEventListener("visibilitychange", saatTabKembali);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener("visibilitychange", saatTabKembali);
});
</script>

<template>
  <header class="utilbar">
    <div class="ub-salam">
      <span class="ub-salam-kecil">{{ sapaan }},</span>
      <strong class="ub-nama">{{ auth.user?.nama || "Pengguna" }}</strong>
    </div>

    <div class="jt" role="timer" :aria-label="`${bagian.weekday}, ${bagian.day} ${bagian.month} ${bagian.year}, pukul ${jam}.${menit} WIB`">
      <div class="jt-tile" aria-hidden="true">
        <span class="jt-bulan">{{ bulanPendek }}</span>
        <span class="jt-tgl">{{ bagian.day }}</span>
      </div>

      <div class="jt-info" aria-hidden="true">
        <span class="jt-hari">{{ bagian.weekday }}</span>
        <span class="jt-tanggal">{{ bagian.day }} {{ bagian.month }} {{ bagian.year }}</span>
      </div>

      <div class="jt-sep" aria-hidden="true"></div>

      <div class="jt-waktu" aria-hidden="true">
        <span class="jt-jam">{{ jam }}<i class="jt-colon">:</i>{{ menit }}</span>
        <span class="jt-detik">{{ detik }}</span>
        <span class="jt-zona">WIB</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.utilbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 34px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
  min-height: 64px;
}

/* Sapaan */
.ub-salam {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}
.ub-salam-kecil {
  font-size: 11.5px;
  color: var(--ink-soft);
}
.ub-nama {
  font-family: "Space Grotesk", sans-serif;
  font-size: 15px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 46vw;
}

/* Kartu jam */
.jt {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  padding: 7px 16px 7px 8px;
  border-radius: 14px;
  color: #fff;
  background:
    radial-gradient(120% 140% at 100% 0%, rgba(200, 160, 74, 0.28) 0%, rgba(200, 160, 74, 0) 55%),
    linear-gradient(135deg, #173f7a 0%, #2459a6 100%);
  box-shadow: 0 6px 18px rgba(23, 63, 122, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.jt-tile {
  width: 44px;
  height: 46px;
  border-radius: 10px;
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  flex: 0 0 auto;
}
.jt-bulan {
  width: 100%;
  text-align: center;
  background: var(--bms-red);
  color: #fff;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 15px;
}
.jt-tgl {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 700;
  font-size: 21px;
  line-height: 31px;
  color: var(--ink);
}

.jt-info {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  white-space: nowrap;
}
.jt-hari {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 700;
  font-size: 15px;
}
.jt-tanggal {
  font-size: 12px;
  color: #c6d8f0;
}

.jt-sep {
  width: 1px;
  align-self: stretch;
  margin: 4px 0;
  background: rgba(255, 255, 255, 0.22);
}

.jt-waktu {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.jt-jam {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.jt-colon {
  font-style: normal;
  margin: 0 1px;
  animation: jt-kedip 1s steps(1, end) infinite;
}
.jt-detik {
  font-size: 13px;
  font-weight: 600;
  color: #f0d48a;
  min-width: 2ch;
}
.jt-zona {
  margin-left: 4px;
  align-self: center;
  font-family: "Inter", sans-serif;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 999px;
  color: #173f7a;
  background: #f0d48a;
}
@keyframes jt-kedip {
  50% { opacity: 0.25; }
}
@media (prefers-reduced-motion: reduce) {
  .jt-colon { animation: none; }
}

/* Tablet */
@media (max-width: 1100px) {
  .utilbar { padding-left: 24px; padding-right: 24px; }
}

/* Tablet potret & HP: ada tombol hamburger di kiri (fixed), jadi sisakan ruang. */
@media (max-width: 900px) {
  .utilbar { padding-left: 64px; padding-right: 14px; }
}
@media (max-width: 640px) {
  .ub-salam { display: none; }   /* ruang HP sempit: sapaan disembunyikan */
  .jt { padding-right: 12px; gap: 10px; }
  .jt-hari { font-size: 14px; }
  .jt-jam { font-size: 21px; }
}
@media (max-width: 440px) {
  .jt-info { display: none; }    /* tile tanggal + jam sudah cukup */
  .jt-sep { display: none; }
  .jt { gap: 10px; }
}
</style>
