<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const customers = ref([]);
const rows = ref([]);
const summary = ref({ count: 0, jumlah: 0, total: 0 });
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);

const filter = ref({
  customerId: "",
  customerSearch: "",
  mode: "bulan", // "bulan" atau "rentang"
  bulan: new Date().toISOString().slice(0, 7),
  dari: "",
  sampai: "",
});

const headerForm = ref({
  pic: "",
  noInvoice: "BMS-REKAP-01",
  recipientId: "",
  tujuan: "",
});

const form = ref({
  customerId: "",
  tanggal: new Date().toISOString().slice(0, 10),
  noSuratJalan: "",
  noPolisi: "",
  jenisBarang: "",
  panjang: 0,
  lebar: 0,
  tinggi: 0,
  jumlah: 0,
  harga: 0,
  catatan: "",
});

const selectedCustomer = computed(() => customers.value.find((c) => c.id === filter.value.customerId));

// Daftar customer yang tampil di dropdown, dipersempit sesuai kata kunci
// pencarian nama/kode customer yang diketik user.
const filteredCustomerOptions = computed(() => {
  const q = filter.value.customerSearch.trim().toLowerCase();
  if (!q) return customers.value;
  return customers.value.filter(
    (c) => c.nama.toLowerCase().includes(q) || c.kode.toLowerCase().includes(q)
  );
});
const formCustomer = computed(() => customers.value.find((c) => c.id === form.value.customerId));
const priceOptions = computed(() => formCustomer.value?.prices || []);

// "Tujuan" pada header cetak rekap mengikuti daftar Penerima milik Customer
// (menu Customer > Penerima), bukan lagi langsung dari customer.alamat -
// supaya customer distributor dengan banyak tujuan pengiriman bisa pilih
// alamat penerima yang sesuai untuk lembar rekap ini. Kalau customer belum
// punya daftar Penerima, tujuan default ke alamat customer itu sendiri.
// Field tetap bisa diketik ulang / diedit manual setelah dipilih.
const headerRecipientOptions = computed(() => selectedCustomer.value?.recipients || []);

function applyDefaultHeaderTujuan() {
  headerForm.value.recipientId = "";
  if (headerRecipientOptions.value.length) {
    headerForm.value.tujuan = "";
  } else {
    headerForm.value.tujuan = selectedCustomer.value?.alamat || "";
  }
}

function onHeaderRecipientChange() {
  const r = headerRecipientOptions.value.find((x) => x.id === headerForm.value.recipientId);
  if (r) headerForm.value.tujuan = r.alamat;
}

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

function formatTanggal(tanggal) {
  if (!tanggal) return "-";
  return new Date(tanggal).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function hitungVolume() {
  const p = Number(form.value.panjang || 0);
  const l = Number(form.value.lebar || 0);
  const t = Number(form.value.tinggi || 0);
  return p && l && t ? Number((p * l * t).toFixed(3)) : 0;
}

function applyPrice() {
  const price = priceOptions.value.find((p) => `${p.destinationCode}|${p.stockCode}` === form.value.hargaKey);
  if (!price) return;
  form.value.harga = price.hargaM3;
  form.value.jenisBarang = price.stockName;
}

async function loadCustomers() {
  customers.value = await api.get("/customers");
  if (!filter.value.customerId && customers.value.length) filter.value.customerId = customers.value[0].id;
  if (!form.value.customerId && customers.value.length) form.value.customerId = customers.value[0].id;
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.customerId) params.set("customerId", filter.value.customerId);
    if (filter.value.mode === "bulan" && filter.value.bulan) {
      params.set("bulan", filter.value.bulan);
    } else if (filter.value.mode === "rentang") {
      if (filter.value.dari) params.set("from", filter.value.dari);
      if (filter.value.sampai) params.set("to", filter.value.sampai);
    }
    const data = await api.get(`/rekap-penjualan?${params.toString()}`);
    rows.value = data.rows || [];
    summary.value = data.summary || { count: 0, jumlah: 0, total: 0 };
  } catch (e) {
    console.error(e);
    toast("Gagal memuat rekap penjualan");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  form.value = {
    customerId: filter.value.customerId || customers.value[0]?.id || "",
    tanggal: new Date().toISOString().slice(0, 10),
    noSuratJalan: "",
    noPolisi: "",
    jenisBarang: "",
    panjang: 3.6,
    lebar: 1.9,
    tinggi: 0.95,
    jumlah: 6.498,
    harga: 0,
    hargaKey: "",
    catatan: "",
  };
  showModal.value = true;
}

function closeModal() {
  if (!saving.value) showModal.value = false;
}

async function submit() {
  if (!form.value.customerId || !form.value.tanggal || !form.value.noSuratJalan || !form.value.noPolisi || !form.value.jenisBarang) {
    return toast("Customer, tanggal, nomor surat jalan, nomor polisi, dan jenis barang wajib diisi");
  }

  saving.value = true;
  try {
    const payload = { ...form.value };
    if (!Number(payload.jumlah)) payload.jumlah = hitungVolume();
    await api.post("/rekap-penjualan", payload);
    toast("Data rekap berhasil ditambahkan");
    showModal.value = false;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menyimpan rekap");
  } finally {
    saving.value = false;
  }
}

async function removeRow(id) {
  if (!confirm("Hapus baris rekap ini?")) return;
  try {
    await api.delete(`/rekap-penjualan/${id}`);
    toast("Baris rekap dihapus");
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menghapus data");
  }
}

function printReport() {
  window.print();
}

async function exportExcel() {
  if (!rows.value.length) {
    return toast("Tidak ada data untuk diexport");
  }
  const XLSX = await import("xlsx");
  const data = rows.value.map((r, i) => ({
    No: i + 1,
    Tanggal: formatTanggal(r.tanggal),
    "No Surat Jalan": r.noSuratJalan,
    "No Polisi": r.noPolisi,
    "Jenis Barang": r.jenisBarang,
    P: r.panjang,
    L: r.lebar,
    T: r.tinggi,
    Jumlah: r.jumlah,
    Harga: r.harga,
    Total: r.total,
    Catatan: r.catatan || "",
  }));
  data.push({
    No: "",
    Tanggal: "",
    "No Surat Jalan": "",
    "No Polisi": "",
    "Jenis Barang": "TOTAL",
    P: "",
    L: "",
    T: "",
    Jumlah: summary.value.jumlah,
    Harga: "",
    Total: summary.value.total,
    Catatan: "",
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rekap Penjualan");
  const namaCustomer = selectedCustomer.value?.nama?.replace(/[^a-z0-9]+/gi, "-") || "semua-customer";
  const label =
    filter.value.mode === "bulan" ? filter.value.bulan : `${filter.value.dari || "awal"}_${filter.value.sampai || "akhir"}`;
  XLSX.writeFile(wb, `rekap-penjualan-${namaCustomer}-${label}.xlsx`);
}

watch(
  [
    () => filter.value.customerId,
    () => filter.value.bulan,
    () => filter.value.mode,
    () => filter.value.dari,
    () => filter.value.sampai,
  ],
  load
);
watch(selectedCustomer, (customer) => {
  if (customer) applyDefaultHeaderTujuan();
});
watch(() => filter.value.customerSearch, () => {
  if (
    filter.value.customerId &&
    !filteredCustomerOptions.value.some((c) => c.id === filter.value.customerId)
  ) {
    filter.value.customerId = "";
  }
});

onMounted(async () => {
  try {
    await loadCustomers();
    await load();
  } catch (e) {
    toast("Gagal memuat master customer");
  }
});
</script>

<template>
  <div class="topbar no-print">
    <div>
      <h1>Rekap Penjualan</h1>
      <div class="desc">Rekap tagihan customer dengan format tabel seperti lembar rekap BMS.</div>
    </div>
    <div class="top-actions">
      <button class="btn btn-ghost" @click="printReport">🖨 Cetak Rekap / PDF</button>
      <button class="btn btn-ghost" @click="exportExcel">⬇ Export Excel</button>
      <button class="btn btn-primary" @click="openModal">＋ Tambah Baris</button>
    </div>
  </div>

  <div class="content no-print">
    <div class="card filter-card">
      <div class="row">
        <div class="field">
          <label>Cari Customer <span class="opt">(nama / kode)</span></label>
          <input
            v-model="filter.customerSearch"
            placeholder="Ketik nama customer..."
          />
        </div>
        <div class="field">
          <label>Customer</label>
          <select v-model="filter.customerId">
            <option value="">Semua Customer</option>
            <option v-for="c in filteredCustomerOptions" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option>
          </select>
        </div>
        <div class="field">
          <label>Durasi</label>
          <select v-model="filter.mode">
            <option value="bulan">Per Bulan</option>
            <option value="rentang">Rentang Tanggal</option>
          </select>
        </div>
        <div class="field" v-if="filter.mode === 'bulan'">
          <label>Bulan</label>
          <input v-model="filter.bulan" type="month" />
        </div>
        <template v-else>
          <div class="field"><label>Dari Tanggal</label><input v-model="filter.dari" type="date" /></div>
          <div class="field"><label>Sampai Tanggal</label><input v-model="filter.sampai" type="date" /></div>
        </template>
      </div>
      <div class="row">
        <div class="field"><label>No. Invoice Rekapan</label><input v-model="headerForm.noInvoice" /></div>
        <div class="field"><label>PIC / Kepada</label><input v-model="headerForm.pic" placeholder="Contoh: Bp. Ali" /></div>
      </div>
      <div class="row" v-if="headerRecipientOptions.length">
        <div class="field">
          <label>Pilih Penerima <span class="opt">(customer ini punya {{ headerRecipientOptions.length }} tujuan)</span></label>
          <select v-model="headerForm.recipientId" @change="onHeaderRecipientChange">
            <option value="" disabled>Pilih penerima...</option>
            <option v-for="r in headerRecipientOptions" :key="r.id" :value="r.id">{{ r.nama }}</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Tujuan</label><input v-model="headerForm.tujuan" placeholder="Alamat / tujuan tagihan" /></div>
    </div>

    <div class="rekap-summary grid g3">
      <div class="stat"><div class="lbl">JUMLAH BARIS</div><div class="val">{{ summary.count }}</div></div>
      <div class="stat"><div class="lbl">TOTAL VOLUME</div><div class="val">{{ Number(summary.jumlah || 0).toLocaleString("id-ID") }}</div></div>
      <div class="stat"><div class="lbl">TOTAL TAGIHAN</div><div class="val">{{ rupiah(summary.total) }}</div></div>
    </div>

    <div class="card">
      <div v-if="loading" class="empty">Memuat rekap...</div>
      <div v-else-if="!rows.length" class="empty">
        <div class="big">🧾</div>
        <strong>Belum ada data rekap</strong>
        <div class="empty-desc">Tambahkan baris dari surat jalan yang sudah selesai untuk membentuk rekap tagihan customer.</div>
        <button class="btn btn-primary" style="margin-top:14px" @click="openModal">＋ Tambah Baris</button>
      </div>
      <div v-else class="table-wrap rekap-table-wrap">
        <table class="rekap-table">
          <thead>
            <tr>
              <th>No</th><th>Tanggal</th><th>No Surat Jalan</th><th>No Polisi</th><th>Jenis Barang</th>
              <th>P</th><th>L</th><th>T</th><th>Jumlah</th><th>Harga</th><th>Total</th><th class="no-print">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, idx) in rows" :key="r.id">
              <td>{{ idx + 1 }}</td>
              <td>{{ formatTanggal(r.tanggal) }}</td>
              <td class="mono">{{ r.noSuratJalan }}</td>
              <td class="mono">{{ r.noPolisi }}</td>
              <td>{{ r.jenisBarang }}</td>
              <td class="num">{{ r.panjang.toFixed(2) }}</td>
              <td class="num">{{ r.lebar.toFixed(2) }}</td>
              <td class="num">{{ r.tinggi.toFixed(2) }}</td>
              <td class="num">{{ Number(r.jumlah).toLocaleString("id-ID") }}</td>
              <td class="num">{{ Math.round(r.harga).toLocaleString("id-ID") }}</td>
              <td class="num">{{ Math.round(r.total).toLocaleString("id-ID") }}</td>
              <td class="no-print"><button class="btn btn-sm btn-danger" @click="removeRow(r.id)">Hapus</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- PRINT DOCUMENT: struktur mengikuti lembar rekap fisik BMS -->
  <div class="print-document">
    <div class="print-paper">
      <div class="company-header">
        <div class="logo-box"><img src="/bms-logo.jpeg" alt="BM" /></div>
        <div>
          <div class="company-name">BINTANG MUARA SEJATI</div>
          <div class="company-sub">Trucking, Angkutan Kapal Contractor, Supplier</div>
          <div class="company-address">Head Office : Jl. Cilincing Baru, Kelapa Gading, Jakarta Utara<br />Phone : (021) 494 0288 - 440 5323 &nbsp; Fax : (021) 440 5323</div>
        </div>
      </div>

      <div class="print-meta">
        <div><span>Rekapan Invoice</span><strong>{{ selectedCustomer?.nama || "-" }}</strong></div>
        <div><span>Kepada</span><strong>{{ headerForm.pic || "-" }}</strong></div>
        <div><span>No. Invoice</span><strong>{{ headerForm.noInvoice || "-" }}</strong></div>
        <div><span>Tujuan</span><strong>{{ headerForm.tujuan || selectedCustomer?.alamat || "-" }}</strong></div>
      </div>

      <table class="print-table">
        <thead>
          <tr>
            <th>No</th><th>Tanggal</th><th>No Surat Jalan</th><th>No Polisi</th><th>Jenis Barang</th>
            <th>P</th><th>L</th><th>T</th><th>Jumlah</th><th>Harga</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, idx) in rows" :key="r.id">
            <td>{{ idx + 1 }}</td><td>{{ formatTanggal(r.tanggal) }}</td><td>{{ r.noSuratJalan }}</td><td>{{ r.noPolisi }}</td><td>{{ r.jenisBarang }}</td>
            <td>{{ r.panjang.toFixed(2) }}</td><td>{{ r.lebar.toFixed(2) }}</td><td>{{ r.tinggi.toFixed(2) }}</td><td>{{ Number(r.jumlah).toLocaleString("id-ID") }}</td><td>{{ Math.round(r.harga).toLocaleString("id-ID") }}</td><td>{{ Math.round(r.total).toLocaleString("id-ID") }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td colspan="8" class="total-label">TOTAL</td><td>{{ Number(summary.jumlah || 0).toLocaleString("id-ID") }}</td><td></td><td>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</td></tr>
        </tfoot>
      </table>

      <div class="print-total-box">
        <div><span>Jumlah Tagihan</span><strong>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</strong></div>
        <div><span>Total Bayar</span><strong>-</strong></div>
        <div><span>Total Tagihan</span><strong>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</strong></div>
      </div>

      <div class="print-footer-date">Jakarta, {{ new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) }}</div>
      <div class="signature"><strong>Syamsul Syamsudin Hasan</strong><span>Direktur</span></div>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal rekap-modal">
      <button class="modal-close" @click="closeModal">×</button>
      <h2>Tambah Data Rekap</h2>
      <div class="msub">Masukkan satu baris transaksi. Total dihitung otomatis dari jumlah × harga.</div>

      <div class="row">
        <div class="field"><label>Customer</label><select v-model="form.customerId"><option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option></select></div>
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
      </div>
      <div class="row">
        <div class="field"><label>No Surat Jalan</label><input v-model="form.noSuratJalan" placeholder="Contoh: 00345" /></div>
        <div class="field"><label>No Polisi</label><input v-model="form.noPolisi" placeholder="B 9086 UYY" /></div>
      </div>
      <div class="field">
        <label>Pilih Harga Customer (opsional)</label>
        <select v-model="form.hargaKey" @change="applyPrice">
          <option value="">-- Pilih master harga --</option>
          <option v-for="p in priceOptions" :key="p.id" :value="`${p.destinationCode}|${p.stockCode}`">{{ p.destinationCode }} / {{ p.stockCode }} — {{ p.stockName }} — {{ rupiah(p.hargaM3) }}</option>
        </select>
      </div>
      <div class="field"><label>Jenis Barang</label><input v-model="form.jenisBarang" placeholder="Pasir Bangka / Split / Batu Belah" /></div>
      <div class="row row-4">
        <div class="field"><label>P</label><input v-model.number="form.panjang" type="number" step="0.01" /></div>
        <div class="field"><label>L</label><input v-model.number="form.lebar" type="number" step="0.01" /></div>
        <div class="field"><label>T</label><input v-model.number="form.tinggi" type="number" step="0.01" /></div>
        <div class="field"><label>Jumlah</label><input v-model.number="form.jumlah" type="number" step="0.001" /></div>
      </div>
      <div class="field"><label>Harga</label><input v-model.number="form.harga" type="number" min="0" /></div>
      <div class="volume-hint">Volume dari P × L × T: <strong>{{ hitungVolume() || 0 }}</strong> — jumlah dapat diisi sesuai data aktual surat jalan.</div>

      <div class="modal-actions">
        <button class="btn btn-ghost" :disabled="saving" @click="closeModal">Batal</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? "Menyimpan..." : "Simpan Baris" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top-actions { display:flex; gap:8px; }
.filter-card { margin-bottom:16px; }
.rekap-summary { margin-bottom:16px; }
.opt { font-weight:400; color:var(--ink-soft); font-size:11px; }
.table-wrap { width:100%; overflow-x:auto; }
.rekap-table { min-width:1100px; }
.rekap-table th,.rekap-table td { white-space:nowrap; }
.rekap-table td.num,.rekap-table th.num { text-align:right; }
.rekap-modal { max-width:760px; }
.row-4 { grid-template-columns:repeat(4,1fr); }
.volume-hint { padding:9px 11px; border-radius:8px; background:var(--bms-blue-soft); color:var(--ink-soft); font-size:11px; }
.print-document { display:none; }

@media (max-width:700px) {
  .top-actions { flex-direction:column; }
  .top-actions .btn { width:100%; justify-content:center; }
  .row-4 { grid-template-columns:1fr 1fr; }
}

@media print {
  @page { size:A4 landscape; margin:9mm; }
  body { background:#fff !important; }
  .no-print, .sidebar, .topbar, .content { display:none !important; }
  .print-document { display:block !important; }
  .print-paper { color:#111; font-family:Arial, sans-serif; font-size:9px; }
  .company-header { display:flex; align-items:center; gap:10px; padding-bottom:6px; border-bottom:2px solid #222; }
  .logo-box { width:50px; height:50px; display:flex; align-items:center; justify-content:center; }
  .logo-box img { max-width:48px; max-height:48px; object-fit:contain; }
  .company-name { font-size:18px; font-weight:800; letter-spacing:1.5px; color:#254f8f; }
  .company-sub { font-size:9px; font-weight:700; margin-top:1px; }
  .company-address { font-size:8px; line-height:1.35; margin-top:3px; }
  .print-meta { display:grid; grid-template-columns:100px 1fr 80px 1fr; gap:2px 7px; margin:8px 0 6px; }
  .print-meta div { display:contents; }
  .print-meta span { font-weight:700; }
  .print-meta strong { font-weight:400; }
  .print-table { width:100%; border-collapse:collapse; }
  .print-table th,.print-table td { border:1px solid #555; padding:3px 4px; text-align:center; }
  .print-table th { background:#f3f3f3; font-weight:800; }
  .print-table td:nth-child(5) { text-align:left; }
  .print-table tfoot td { font-weight:800; }
  .total-label { text-align:right !important; }
  .print-total-box { display:grid; grid-template-columns:1fr 1fr 1fr; border:1px solid #555; margin-top:4px; }
  .print-total-box div { display:grid; grid-template-columns:1fr 110px; padding:4px 7px; border-right:1px solid #555; }
  .print-total-box div:last-child { border-right:none; }
  .print-total-box span { font-weight:700; }
  .print-total-box strong { text-align:right; }
  .print-footer-date { text-align:right; margin-top:12px; }
  .signature { width:180px; margin:22px 0 0 auto; display:flex; flex-direction:column; align-items:center; gap:2px; }
  .signature strong { text-decoration:underline; }
}
</style>
