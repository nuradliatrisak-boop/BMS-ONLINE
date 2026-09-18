<script setup>
// Dashboard: ringkasan realtime kondisi bisnis.
// Angka-angka di sini dihitung ulang tiap halaman dibuka dari tabel Invoice,
// jadi begitu ada invoice/pembayaran baru (termasuk hasil import Excel),
// statistiknya langsung ikut berubah.
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import PetaTitik from "../components/PetaTitik.vue";

const stats = ref(null);
const loading = ref(true);
const reminder = ref([]);
const peta = ref({ titik: [] });

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}
function angka(n) {
  return (Number(n) || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
function namaBulan(kunci) {
  const [th, bl] = String(kunci).split("-");
  const nama = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  const idx = Number(bl) - 1;
  return nama[idx] ? `${nama[idx]} ${th}` : kunci;
}

const maxSisa = computed(() => {
  const list = stats.value?.topCustomer || [];
  return list.reduce((m, c) => Math.max(m, c.sisa), 0) || 1;
});
const maxKategori = computed(() => {
  const list = stats.value?.perKategoriAlat || [];
  return list.reduce((m, k) => Math.max(m, k.nilai), 0) || 1;
});
const maxBulan = computed(() => {
  const list = stats.value?.perBulan || [];
  return list.reduce((m, b) => Math.max(m, b.tagihan, b.dibayar), 0) || 1;
});
const maxDivisi = computed(() => {
  const list = stats.value?.perDivisiBulanIni || [];
  return list.reduce((m, d) => Math.max(m, d.totalPenjualan, d.totalPengeluaran), 0) || 1;
});
const persenTertagih = computed(() => {
  const t = stats.value?.totalTagihan || 0;
  if (!t) return 0;
  return Math.round(((stats.value.totalDibayar || 0) / t) * 100);
});

// --- Kalender aktivitas bulan ini ---
// Dibangun dari stats.kalender (satu entri per tanggal yang ada
// kegiatannya: invoice/transaksi manual/surat jalan) + stats.bulanIni
// ("YYYY-MM"), disusun jadi grid minggu (Minggu-Sabtu) buat ditampilkan
// sebagai kalender kecil di Dashboard.
const HARI_NAMA = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const todayStr = new Date().toISOString().slice(0, 10);

const kalenderMap = computed(() => {
  const map = new Map();
  for (const h of stats.value?.kalender || []) map.set(h.tanggal, h);
  return map;
});
const maxAktivitas = computed(() => {
  let m = 0;
  for (const h of stats.value?.kalender || []) {
    m = Math.max(m, h.invoiceCount + h.txCount + h.suratJalanCount);
  }
  return m || 1;
});
const kalenderWeeks = computed(() => {
  if (!stats.value?.bulanIni) return [];
  const [y, m] = stats.value.bulanIni.split("-").map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDate = new Date(y, m, 0).getDate();
  const startOffset = firstDay.getDay(); // 0 = Minggu

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) {
    const tgl = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const h = kalenderMap.value.get(tgl) || null;
    cells.push({ tgl, tanggal: d, data: h });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
});
function levelAktivitas(h) {
  if (!h) return 0;
  const jumlah = h.invoiceCount + h.txCount + h.suratJalanCount;
  if (!jumlah) return 0;
  const rasio = jumlah / maxAktivitas.value;
  if (rasio > 0.66) return 3;
  if (rasio > 0.33) return 2;
  return 1;
}
function titleHari(h) {
  if (!h) return "Belum ada kegiatan";
  const parts = [];
  if (h.invoiceCount) parts.push(`${h.invoiceCount} invoice (${rupiah(h.invoiceTotal)})`);
  if (h.txCount) parts.push(`${h.txCount} transaksi divisi (${rupiah(h.txTotal)})`);
  if (h.suratJalanCount) parts.push(`${h.suratJalanCount} surat jalan`);
  return parts.length ? parts.join(" • ") : "Belum ada kegiatan";
}

async function muat() {
  loading.value = true;
  stats.value = await api.get("/dashboard");
  loading.value = false;
  // Pengingat & peta dimuat terpisah supaya kegagalan salah satunya
  // (mis. peta gagal karena offline) tidak menghalangi angka utama tampil.
  try {
    const r = await api.get("/dashboard/reminder");
    reminder.value = r.reminder || [];
  } catch (e) {
    reminder.value = [];
  }
  try {
    peta.value = await api.get("/dashboard/peta");
  } catch (e) {
    peta.value = { titik: [] };
  }
}

const titikPetaStrategis = computed(() =>
  (peta.value?.titik || []).map((p) => ({
    lat: p.lat,
    lng: p.lng,
    label: p.lokasi,
    jenis: p.jenis,
    valueLabel:
      p.jenis === "solar"
        ? `Solar • ${p.liter} Liter • ${p.baris} transaksi`
        : `Sewa Alat • ${rupiah(p.nilai)} • ${p.baris} baris`,
  }))
);

function labelTingkat(t) {
  if (t === "urgent") return "Mendesak";
  if (t === "peringatan") return "Perhatian";
  return "Info";
}

onMounted(muat);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Dashboard</h1>
      <div class="desc">Ringkasan kondisi bisnis saat ini</div>
    </div>
    <button class="btn btn-ghost" @click="muat" :disabled="loading">Muat ulang</button>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>

    <template v-else-if="stats">
      <div class="grid g4">
        <div class="stat">
          <div class="lbl">Total Invoice</div>
          <div class="val">{{ stats.totalInvoice }}</div>
          <div class="note">{{ stats.invoiceBelumLunas }} belum lunas</div>
        </div>
        <div class="stat">
          <div class="lbl">Total Tagihan</div>
          <div class="val">{{ rupiah(stats.totalTagihan) }}</div>
          <div class="note">{{ persenTertagih }}% sudah dibayar</div>
        </div>
        <div class="stat">
          <div class="lbl">Sisa Piutang</div>
          <div class="val">{{ rupiah(stats.sisaPiutang) }}</div>
          <div class="note">sudah masuk {{ rupiah(stats.totalDibayar) }}</div>
        </div>
        <div class="stat">
          <div class="lbl">Surat Jalan</div>
          <div class="val">{{ stats.suratJalanDraft }} draft</div>
          <div class="note">{{ stats.suratJalanBelumTTD }} belum TTD</div>
        </div>
      </div>

      <!-- Piutang per customer: siapa yang paling perlu ditagih -->
      <div class="card" style="margin-top: 14px">
        <div class="section-title">Piutang per Customer (10 terbesar)</div>
        <div v-if="!stats.topCustomer?.length" class="empty">Belum ada invoice.</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th class="num">Invoice</th>
                <th class="num">Tagihan</th>
                <th class="num">Dibayar</th>
                <th class="num">Sisa</th>
                <th style="width: 25%"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in stats.topCustomer" :key="c.nama">
                <td><strong>{{ c.nama }}</strong></td>
                <td class="num">{{ c.jumlahInvoice }}</td>
                <td class="num">{{ rupiah(c.tagihan) }}</td>
                <td class="num">{{ rupiah(c.dibayar) }}</td>
                <td class="num">{{ rupiah(c.sisa) }}</td>
                <td>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: Math.max(0, (c.sisa / maxSisa) * 100) + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pengingat: hal-hal penting yang perlu segera ditindak -->
      <div class="card" style="margin-top: 14px" v-if="reminder.length">
        <div class="section-title">Pengingat</div>
        <div class="pengingat-list">
          <div v-for="(r, i) in reminder" :key="i" class="pengingat-item" :class="`tingkat-${r.tingkat}`">
            <span class="pengingat-badge">{{ labelTingkat(r.tingkat) }}</span>
            <div class="pengingat-body">
              <div class="pengingat-judul">
                <router-link v-if="r.link" :to="r.link">{{ r.judul }}</router-link>
                <span v-else>{{ r.judul }}</span>
              </div>
              <div class="note">{{ r.detail }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Kalender aktivitas bulan ini -->
      <div class="card kalender-card" style="margin-top: 14px" v-if="kalenderWeeks.length">
        <div class="section-title">Kalender Aktivitas &mdash; {{ namaBulan(stats.bulanIni) }}</div>
        <div class="kalender">
          <div class="kalender-head">
            <div v-for="h in HARI_NAMA" :key="h" class="kalender-head-cell">{{ h }}</div>
          </div>
          <div v-for="(week, wi) in kalenderWeeks" :key="wi" class="kalender-row">
            <div
              v-for="(cell, ci) in week"
              :key="ci"
              class="kalender-cell"
              :class="[cell ? `lvl-${levelAktivitas(cell.data)}` : 'kosong', cell?.tgl === todayStr ? 'hari-ini' : '']"
              :title="cell ? titleHari(cell.data) : ''"
            >
              <span v-if="cell" class="kalender-tanggal">{{ cell.tanggal }}</span>
            </div>
          </div>
        </div>
        <div class="note" style="margin-top: 8px">
          Makin gelap warnanya = makin banyak kegiatan (invoice, transaksi divisi, surat jalan) di
          tanggal itu. Arahkan kursor ke tanggalnya untuk lihat rinciannya.
        </div>
      </div>

      <!-- Peta Strategis: gabungan titik lokasi Sewa Alat Berat & Solar Keluar -->
      <div class="card" style="margin-top: 14px">
        <div class="section-title">Peta Strategis &mdash; Lokasi Sewa Alat Berat &amp; Solar</div>
        <PetaTitik :points="titikPetaStrategis" :height="300" empty-text="Belum ada titik lokasi. Isi kolom Lokasi di Rekap Sewa Alat / Solar Keluar, titiknya otomatis muncul di sini." />
        <div class="row" style="margin-top: 8px; gap: 14px; font-size: 12px">
          <span><span class="legenda-dot" style="background:#c8a04a"></span> Sewa Alat Berat</span>
          <span><span class="legenda-dot" style="background:#4a7fc9"></span> Solar</span>
        </div>
      </div>

      <!-- Semua kategori bisnis bulan ini (bukan cuma dari Invoice) -->
      <div class="card" style="margin-top: 14px" v-if="stats.perDivisiBulanIni?.length">
        <div class="section-title">Semua Kategori Bisnis &mdash; {{ namaBulan(stats.bulanIni) }}</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Divisi</th>
                <th class="num">Pendapatan</th>
                <th class="num">Pengeluaran</th>
                <th class="num">Hasil Bersih</th>
                <th style="width: 25%"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in stats.perDivisiBulanIni" :key="d.divisi">
                <td><strong>{{ d.divisi }}</strong></td>
                <td class="num">{{ rupiah(d.totalPenjualan) }}</td>
                <td class="num">{{ rupiah(d.totalPengeluaran) }}</td>
                <td class="num" :style="{ color: d.labaBersih >= 0 ? '#4a9c6d' : '#c0392b' }">
                  {{ rupiah(d.labaBersih) }}
                </td>
                <td>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: (d.totalPenjualan / maxDivisi) * 100 + '%' }"></div>
                  </div>
                  <div class="bar-track" style="margin-top: 3px">
                    <div class="bar-fill alt" :style="{ width: (d.totalPengeluaran / maxDivisi) * 100 + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="note" style="margin-top: 6px">
          Batang emas = pendapatan, batang hijau = pengeluaran. Gabungan Invoice + transaksi manual
          semua divisi (Supplier, Armada, Alat Berat, dst), bukan cuma dari Invoice.
        </div>
      </div>

      <!-- Sewa alat dipecah per kategori alat (Bucket / Breker / Mobilisasi) -->
      <div class="card" style="margin-top: 14px" v-if="stats.perKategoriAlat?.length">
        <div class="section-title">
          Sewa Alat per Kategori
          <router-link to="/rekap-alat" style="font-weight: 400; font-size: 12px; margin-left: 8px">
            lihat rekap lengkap →
          </router-link>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kategori</th>
                <th class="num">Jam</th>
                <th class="num">Nilai</th>
                <th style="width: 35%"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in stats.perKategoriAlat" :key="k.kategori">
                <td><strong>{{ k.kategori }}</strong></td>
                <td class="num">{{ angka(k.jam) }}</td>
                <td class="num">{{ rupiah(k.nilai) }}</td>
                <td>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: (k.nilai / maxKategori) * 100 + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tren 12 bulan terakhir -->
      <div class="card" style="margin-top: 14px" v-if="stats.perBulan?.length">
        <div class="section-title">Tagihan vs Pembayaran (12 bulan terakhir)</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bulan</th>
                <th class="num">Tagihan</th>
                <th class="num">Pembayaran</th>
                <th style="width: 40%"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in stats.perBulan" :key="b.bulan">
                <td>{{ namaBulan(b.bulan) }}</td>
                <td class="num">{{ rupiah(b.tagihan) }}</td>
                <td class="num">{{ rupiah(b.dibayar) }}</td>
                <td>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: (b.tagihan / maxBulan) * 100 + '%' }"></div>
                  </div>
                  <div class="bar-track" style="margin-top: 3px">
                    <div class="bar-fill alt" :style="{ width: (b.dibayar / maxBulan) * 100 + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="note" style="margin-top: 6px">
          Batang emas = tagihan, batang hijau = pembayaran masuk.
        </div>
      </div>

      <!-- Uang makan operator: biaya internal, sengaja tidak ditagih -->
      <div class="card" style="margin-top: 14px" v-if="stats.uangMakanOperator?.total">
        <div class="section-title">Uang Makan Operator (pengeluaran internal)</div>
        <div class="grid g2">
          <div class="stat">
            <div class="lbl">Total Dikeluarkan</div>
            <div class="val">{{ rupiah(stats.uangMakanOperator.total) }}</div>
            <div class="note">{{ stats.uangMakanOperator.jumlahTransaksi }} transaksi</div>
          </div>
          <div class="stat">
            <div class="lbl">Catatan</div>
            <div class="note" style="margin-top: 6px">
              Uang makan operator TIDAK dimasukkan ke tagihan customer. Angkanya
              tercatat sebagai pengeluaran di menu Laporan Divisi (kelompok
              “Uang Makan Operator”) supaya tetap kelihatan tapi tidak menambah omzet.
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bar-track {
  background: rgba(127, 127, 127, 0.18);
  border-radius: 6px;
  height: 10px;
  overflow: hidden;
}
.bar-fill {
  background: #c8a04a;
  height: 100%;
  border-radius: 6px;
}
.bar-fill.alt {
  background: #4a9c6d;
}
.note {
  font-weight: 400;
  font-size: 12px;
  opacity: 0.75;
}

.kalender-head,
.kalender-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 3px;
}
.kalender-card {
  max-width: 360px;
}
.kalender-head { margin-bottom: 3px; }
.kalender-head-cell {
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  opacity: 0.6;
  padding: 1px 0;
}
.kalender-row { margin-bottom: 3px; }
.kalender-cell {
  aspect-ratio: 1 / 1;
  border-radius: 5px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 2px 4px;
  font-size: 9px;
  background: rgba(127, 127, 127, 0.08);
}
.kalender-cell.kosong { background: transparent; }
.kalender-cell.lvl-1 { background: rgba(200, 160, 74, 0.28); }
.kalender-cell.lvl-2 { background: rgba(200, 160, 74, 0.55); }
.kalender-cell.lvl-3 { background: rgba(200, 160, 74, 0.85); color: #fff; }
.kalender-cell.hari-ini { outline: 2px solid #254f8f; outline-offset: -2px; }
.kalender-tanggal { font-weight: 600; }

.pengingat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pengingat-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.06);
  border-left: 3px solid rgba(127, 127, 127, 0.4);
}
.pengingat-item.tingkat-urgent { border-left-color: #c0392b; }
.pengingat-item.tingkat-peringatan { border-left-color: #c8a04a; }
.pengingat-item.tingkat-info { border-left-color: #4a7fc9; }
.pengingat-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(127, 127, 127, 0.15);
  white-space: nowrap;
  margin-top: 2px;
}
.pengingat-judul {
  font-weight: 600;
  font-size: 13px;
}
.legenda-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
</style>