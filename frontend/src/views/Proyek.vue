<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";

// Rekap per proyek Divisi Kontraktor:
//   Tagihan (dari Invoice yang ditautkan) - Pengeluaran/HPP - Diskon = Margin.
// Pengeluaran otomatis tercermin di Laporan Divisi > Kontraktor > Pengeluaran.

const auth = useAuthStore();
const rupiah = (n) => {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "-Rp " : "Rp ") + Math.abs(v).toLocaleString("id-ID");
};
const angka = (n) => (Number(n) || 0).toLocaleString("id-ID", { maximumFractionDigits: 3 });
const fmtTgl = (d) =>
  d ? new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "-";
const tglInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const hariIni = () => new Date().toISOString().slice(0, 10);

const JENIS = [
  { v: "HPP", label: "Pengeluaran / HPP" },
  { v: "POTONGAN_HPP", label: "Pengurang HPP (mis. sisa material)" },
  { v: "DISKON", label: "Diskon ke customer" },
];
const jenisLabel = (v) => ({ HPP: "HPP", POTONGAN_HPP: "Pengurang HPP", DISKON: "Diskon" }[v] || v);

const list = ref([]);
const loading = ref(true);
const customers = ref([]);
const cari = ref("");

async function load() {
  loading.value = true;
  try {
    list.value = await api.get("/proyek");
  } catch (e) {
    toast(e.message || "Gagal memuat proyek");
  } finally {
    loading.value = false;
  }
}
async function loadCustomers() {
  try {
    customers.value = await api.get("/customers");
  } catch {
    customers.value = [];
  }
}

const tampil = computed(() => {
  const q = cari.value.trim().toLowerCase();
  if (!q) return list.value;
  return list.value.filter((p) => `${p.nama} ${p.namaCustomer || ""} ${p.lokasi || ""}`.toLowerCase().includes(q));
});

const total = computed(() =>
  list.value.reduce(
    (t, p) => {
      t.tagihan += p.ringkasan.tagihan;
      t.sisa += p.ringkasan.sisaTagihan;
      t.margin += p.ringkasan.margin;
      return t;
    },
    { tagihan: 0, sisa: 0, margin: 0 }
  )
);

// ---------- Form proyek ----------
const formProyek = ref(null);
function bukaTambah() {
  formProyek.value = { id: null, nama: "", customerId: "", namaCustomer: "", lokasi: "", catatan: "" };
}
function bukaEditProyek() {
  const p = detail.value;
  formProyek.value = {
    id: p.id,
    nama: p.nama,
    customerId: p.customerId || "",
    namaCustomer: p.customerId ? "" : p.namaCustomer || "",
    lokasi: p.lokasi || "",
    catatan: p.catatan || "",
  };
}
async function simpanProyek() {
  const f = formProyek.value;
  if (!f.nama.trim()) return toast("Nama proyek wajib diisi");
  try {
    const body = { nama: f.nama, customerId: f.customerId || null, namaCustomer: f.namaCustomer, lokasi: f.lokasi, catatan: f.catatan };
    if (f.id) {
      detail.value = await api.put(`/proyek/${f.id}`, body);
      toast("Proyek diperbarui");
    } else {
      const baru = await api.post("/proyek", body);
      toast("Proyek ditambahkan");
      detail.value = baru;
    }
    formProyek.value = null;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan proyek");
  }
}
async function hapusProyek() {
  const p = detail.value;
  if (!confirm(`Hapus proyek "${p.nama}"?\nBaris pengeluarannya ikut terhapus (juga dari Laporan Divisi). Invoice TIDAK terhapus, hanya dilepas dari proyek.`)) return;
  try {
    await api.delete(`/proyek/${p.id}`);
    toast("Proyek dihapus");
    detail.value = null;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus proyek");
  }
}

// ---------- Detail ----------
const detail = ref(null);
async function bukaDetail(p) {
  try {
    detail.value = await api.get(`/proyek/${p.id}`);
  } catch (e) {
    toast(e.message || "Gagal membuka proyek");
  }
}
async function tutupDetail() {
  detail.value = null;
  await load();
}
function setDetail(p) {
  detail.value = p;
}

const biayaPerJenis = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return JENIS.map((j) => ({ ...j, rows: d.biaya.filter((b) => b.jenis === j.v) })).filter((g) => g.rows.length);
});
const semuaPembayaran = computed(() => {
  const d = detail.value;
  if (!d) return [];
  return d.invoices
    .flatMap((i) => i.pembayaran.map((x) => ({ ...x, invoiceNo: i.no })))
    .sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
});

// ---------- Form biaya ----------
const formBiaya = ref(null);
function bukaBiaya(b = null, jenis = "HPP") {
  formBiaya.value = b
    ? {
        id: b.id,
        jenis: b.jenis,
        tanggal: tglInput(b.tanggal),
        uraian: b.uraian,
        qty: b.qty ?? "",
        satuan: b.satuan || "",
        hargaSatuan: b.hargaSatuan ?? "",
        nominal: b.qty != null && b.hargaSatuan != null ? "" : b.nominal,
        catatan: b.catatan || "",
      }
    : { id: null, jenis, tanggal: hariIni(), uraian: "", qty: "", satuan: "", hargaSatuan: "", nominal: "", catatan: "" };
}
const nominalForm = computed(() => {
  const f = formBiaya.value;
  if (!f) return 0;
  if (f.qty !== "" && f.hargaSatuan !== "") return (Number(f.qty) || 0) * (Number(f.hargaSatuan) || 0);
  return Number(f.nominal) || 0;
});
async function simpanBiaya() {
  const f = formBiaya.value;
  if (!f.uraian.trim()) return toast("Uraian wajib diisi");
  if (!(nominalForm.value > 0)) return toast("Isi nominal, atau Qty x Harga Satuan");
  try {
    const body = { ...f };
    if (f.qty !== "" && f.hargaSatuan !== "") delete body.nominal;
    detail.value = f.id ? await api.put(`/proyek/${detail.value.id}/biaya/${f.id}`, body) : await api.post(`/proyek/${detail.value.id}/biaya`, body);
    formBiaya.value = null;
    toast("Tersimpan");
  } catch (e) {
    toast(e.message || "Gagal menyimpan");
  }
}
async function hapusBiaya(b) {
  if (!confirm(`Hapus "${b.uraian}"?`)) return;
  try {
    detail.value = await api.delete(`/proyek/${detail.value.id}/biaya/${b.id}`);
    toast("Dihapus");
  } catch (e) {
    toast(e.message || "Gagal menghapus");
  }
}

// ---------- Tautkan invoice ----------
const pilihInvoice = ref(null); // daftar invoice yang belum ditautkan
async function bukaTautkan() {
  try {
    pilihInvoice.value = await api.get(`/proyek/invoice-tersedia?divisi=${encodeURIComponent(detail.value.divisi)}`);
  } catch (e) {
    toast(e.message || "Gagal memuat invoice");
  }
}
async function tautkan(inv) {
  try {
    detail.value = await api.post(`/proyek/${detail.value.id}/invoices`, { invoiceId: inv.id });
    pilihInvoice.value = pilihInvoice.value.filter((i) => i.id !== inv.id);
    toast(`Invoice ${inv.no} ditautkan`);
  } catch (e) {
    toast(e.message || "Gagal menautkan invoice");
  }
}
async function lepas(inv) {
  if (!confirm(`Lepas invoice ${inv.no} dari proyek ini? (Invoice tidak dihapus)`)) return;
  try {
    detail.value = await api.delete(`/proyek/${detail.value.id}/invoices/${inv.id}`);
  } catch (e) {
    toast(e.message || "Gagal melepas invoice");
  }
}

const statusCls = (s) => ({ LUNAS: "badge b-lunas", SEBAGIAN: "badge b-sebagian", BELUM: "badge b-belum" }[s] || "badge");

onMounted(() => {
  load();
  loadCustomers();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Proyek Kontraktor</h1>
      <div class="desc">
        Rekap per proyek: tagihan &amp; pembayaran (dari Invoice), pengeluaran/HPP, diskon, dan margin bersih. Pengeluaran otomatis masuk Laporan Divisi.
      </div>
    </div>
    <button class="btn btn-primary" @click="bukaTambah">+ Tambah Proyek</button>
  </div>

  <div class="content">
    <div class="px-kpis">
      <div class="px-kpi" style="--c: #2459a6">
        <div class="px-lbl">Total Tagihan</div>
        <div class="px-val">{{ rupiah(total.tagihan) }}</div>
      </div>
      <div class="px-kpi" style="--c: #c47b12">
        <div class="px-lbl">Belum Dibayar</div>
        <div class="px-val">{{ rupiah(total.sisa) }}</div>
      </div>
      <div class="px-kpi" style="--c: #159447">
        <div class="px-lbl">Total Margin Bersih</div>
        <div class="px-val">{{ rupiah(total.margin) }}</div>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🏗️</div>
      <div>Belum ada proyek. Tambah proyek, lalu tautkan invoice-nya dan catat pengeluarannya.</div>
      <button class="btn btn-primary" style="margin-top: 14px" @click="bukaTambah">+ Tambah Proyek</button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Proyek <span class="tag">{{ tampil.length }}</span>
      </div>
      <div style="margin-bottom: 10px">
        <input v-model="cari" placeholder="Cari proyek / customer / lokasi…" style="max-width: 320px" />
      </div>
      <div style="overflow-x: auto">
        <table>
          <thead>
            <tr>
              <th>Proyek</th>
              <th class="num">Tagihan</th>
              <th class="num">Dibayar</th>
              <th class="num">Sisa Tagihan</th>
              <th class="num">Pengeluaran</th>
              <th class="num">Margin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in tampil" :key="p.id" class="clickable-row" @click="bukaDetail(p)">
              <td>
                <b>{{ p.nama }}</b>
                <div class="px-sub">{{ p.namaCustomer || "-" }}<template v-if="p.lokasi"> • {{ p.lokasi }}</template></div>
              </td>
              <td class="num mono">{{ rupiah(p.ringkasan.tagihan) }}</td>
              <td class="num mono">{{ rupiah(p.ringkasan.dibayar) }}</td>
              <td class="num mono" :style="{ color: p.ringkasan.sisaTagihan > 0 ? '#c47b12' : '' }">{{ rupiah(p.ringkasan.sisaTagihan) }}</td>
              <td class="num mono">{{ rupiah(p.ringkasan.hppBersih + p.ringkasan.diskon) }}</td>
              <td class="num mono">
                <b :style="{ color: p.ringkasan.margin >= 0 ? '#159447' : '#c0392b' }">{{ rupiah(p.ringkasan.margin) }}</b>
                <div class="px-sub">{{ p.ringkasan.persenMargin.toFixed(1) }}%</div>
              </td>
              <td style="text-align: right"><button class="btn btn-sm btn-primary">Rincian</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ===== RINCIAN PROYEK ===== -->
  <div v-if="detail" class="modal-bg" @click.self="tutupDetail">
    <div class="modal" style="max-width: 920px">
      <button class="modal-close" @click="tutupDetail">×</button>
      <h2>{{ detail.nama }}</h2>
      <div class="msub">
        {{ detail.namaCustomer || "Tanpa customer" }}<template v-if="detail.lokasi"> • {{ detail.lokasi }}</template> • Divisi {{ detail.divisi }}
      </div>
      <div v-if="detail.catatan" class="px-note">{{ detail.catatan }}</div>

      <!-- Ringkasan margin -->
      <div class="px-ringkas">
        <div class="px-r-row"><span>Total tagihan ({{ detail.invoices.length }} invoice)</span><b class="mono">{{ rupiah(detail.ringkasan.tagihan) }}</b></div>
        <div class="px-r-row"><span>Pengeluaran / HPP</span><span class="mono">− {{ rupiah(detail.ringkasan.hpp) }}</span></div>
        <div v-if="detail.ringkasan.potongan" class="px-r-row"><span>Pengurang HPP</span><span class="mono">+ {{ rupiah(detail.ringkasan.potongan) }}</span></div>
        <div class="px-r-row px-r-sub"><span>Selisih (margin kotor)</span><b class="mono">{{ rupiah(detail.ringkasan.marginKotor) }}</b></div>
        <div v-if="detail.ringkasan.diskon" class="px-r-row"><span>Diskon</span><span class="mono">− {{ rupiah(detail.ringkasan.diskon) }}</span></div>
        <div class="px-r-row px-r-total">
          <span>Margin bersih ({{ detail.ringkasan.persenMargin.toFixed(1) }}%)</span>
          <b class="mono" :style="{ color: detail.ringkasan.margin >= 0 ? '#159447' : '#c0392b' }">{{ rupiah(detail.ringkasan.margin) }}</b>
        </div>
      </div>

      <!-- Tagihan -->
      <div class="section-title" style="margin-top: 18px">
        Tagihan &amp; Pembayaran
        <button class="btn btn-sm btn-ghost" style="margin-left: auto" @click="bukaTautkan">+ Tautkan Invoice</button>
      </div>
      <div v-if="!detail.invoices.length" class="px-sub" style="padding: 8px 0">
        Belum ada invoice. Buat invoice di menu Invoice (divisi {{ detail.divisi }}), lalu tautkan di sini.
      </div>
      <div v-else style="overflow-x: auto">
        <table>
          <thead>
            <tr><th>No. Invoice</th><th>Tanggal</th><th>Status</th><th class="num">Tagihan</th><th class="num">Dibayar</th><th class="num">Sisa</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="i in detail.invoices" :key="i.id">
              <td class="mono"><router-link :to="`/invoices/${i.id}`" @click="detail = null">{{ i.no }}</router-link></td>
              <td>{{ fmtTgl(i.tanggal) }}</td>
              <td><span :class="statusCls(i.status)">{{ i.status }}</span></td>
              <td class="num mono">{{ rupiah(i.total) }}</td>
              <td class="num mono">{{ rupiah(i.dibayar) }}</td>
              <td class="num mono">{{ rupiah(i.sisa) }}</td>
              <td style="text-align: right"><button class="btn btn-sm btn-ghost" @click="lepas(i)">Lepas</button></td>
            </tr>
            <tr class="px-total-row">
              <td colspan="3"><b>Total</b></td>
              <td class="num mono"><b>{{ rupiah(detail.ringkasan.tagihan) }}</b></td>
              <td class="num mono"><b>{{ rupiah(detail.ringkasan.dibayar) }}</b></td>
              <td class="num mono"><b>{{ rupiah(detail.ringkasan.sisaTagihan) }}</b></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="semuaPembayaran.length" class="px-bayar">
        <div class="px-sub" style="margin-bottom: 4px">Riwayat pembayaran</div>
        <div v-for="x in semuaPembayaran" :key="x.id" class="px-bayar-row">
          <span>{{ fmtTgl(x.tanggal) }}<template v-if="x.metode"> • {{ x.metode }}</template></span>
          <span class="px-sub">{{ x.invoiceNo }}</span>
          <span class="mono">{{ rupiah(x.nominal) }}</span>
        </div>
      </div>

      <!-- Pengeluaran -->
      <div class="section-title" style="margin-top: 18px">
        Pengeluaran Proyek
        <span style="margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap">
          <button class="btn btn-sm btn-ghost" @click="bukaBiaya(null, 'HPP')">+ Pengeluaran</button>
          <button class="btn btn-sm btn-ghost" @click="bukaBiaya(null, 'POTONGAN_HPP')">+ Pengurang</button>
          <button class="btn btn-sm btn-ghost" @click="bukaBiaya(null, 'DISKON')">+ Diskon</button>
        </span>
      </div>
      <div v-if="!detail.biaya.length" class="px-sub" style="padding: 8px 0">Belum ada pengeluaran tercatat.</div>
      <template v-for="g in biayaPerJenis" :key="g.v">
        <div class="px-grup">{{ g.label }}</div>
        <div style="overflow-x: auto">
          <table>
            <thead>
              <tr><th>Uraian</th><th class="num">Qty</th><th class="num">Harga Satuan</th><th class="num">Nominal</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="b in g.rows" :key="b.id">
                <td>
                  {{ b.uraian }}
                  <div v-if="b.catatan" class="px-sub">{{ b.catatan }}</div>
                </td>
                <td class="num">{{ b.qty != null ? angka(b.qty) + (b.satuan ? " " + b.satuan : "") : "" }}</td>
                <td class="num mono">{{ b.hargaSatuan != null ? rupiah(b.hargaSatuan) : "" }}</td>
                <td class="num mono">{{ rupiah(b.nominal) }}</td>
                <td style="text-align: right; white-space: nowrap">
                  <button class="btn btn-sm btn-ghost" @click="bukaBiaya(b)">Edit</button>
                  <button class="btn btn-sm btn-ghost" @click="hapusBiaya(b)">Hapus</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div class="px-sub" style="margin-top: 8px">
        Pengeluaran di sini otomatis tampil di Laporan Divisi {{ detail.divisi }} &gt; Pengeluaran (kategori "{{ detail.nama }}").
      </div>

      <div style="display: flex; gap: 8px; justify-content: space-between; margin-top: 18px">
        <button class="btn btn-danger btn-sm" @click="hapusProyek">Hapus Proyek</button>
        <button class="btn btn-ghost" @click="bukaEditProyek">Edit Data Proyek</button>
      </div>
    </div>
  </div>

  <!-- ===== FORM PROYEK ===== -->
  <div v-if="formProyek" class="modal-bg" style="z-index: 120" @click.self="formProyek = null">
    <div class="modal" style="max-width: 520px">
      <button class="modal-close" @click="formProyek = null">×</button>
      <h2>{{ formProyek.id ? "Edit Proyek" : "Tambah Proyek" }}</h2>
      <div class="field">
        <label>Nama Proyek</label>
        <input v-model="formProyek.nama" placeholder="Contoh: Pulau Tidung" />
      </div>
      <div class="row">
        <div class="field">
          <label>Customer (dari menu Customer)</label>
          <select v-model="formProyek.customerId">
            <option value="">— belum ada / ketik manual —</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.nama }}</option>
          </select>
        </div>
        <div v-if="!formProyek.customerId" class="field">
          <label>Nama Pemesan (manual)</label>
          <input v-model="formProyek.namaCustomer" placeholder="Bp. Michael" />
        </div>
      </div>
      <div class="field">
        <label>Lokasi</label>
        <input v-model="formProyek.lokasi" />
      </div>
      <div class="field">
        <label>Catatan</label>
        <input v-model="formProyek.catatan" />
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px">
        <button class="btn btn-ghost" @click="formProyek = null">Batal</button>
        <button class="btn btn-primary" @click="simpanProyek">Simpan</button>
      </div>
    </div>
  </div>

  <!-- ===== FORM BIAYA ===== -->
  <div v-if="formBiaya" class="modal-bg" style="z-index: 120" @click.self="formBiaya = null">
    <div class="modal" style="max-width: 560px">
      <button class="modal-close" @click="formBiaya = null">×</button>
      <h2>{{ formBiaya.id ? "Edit" : "Tambah" }} {{ jenisLabel(formBiaya.jenis) }}</h2>
      <div class="row">
        <div class="field">
          <label>Jenis</label>
          <select v-model="formBiaya.jenis">
            <option v-for="j in JENIS" :key="j.v" :value="j.v">{{ j.label }}</option>
          </select>
        </div>
        <div class="field">
          <label>Tanggal</label>
          <input type="date" v-model="formBiaya.tanggal" />
        </div>
      </div>
      <div class="field">
        <label>Uraian</label>
        <input v-model="formBiaya.uraian" placeholder="Contoh: Semen 400 sak" />
      </div>
      <div class="row">
        <div class="field"><label>Qty (opsional)</label><input type="number" step="any" v-model="formBiaya.qty" /></div>
        <div class="field"><label>Satuan</label><input v-model="formBiaya.satuan" placeholder="sak / m3 / rit" /></div>
        <div class="field"><label>Harga Satuan</label><input type="number" step="any" v-model="formBiaya.hargaSatuan" /></div>
      </div>
      <div class="field">
        <label>Nominal (kalau tanpa Qty × Harga)</label>
        <input type="number" step="any" v-model="formBiaya.nominal" :disabled="formBiaya.qty !== '' && formBiaya.hargaSatuan !== ''" />
      </div>
      <div class="field">
        <label>Catatan</label>
        <input v-model="formBiaya.catatan" />
      </div>
      <div class="px-r-row px-r-total" style="margin-top: 4px"><span>Nominal</span><b class="mono">{{ rupiah(nominalForm) }}</b></div>
      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px">
        <button class="btn btn-ghost" @click="formBiaya = null">Batal</button>
        <button class="btn btn-primary" @click="simpanBiaya">Simpan</button>
      </div>
    </div>
  </div>

  <!-- ===== PILIH INVOICE ===== -->
  <div v-if="pilihInvoice" class="modal-bg" style="z-index: 120" @click.self="pilihInvoice = null">
    <div class="modal" style="max-width: 640px">
      <button class="modal-close" @click="pilihInvoice = null">×</button>
      <h2>Tautkan Invoice</h2>
      <div class="msub">Invoice divisi {{ detail?.divisi }} yang belum masuk proyek mana pun</div>
      <div v-if="!pilihInvoice.length" class="px-sub" style="padding: 12px 0">Tidak ada invoice yang tersedia.</div>
      <table v-else>
        <thead><tr><th>No. Invoice</th><th>Tanggal</th><th>Customer</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>
          <tr v-for="i in pilihInvoice" :key="i.id">
            <td class="mono">{{ i.no }}</td>
            <td>{{ fmtTgl(i.tanggal) }}</td>
            <td>{{ i.customer }}</td>
            <td class="num mono">{{ rupiah(i.total) }}</td>
            <td style="text-align: right"><button class="btn btn-sm btn-primary" @click="tautkan(i)">Tautkan</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.px-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 16px; }
.px-kpi { background: #fff; border: 1px solid #e3e8ef; border-left: 4px solid var(--c); border-radius: 10px; padding: 12px 14px; }
.px-lbl { font-size: 12px; color: #6b7686; }
.px-val { font-size: 20px; font-weight: 700; margin-top: 2px; }
.px-sub { font-size: 12px; color: #7a8597; }
.px-note { background: #f6f8fb; border-radius: 8px; padding: 8px 10px; font-size: 13px; margin-bottom: 10px; }
.px-ringkas { background: #f6f8fb; border-radius: 10px; padding: 12px 14px; margin-top: 8px; }
.px-r-row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 14px; }
.px-r-sub { border-top: 1px dashed #c9d1dd; margin-top: 4px; padding-top: 8px; }
.px-r-total { border-top: 2px solid #1e2a3b; margin-top: 6px; padding-top: 8px; font-size: 16px; }
.px-total-row td { background: #f6f8fb; }
.px-grup { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #55607a; margin: 12px 0 4px; }
.px-bayar { margin-top: 10px; background: #fafbfd; border: 1px solid #e3e8ef; border-radius: 8px; padding: 8px 12px; }
.px-bayar-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; font-size: 13px; padding: 2px 0; }
</style>
