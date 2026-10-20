<script setup>
// Laporan per Customer (khusus admin): tiap customer -> tagihan, dibayar, sisa, potongan, HPP proyek,
// upah kuli, diskon, hasil bersih. Klik baris = rincian rekapan -> invoice. Cetak Excel / PDF:
//   "Versi Customer"  = tagihan, dibayar, sisa + rekapan + invoice + detail (TANPA angka internal)
//   "Versi Internal"  = lengkap dengan pengeluaran & hasil bersih
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { exportLaporanCustomerExcel, exportLaporanCustomerPdf } from "../utils/laporanExport.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const pad = (n) => String(n).padStart(2, "0");
const d0 = new Date();
const dari = ref(`${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-01`);
const sampai = ref("");
const divisi = ref("");
const customerId = ref("");
const customers = ref([]);
const data = ref(null);
const loading = ref(true);
const buka = ref("");
const mencetak = ref("");

const rupiah = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const fmtTgl = (t) => { const [y, m, d] = String(t || "").slice(0, 10).split("-"); return y ? `${d}/${m}/${y}` : "-"; };

function query(detail) {
  const q = new URLSearchParams();
  if (dari.value) q.set("dari", dari.value);
  if (sampai.value) q.set("sampai", sampai.value);
  if (divisi.value) q.set("divisi", divisi.value);
  if (customerId.value) q.set("customerId", customerId.value);
  if (detail) q.set("detail", "1");
  return q.toString();
}
async function muat() {
  loading.value = true;
  try {
    data.value = await api.get(`/laporan-customer?${query(false)}`);
  } catch (e) {
    toast(e.message || "Gagal memuat laporan");
  } finally {
    loading.value = false;
  }
}
async function cetak(format, mode) {
  mencetak.value = `${format}-${mode}`;
  try {
    const lengkap = await api.get(`/laporan-customer?${query(true)}`);
    if (!lengkap.rows.length) return toast("Tidak ada data untuk dicetak");
    if (format === "excel") exportLaporanCustomerExcel(lengkap, mode);
    else await exportLaporanCustomerPdf(lengkap, mode);
  } catch (e) {
    toast(e.message || "Gagal mencetak");
  } finally {
    mencetak.value = "";
  }
}
const warnaBersih = (n) => (n >= 0 ? "#159447" : "#c0392b");
const tampil = computed(() => data.value?.rows || []);

onMounted(async () => {
  try { customers.value = await api.get("/customers"); } catch { /* filter customer opsional */ }
  muat();
});
watch([dari, sampai, divisi, customerId], muat);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Laporan per Customer</h1>
      <div class="desc">Per customer: pemasukan (tagihan, dibayar, sisa) dan pengeluaran, sampai hasil bersih — lengkap rekapan, invoice, dan detailnya</div>
    </div>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom: 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end">
      <div class="field" style="margin: 0"><label>Dari tanggal</label><input v-model="dari" type="date" /></div>
      <div class="field" style="margin: 0"><label>Sampai tanggal</label><input v-model="sampai" type="date" /></div>
      <div class="field" style="margin: 0">
        <label>Divisi</label>
        <select v-model="divisi"><option value="">Semua divisi</option><option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option></select>
      </div>
      <div class="field" style="margin: 0">
        <label>Customer</label>
        <select v-model="customerId"><option value="">Semua customer</option><option v-for="c in customers" :key="c.id" :value="c.id">{{ c.nama }}</option></select>
      </div>
    </div>

    <div class="card" style="margin-bottom: 14px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
      <b style="margin-right: 4px">Cetak:</b>
      <button class="btn btn-sm" :disabled="!!mencetak" @click="cetak('excel', 'customer')">Excel — versi customer</button>
      <button class="btn btn-sm" :disabled="!!mencetak" @click="cetak('pdf', 'customer')">PDF — versi customer</button>
      <button class="btn btn-sm btn-gold" :disabled="!!mencetak" @click="cetak('excel', 'internal')">Excel — versi internal</button>
      <button class="btn btn-sm btn-gold" :disabled="!!mencetak" @click="cetak('pdf', 'internal')">PDF — versi internal</button>
      <span v-if="mencetak" class="msub">Menyiapkan file…</span>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!tampil.length" class="empty"><div class="big">📊</div><div>Belum ada invoice pada periode ini.</div></div>

    <template v-else>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 14px">
        <div class="card" style="margin: 0"><div class="msub">Total tagihan</div><b>{{ rupiah(data.total.tagihan) }}</b></div>
        <div class="card" style="margin: 0"><div class="msub">Sudah dibayar</div><b>{{ rupiah(data.total.dibayar) }}</b></div>
        <div class="card" style="margin: 0"><div class="msub">Sisa tagihan (piutang)</div><b style="color: #c47b12">{{ rupiah(data.total.sisa) }}</b></div>
        <div class="card" style="margin: 0"><div class="msub">Total pengeluaran + diskon</div><b>{{ rupiah(data.total.totalPengeluaran + data.total.diskon) }}</b></div>
        <div class="card" style="margin: 0"><div class="msub">Hasil bersih ({{ data.total.persenBersih }}%)</div><b :style="{ color: warnaBersih(data.total.bersih) }">{{ rupiah(data.total.bersih) }}</b></div>
      </div>

      <div class="card" style="overflow-x: auto">
        <table>
          <thead>
            <tr>
              <th>Customer</th><th class="num">Invoice</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Sisa</th>
              <th class="num">Potongan</th><th class="num">HPP proyek</th><th class="num">Upah kuli</th><th class="num">Diskon</th><th class="num">Hasil bersih</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="r in tampil" :key="r.customerId">
              <tr class="clickable-row" @click="buka = buka === r.customerId ? '' : r.customerId">
                <td><b>{{ buka === r.customerId ? "▾" : "▸" }} {{ r.customer }}</b></td>
                <td class="num mono">{{ r.jumlahInvoice }}</td>
                <td class="num mono">{{ rupiah(r.tagihan) }}</td>
                <td class="num mono">{{ rupiah(r.dibayar) }}</td>
                <td class="num mono" :style="{ color: r.sisa > 0 ? '#c47b12' : '' }">{{ rupiah(r.sisa) }}</td>
                <td class="num mono">{{ rupiah(r.potonganInvoice) }}</td>
                <td class="num mono">{{ rupiah(r.hppProyek) }}</td>
                <td class="num mono">{{ rupiah(r.upahKuli) }}</td>
                <td class="num mono">{{ rupiah(r.diskon) }}</td>
                <td class="num mono"><b :style="{ color: warnaBersih(r.bersih) }">{{ rupiah(r.bersih) }}</b><div class="msub">{{ r.persenBersih }}%</div></td>
              </tr>
              <tr v-if="buka === r.customerId">
                <td colspan="10" style="background: #fafafa">
                  <div v-for="g in r.rekap" :key="g.noRekap" style="margin-bottom: 10px">
                    <div style="font-weight: 600; margin-bottom: 4px">
                      {{ g.noRekap ? "Rekapan No. " + g.noRekap : "Invoice tanpa nomor rekapan" }}
                      <span class="msub"> • tagihan {{ rupiah(g.tagihan) }} • dibayar {{ rupiah(g.dibayar) }} • sisa {{ rupiah(g.sisa) }}</span>
                    </div>
                    <table>
                      <thead><tr><th>No. Invoice</th><th>Tanggal</th><th>Divisi</th><th>Status</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Sisa</th></tr></thead>
                      <tbody>
                        <tr v-for="v in g.invoices" :key="v.id">
                          <td class="mono">{{ v.no }}</td><td>{{ fmtTgl(v.tanggal) }}</td><td>{{ v.divisi }}</td><td>{{ v.status }}</td>
                          <td class="num mono">{{ rupiah(v.total) }}</td><td class="num mono">{{ rupiah(v.dibayar) }}</td><td class="num mono">{{ rupiah(v.sisa) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </td>
              </tr>
            </template>
            <tr style="font-weight: 600">
              <td>TOTAL</td><td class="num mono">{{ data.total.jumlahInvoice }}</td>
              <td class="num mono">{{ rupiah(data.total.tagihan) }}</td><td class="num mono">{{ rupiah(data.total.dibayar) }}</td><td class="num mono">{{ rupiah(data.total.sisa) }}</td>
              <td class="num mono">{{ rupiah(data.total.potonganInvoice) }}</td><td class="num mono">{{ rupiah(data.total.hppProyek) }}</td>
              <td class="num mono">{{ rupiah(data.total.upahKuli) }}</td><td class="num mono">{{ rupiah(data.total.diskon) }}</td>
              <td class="num mono" :style="{ color: warnaBersih(data.total.bersih) }">{{ rupiah(data.total.bersih) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="msub" style="margin-top: 8px">Hasil bersih = Tagihan − Potongan invoice − HPP proyek − Upah kuli − Diskon. Proyek / PO yang customer-nya hanya diketik teks (tidak dari master Customer) tidak ikut terhitung.</div>
      </div>
    </template>
  </div>
</template>
