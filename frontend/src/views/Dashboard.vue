<script setup>
// Dashboard: ringkasan realtime kondisi bisnis.
// Angka-angka di sini dihitung ulang tiap halaman dibuka dari tabel Invoice,
// jadi begitu ada invoice/pembayaran baru (termasuk hasil import Excel),
// statistiknya langsung ikut berubah.
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";

const stats = ref(null);
const loading = ref(true);

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
const persenTertagih = computed(() => {
  const t = stats.value?.totalTagihan || 0;
  if (!t) return 0;
  return Math.round(((stats.value.totalDibayar || 0) / t) * 100);
});

async function muat() {
  loading.value = true;
  stats.value = await api.get("/dashboard");
  loading.value = false;
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
</style>
