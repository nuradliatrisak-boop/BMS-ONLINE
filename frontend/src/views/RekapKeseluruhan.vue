<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printRekapKeseluruhan } from "../services/print.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function firstDayOfMonthStr() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const divisiList = ref([]);
const dari = ref(firstDayOfMonthStr());
const sampai = ref(todayStr());
const divisiPilihan = ref("ALL"); // "ALL" = semua divisi sekaligus
const data = ref(null);
const loading = ref(false);

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}
function tglLabel(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

const periodeLabel = computed(() => `${tglLabel(dari.value)} \u2013 ${tglLabel(sampai.value)}`);

async function loadDivisiList() {
  try {
    const c = await api.get("/divisi-tx/config");
    divisiList.value = c.divisiList;
  } catch (e) {
    divisiList.value = [];
  }
}

async function load() {
  if (!dari.value || !sampai.value) return toast("Isi rentang tanggal dulu");
  if (new Date(dari.value) > new Date(sampai.value)) return toast("Tanggal 'dari' tidak boleh setelah tanggal 'sampai'");
  loading.value = true;
  try {
    data.value = await api.get(
      `/divisi-tx/rekap-keseluruhan?dari=${dari.value}&sampai=${sampai.value}&divisi=${encodeURIComponent(divisiPilihan.value)}`
    );
  } catch (e) {
    toast(e.message || "Gagal memuat rekap");
    data.value = null;
  } finally {
    loading.value = false;
  }
}

function cetak() {
  if (!data.value) return toast("Tampilkan rekapnya dulu sebelum dicetak");
  printRekapKeseluruhan(data.value);
}

function adaRincian(k) {
  return k.hasQty || k.rows.some((r) => r.subKategori);
}

onMounted(async () => {
  await loadDivisiList();
  await load();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Rekap Keseluruhan</h1>
      <div class="desc">Rekap laba rugi semua divisi, bebas rentang tanggal &amp; bisa dicetak</div>
    </div>
    <button class="btn btn-primary" :disabled="!data || loading" @click="cetak">Cetak</button>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom: 20px">
      <div class="row" style="align-items: flex-end; flex-wrap: wrap">
        <div class="field">
          <label>Dari Tanggal</label>
          <input v-model="dari" type="date" />
        </div>
        <div class="field">
          <label>Sampai Tanggal</label>
          <input v-model="sampai" type="date" />
        </div>
        <div class="field">
          <label>Divisi</label>
          <select v-model="divisiPilihan">
            <option value="ALL">Semua Divisi</option>
            <option v-for="d in divisiList" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="field" style="flex: 0">
          <button class="btn btn-primary" :disabled="loading" @click="load">
            {{ loading ? "Memuat..." : "Tampilkan" }}
          </button>
        </div>
      </div>
      <div class="desc" style="margin-top: 8px">
        Pilih "Semua Divisi" untuk rekap keseluruhan perusahaan (tiap divisi tampil terpisah, ditutup
        total gabungan semua divisi), atau pilih satu divisi untuk rekap divisi itu saja. Tombol Cetak
        mengikuti pilihan filter ini.
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data...</div>

    <template v-else-if="data">
      <div v-for="d in data.divisi" :key="d.divisi" class="lr-doc">
        <div class="lr-head">
          <div class="lr-company">PT. BINTANG MUARA SEJATI</div>
          <div class="lr-title">REKAP LAPORAN &mdash; DIVISI {{ d.divisi.toUpperCase() }}</div>
          <div class="lr-period">Periode {{ periodeLabel }}</div>
        </div>

        <div v-for="k in d.kelompok" :key="k.key" class="card lr-section">
          <div class="section-title">
            {{ k.label }}
            <span class="tag" :class="k.tipe === 'PENJUALAN' ? 'b-lunas' : 'b-belum'">
              {{ k.tipe === "PENJUALAN" ? "Pendapatan" : "Pengeluaran" }}
            </span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width: 40px">No</th>
                  <th>Kategori</th>
                  <th v-if="adaRincian(k)">Rincian</th>
                  <th class="num">Nominal</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in k.rows" :key="r.kategori + (r.subKategori || '')">
                  <td>{{ i + 1 }}</td>
                  <td>{{ r.kategori }}</td>
                  <td v-if="adaRincian(k)">{{ r.subKategori || "-" }}</td>
                  <td class="num mono">{{ rupiah(r.nominal) }}</td>
                </tr>
                <tr v-if="!k.rows.length">
                  <td :colspan="adaRincian(k) ? 4 : 3" class="empty" style="padding: 10px">Belum ada data.</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td :colspan="adaRincian(k) ? 3 : 2"><b>Total {{ k.label }}</b></td>
                  <td class="num mono"><b>{{ rupiah(k.subtotal) }}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="card lr-summary">
          <div class="lr-summary-row"><span>Total Penjualan / Pendapatan</span><b class="mono">{{ rupiah(d.totalPenjualan) }}</b></div>
          <div class="lr-summary-row"><span>Total Pengeluaran</span><b class="mono">{{ rupiah(d.totalPengeluaran) }}</b></div>
          <div class="lr-summary-row lr-final" :class="d.labaBersih >= 0 ? 'lr-positif' : 'lr-negatif'">
            <span>Hasil Bersih (Laba / Rugi)</span>
            <b class="mono">{{ rupiah(d.labaBersih) }}</b>
          </div>
        </div>
      </div>

      <div v-if="data.divisi.length > 1" class="card lr-summary" style="margin-top: 24px; border: 2px solid var(--ink)">
        <div class="section-title" style="margin-bottom: 10px">Total Gabungan Semua Divisi</div>
        <div class="lr-summary-row"><span>Total Pendapatan Seluruh Divisi</span><b class="mono">{{ rupiah(data.grandTotal.totalPenjualan) }}</b></div>
        <div class="lr-summary-row"><span>Total Pengeluaran Seluruh Divisi</span><b class="mono">{{ rupiah(data.grandTotal.totalPengeluaran) }}</b></div>
        <div class="lr-summary-row lr-final" :class="data.grandTotal.labaBersih >= 0 ? 'lr-positif' : 'lr-negatif'">
          <span>Hasil Bersih Keseluruhan</span>
          <b class="mono">{{ rupiah(data.grandTotal.labaBersih) }}</b>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lr-doc {
  max-width: 820px;
  margin-bottom: 32px;
}
.lr-head {
  text-align: center;
  margin-bottom: 18px;
}
.lr-company {
  font-weight: 800;
  font-size: 16px;
  letter-spacing: 0.02em;
}
.lr-title {
  font-weight: 700;
  margin-top: 2px;
}
.lr-period {
  color: var(--ink-soft);
  font-size: 13px;
  margin-top: 2px;
}
.lr-section {
  margin-bottom: 16px;
}
.lr-summary {
  margin-top: 4px;
}
.lr-summary-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 4px;
  border-bottom: 1px solid var(--line);
}
.lr-summary-row:last-child {
  border-bottom: none;
}
.lr-final {
  font-size: 16px;
  margin-top: 4px;
}
.lr-positif b {
  color: #15803d;
}
.lr-negatif b {
  color: #b91c1c;
}
</style>
