<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

// Laporan INTERNAL hasil bersih: penjualan dikurangi belanja pasir, uang mobil,
// uang jalan, komisi, dan uang makan. Sengaja halaman terpisah dari Rekap
// Penjualan supaya angka ini tidak ikut tercetak ke customer.
const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

function bulanIni() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const bulan = ref(bulanIni());
const divisi = ref("");
const data = ref(null);
const loading = ref(true);

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}
function fmtTgl(d) {
  return d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
}

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (bulan.value) q.set("bulan", bulan.value);
    if (divisi.value) q.set("divisi", divisi.value);
    data.value = await api.get(`/laporan-net?${q.toString()}`);
  } catch (e) {
    toast(e?.message || "Gagal memuat laporan Net");
  } finally {
    loading.value = false;
  }
}

const persen = computed(() => {
  const t = data.value?.total;
  return t && t.penjualan > 0 ? Math.round((t.net / t.penjualan) * 1000) / 10 : 0;
});

watch([bulan, divisi], load);
onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Laporan Net</h1>
      <div class="desc">Hasil bersih per divisi setelah semua potongan — khusus internal, tidak ikut tercetak ke customer</div>
    </div>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="margin:0;">
        <label>Bulan</label>
        <input v-model="bulan" type="month" />
      </div>
      <div class="field" style="margin:0;">
        <label>Divisi</label>
        <select v-model="divisi">
          <option value="">Semua divisi</option>
          <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!data || !data.rows.length" class="empty">
      <div class="big">📊</div>
      <div>Belum ada invoice pada periode ini.</div>
    </div>

    <template v-else>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-bottom:14px;">
        <div class="card" style="margin:0;"><div class="msub">Penjualan</div><b>{{ rupiah(data.total.penjualan) }}</b></div>
        <div class="card" style="margin:0;"><div class="msub">Total potongan</div><b>{{ rupiah(data.total.potongan) }}</b></div>
        <div class="card" style="margin:0;"><div class="msub">Hasil bersih (Net)</div><b>{{ rupiah(data.total.net) }}</b><div class="msub">{{ persen }}% dari penjualan</div></div>
        <div class="card" style="margin:0;"><div class="msub">Jumlah invoice</div><b>{{ data.total.jumlahInvoice }}</b></div>
      </div>

      <div class="card" style="margin-bottom:14px; overflow-x:auto;">
        <div class="section-title">Per divisi</div>
        <table>
          <thead>
            <tr>
              <th>Divisi</th>
              <th class="num">Penjualan</th>
              <th class="num">Belanja pasir</th>
              <th class="num">Uang mobil</th>
              <th class="num">Uang jalan</th>
              <th class="num">Komisi</th>
              <th class="num">Uang makan</th>
              <th class="num">Net</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in data.perDivisi" :key="d.divisi">
              <td>{{ d.divisi }}</td>
              <td class="num mono">{{ rupiah(d.penjualan) }}</td>
              <td class="num mono">{{ rupiah(d.belanjaPasir) }}</td>
              <td class="num mono">{{ rupiah(d.uangMobil) }}</td>
              <td class="num mono">{{ rupiah(d.uangJalan) }}</td>
              <td class="num mono">{{ rupiah(d.uangKomisi) }}</td>
              <td class="num mono">{{ rupiah(d.uangMakan) }}</td>
              <td class="num mono" style="font-weight:600;">{{ rupiah(d.net) }}</td>
            </tr>
            <tr style="font-weight:600;">
              <td>Total</td>
              <td class="num mono">{{ rupiah(data.total.penjualan) }}</td>
              <td class="num mono">{{ rupiah(data.total.belanjaPasir) }}</td>
              <td class="num mono">{{ rupiah(data.total.uangMobil) }}</td>
              <td class="num mono">{{ rupiah(data.total.uangJalan) }}</td>
              <td class="num mono">{{ rupiah(data.total.uangKomisi) }}</td>
              <td class="num mono">{{ rupiah(data.total.uangMakan) }}</td>
              <td class="num mono">{{ rupiah(data.total.net) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="overflow-x:auto;">
        <div class="section-title">Per invoice <span class="tag">{{ data.rows.length }} invoice</span></div>
        <table>
          <thead>
            <tr>
              <th>No Invoice</th>
              <th>Tanggal</th>
              <th>Customer</th>
              <th>Divisi</th>
              <th class="num">Penjualan</th>
              <th class="num">Potongan</th>
              <th class="num">Net</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in data.rows" :key="r.id">
              <td class="mono">{{ r.no }}</td>
              <td>{{ fmtTgl(r.tanggal) }}</td>
              <td>{{ r.customer }}</td>
              <td>{{ r.divisi }}</td>
              <td class="num mono">{{ rupiah(r.penjualan) }}</td>
              <td class="num mono">{{ rupiah(r.potongan) }}</td>
              <td class="num mono" style="font-weight:600;">{{ rupiah(r.net) }}</td>
              <td style="text-align:right;">
                <router-link class="btn btn-sm btn-ghost" :to="{ name: 'invoice-detail', params: { id: r.id } }">Buka</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="msub" style="margin-top:14px;">
        Net dihitung dari rincian biaya di tiap baris invoice. Invoice yang biayanya belum diisi akan terlihat
        Net-nya sama dengan penjualan. Laporan ini terpisah dari pengeluaran manual di Laporan Divisi.
      </div>
    </template>
  </div>
</template>
