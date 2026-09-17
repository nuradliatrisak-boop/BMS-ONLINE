<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { parseDivisiExcel } from "../utils/excelImport.js";
import { exportAlatBeratExcel } from "../utils/excelExport.js";
import { exportAlatBeratPdf } from "../utils/pdfExport.js";

const BULAN_NAMA = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const bulan = ref(new Date().toISOString().slice(0, 7));
const rekap = ref(null); // hasil /divisi-tx/alat-berat/rekap/:bulan
const txAll = ref([]); // transaksi divisi "Alat Berat" bulan ini
const loading = ref(true);

const bulanLabel = computed(() => {
  if (!bulan.value) return "-";
  const [y, m] = bulan.value.split("-");
  return `${BULAN_NAMA[Number(m) - 1]} ${y}`;
});

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

async function load() {
  loading.value = true;
  try {
    const [rekapData, tx] = await Promise.all([
      api.get(`/divisi-tx/alat-berat/rekap/${bulan.value}`),
      api.get(`/divisi-tx?bulan=${bulan.value}`),
    ]);
    rekap.value = rekapData;
    txAll.value = tx.filter((t) => t.divisi === "Alat Berat");
  } catch (e) {
    toast(e.message || "Gagal memuat data alat berat");
  } finally {
    loading.value = false;
  }
}

function txFor(nama) {
  return txAll.value
    .filter((t) => t.kategori === nama && (t.kelompok === "pendapatan" || t.kelompok === "operasional"))
    .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
}

// --- Detail per unit ---
const showDetail = ref(false);
const detailUnit = ref(null); // { nama, pendapatan, pengeluaran, hasilBersih, rincian }

function openDetail(u) {
  detailUnit.value = u;
  showDetail.value = true;
}
function closeDetail() {
  showDetail.value = false;
  detailUnit.value = null;
}

// --- Tambah unit baru (kategori baru yang belum ada di daftar) ---
const showTambahUnit = ref(false);
const namaUnitBaru = ref("");
function tambahUnitBaru() {
  const nama = namaUnitBaru.value.trim();
  if (!nama) return toast("Nama unit wajib diisi");
  if (rekap.value.unit.some((u) => u.nama.toLowerCase() === nama.toLowerCase())) {
    toast("Unit dengan nama itu sudah ada");
  } else {
    rekap.value.unit.push({ nama, pendapatan: 0, pengeluaran: 0, hasilBersih: 0, rincian: [] });
  }
  namaUnitBaru.value = "";
  showTambahUnit.value = false;
}

// --- Form catat transaksi cepat ---
const showTxModal = ref(false);
const editingTxId = ref(null);
const txForm = ref({
  jenisTx: "pendapatan",
  subKategori: "Sparepart",
  nominal: "",
  tanggal: new Date().toISOString().slice(0, 10),
  keterangan: "",
});

function openTambahTx(jenisTx) {
  editingTxId.value = null;
  txForm.value = {
    jenisTx,
    subKategori: "Sparepart",
    nominal: "",
    tanggal: new Date().toISOString().slice(0, 10),
    keterangan: "",
  };
  showTxModal.value = true;
}

function openEditTx(t) {
  editingTxId.value = t.id;
  txForm.value = {
    jenisTx: t.kelompok === "pendapatan" ? "pendapatan" : "operasional",
    subKategori: t.subKategori || "Sparepart",
    nominal: t.nominal,
    tanggal: new Date(t.tanggal).toISOString().slice(0, 10),
    keterangan: t.keterangan || "",
  };
  showTxModal.value = true;
}

function isAutoMirror(t) {
  return !!t.sumber && t.sumber.startsWith("AUTO_MIRROR_OF:");
}

async function submitTx() {
  if (!detailUnit.value) return;
  if (!txForm.value.nominal || Number(txForm.value.nominal) <= 0) {
    return toast("Nominal wajib diisi dan lebih dari 0");
  }
  const kelompok = txForm.value.jenisTx === "pendapatan" ? "pendapatan" : "operasional";
  const payload = {
    divisi: "Alat Berat",
    tipe: kelompok === "pendapatan" ? "penjualan" : "pengeluaran",
    kelompok,
    kategori: detailUnit.value.nama,
    subKategori: kelompok === "operasional" ? txForm.value.subKategori : undefined,
    nominal: Number(txForm.value.nominal),
    tanggal: txForm.value.tanggal,
    keterangan: txForm.value.keterangan || undefined,
  };

  try {
    if (editingTxId.value) {
      await api.put(`/divisi-tx/${editingTxId.value}`, payload);
      toast("Transaksi berhasil diubah");
    } else {
      await api.post("/divisi-tx", payload);
      toast("Transaksi dicatat");
    }
    showTxModal.value = false;
    await load();
    // Segarkan referensi unit yang lagi dibuka
    detailUnit.value = rekap.value.unit.find((u) => u.nama === detailUnit.value?.nama) || detailUnit.value;
  } catch (e) {
    toast(e.message || "Gagal menyimpan transaksi");
  }
}

async function removeTx(t) {
  if (!confirm(`Hapus transaksi "${t.kategori}" (${rupiah(t.nominal)})?`)) return;
  try {
    await api.delete(`/divisi-tx/${t.id}`);
    toast("Transaksi dihapus");
    await load();
    detailUnit.value = rekap.value.unit.find((u) => u.nama === detailUnit.value?.nama) || detailUnit.value;
  } catch (e) {
    toast(e.message || "Gagal menghapus transaksi");
  }
}

// --- Export Excel / PDF ---
const pdfOrientation = ref("portrait"); // "portrait" | "landscape"
function exportExcel() {
  if (!rekap.value) return;
  exportAlatBeratExcel({ bulanLabel: bulanLabel.value, unit: rekap.value.unit, total: rekap.value.total });
}
const exportingPdf = ref(false);
async function exportPdf() {
  if (!rekap.value) return;
  exportingPdf.value = true;
  try {
    await exportAlatBeratPdf({
      bulanLabel: bulanLabel.value,
      unit: rekap.value.unit,
      total: rekap.value.total,
      orientation: pdfOrientation.value,
    });
  } catch (e) {
    toast("Gagal membuat PDF: " + (e?.message || String(e)));
  } finally {
    exportingPdf.value = false;
  }
}

// --- Import dari Excel (pakai file "Pengeluaran <Bulan> <Tahun>.xlsx" yang
// sama dengan importer di Laporan Divisi, tapi di sini cuma sheet "ALAT
// BERAT" yang dipakai/diimport -- sheet lain di file itu diabaikan). ---
const showImportModal = ref(false);
const importBulan = ref(new Date().toISOString().slice(0, 7));
const importFile = ref(null);
const importResult = ref(null); // { penjualan, pengeluaran, items }
const importParsing = ref(false);
const importSaving = ref(false);
const importError = ref("");

function onImportFileChange(e) {
  importFile.value = e.target.files?.[0] || null;
  importResult.value = null;
  importError.value = "";
}

async function previewImport() {
  if (!importFile.value) return toast("Pilih file Excel dulu");
  importParsing.value = true;
  importError.value = "";
  importResult.value = null;
  try {
    const parsed = await parseDivisiExcel(importFile.value, importBulan.value);
    const items = parsed.items.filter((it) => it.divisi === "Alat Berat");
    if (!parsed.sheetsFound.includes("ALAT BERAT")) {
      importError.value = 'Sheet "ALAT BERAT" tidak ditemukan di file ini.';
      return;
    }
    const penjualan = items.filter((it) => it.tipe === "PENJUALAN").reduce((s, it) => s + it.nominal, 0);
    const pengeluaran = items.filter((it) => it.tipe === "PENGELUARAN").reduce((s, it) => s + it.nominal, 0);
    importResult.value = { items, penjualan, pengeluaran };
  } catch (e) {
    importError.value = e?.message || "Gagal membaca file Excel";
  } finally {
    importParsing.value = false;
  }
}

async function confirmImport() {
  if (!importResult.value?.items?.length) return;
  importSaving.value = true;
  try {
    const res = await api.post("/divisi-tx/import", { items: importResult.value.items });
    toast(`${res.dibuat} transaksi diimport${res.dilewati ? `, ${res.dilewati} dilewati (duplikat)` : ""}`);
    showImportModal.value = false;
    importFile.value = null;
    importResult.value = null;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal mengimport data");
  } finally {
    importSaving.value = false;
  }
}

watch(bulan, load);
onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Alat Berat</h1>
      <div class="desc">Excavator &amp; alat berat, per unit</div>
    </div>
    <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
      <div class="field" style="margin:0;">
        <label>Bulan</label>
        <input v-model="bulan" type="month" />
      </div>
      <div class="field" style="margin:0; min-width:150px;">
        <label>Orientasi PDF</label>
        <select v-model="pdfOrientation">
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </div>
      <button class="btn btn-ghost" @click="showImportModal = true">⬆ Import Excel</button>
      <button class="btn btn-ghost" @click="exportExcel">⬇ Export Excel</button>
      <button class="btn btn-ghost" :disabled="exportingPdf" @click="exportPdf">
        {{ exportingPdf ? "Membuat PDF..." : "⬇ Export PDF" }}
      </button>
      <button class="btn btn-primary" @click="showTambahUnit = true">+ Tambah Unit</button>
    </div>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!rekap?.unit?.length" class="empty">
      <div class="big">🏗️</div>
      <div>Belum ada unit alat berat.</div>
      <button class="btn btn-primary" style="margin-top:14px;" @click="showTambahUnit = true">+ Tambah Unit</button>
    </div>

    <div v-else class="armada-grid">
      <div v-for="u in rekap.unit" :key="u.nama" class="card armada-card" @click="openDetail(u)">
        <div class="armada-card-top">
          <div class="armada-nopol">{{ u.nama }}</div>
        </div>
        <div class="armada-summary">
          <div><span>Pendapatan</span><b>{{ rupiah(u.pendapatan) }}</b></div>
          <div><span>Pengeluaran</span><b>{{ rupiah(u.pengeluaran) }}</b></div>
          <div>
            <span>Hasil Bersih</span>
            <b :style="{ color: u.hasilBersih >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)' }">
              {{ rupiah(u.hasilBersih) }}
            </b>
          </div>
        </div>
        <div class="armada-hint">Klik untuk lihat rincian &amp; catat transaksi →</div>
      </div>
    </div>
  </div>

  <!-- Modal tambah unit baru -->
  <div v-if="showTambahUnit" class="modal-bg" @click.self="showTambahUnit = false">
    <div class="modal">
      <button class="modal-close" @click="showTambahUnit = false">×</button>
      <h2>Tambah Unit Alat Berat</h2>
      <div class="field">
        <label>Nama Unit</label>
        <input v-model="namaUnitBaru" placeholder="Mis. Komatsu 07" />
      </div>
      <button class="btn btn-primary" @click="tambahUnitBaru">Tambah</button>
    </div>
  </div>

  <!-- Modal import Excel -->
  <div v-if="showImportModal" class="modal-bg" @click.self="showImportModal = false">
    <div class="modal" style="max-width: 640px; width: 92%">
      <button class="modal-close" @click="showImportModal = false">×</button>
      <h2>Import Alat Berat dari Excel</h2>
      <div class="desc" style="margin-bottom: 14px">
        Untuk file "Pengeluaran &lt;Bulan&gt; &lt;Tahun&gt;.xlsx" yang sama dengan yang dipakai di
        Laporan Divisi &mdash; di sini cuma sheet <b>ALAT BERAT</b>-nya saja yang dibaca &amp; diimport.
      </div>

      <div class="row" style="margin-bottom: 12px">
        <div class="field">
          <label>Bulan data ini</label>
          <input v-model="importBulan" type="month" />
        </div>
        <div class="field">
          <label>File Excel</label>
          <input type="file" accept=".xlsx,.xls" @change="onImportFileChange" />
        </div>
      </div>

      <button class="btn btn-primary" :disabled="importParsing" @click="previewImport">
        {{ importParsing ? "Membaca file..." : "Baca & Preview" }}
      </button>

      <div v-if="importError" class="empty" style="color: #b91c1c; margin-top: 12px">{{ importError }}</div>

      <div v-if="importResult?.items?.length" style="margin-top: 16px">
        <div class="card" style="padding: 10px 14px">
          <b>Alat Berat</b> &mdash; {{ importResult.items.length }} baris data
          <div class="desc">
            Pendapatan {{ rupiah(importResult.penjualan) }} &middot; Pengeluaran {{ rupiah(importResult.pengeluaran) }} &middot;
            Hasil Bersih {{ rupiah(importResult.penjualan - importResult.pengeluaran) }}
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top: 10px" :disabled="importSaving" @click="confirmImport">
          {{ importSaving ? "Menyimpan..." : `Simpan ${importResult.items.length} Transaksi` }}
        </button>
        <div class="desc" style="margin-top: 8px">
          Baris yang datanya persis sama dengan transaksi yang sudah ada otomatis dilewati, jadi aman
          diimport ulang.
        </div>
      </div>
    </div>
  </div>

  <!-- Modal Detail per unit -->
  <div v-if="showDetail && detailUnit" class="modal-bg" @click.self="closeDetail">
    <div class="modal" style="max-width:640px; width:94%;">
      <button class="modal-close" @click="closeDetail">×</button>
      <h2>{{ detailUnit.nama }}</h2>

      <div class="armada-summary armada-summary-detail">
        <div><span>Pendapatan</span><b>{{ rupiah(detailUnit.pendapatan) }}</b></div>
        <div><span>Pengeluaran (Uang Makan/Sparepart/Solar)</span><b>{{ rupiah(detailUnit.pengeluaran) }}</b></div>
        <div>
          <span>Hasil Bersih</span>
          <b :style="{ color: detailUnit.hasilBersih >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)' }">
            {{ rupiah(detailUnit.hasilBersih) }}
          </b>
        </div>
      </div>

      <div class="msub" style="margin-top:10px;" v-if="detailUnit.rincian?.length">
        Rincian pengeluaran:
        <span v-for="r in detailUnit.rincian" :key="r.subKategori" style="margin-right:12px;">
          {{ r.subKategori }}: <b>{{ rupiah(r.nominal) }}</b>
        </span>
      </div>

      <div style="display:flex; gap:8px; margin:14px 0;">
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('pendapatan')">+ Pendapatan</button>
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('operasional')">+ Pengeluaran</button>
      </div>

      <div class="section-title">
        Transaksi Bulan Ini
        <span class="tag">{{ txFor(detailUnit.nama).length }}</span>
      </div>

      <div v-if="!txFor(detailUnit.nama).length" class="empty" style="padding:16px;">
        Belum ada transaksi untuk unit ini bulan ini.
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Tipe</th>
            <th>Rincian</th>
            <th class="num">Nominal</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in txFor(detailUnit.nama)" :key="t.id">
            <td>{{ new Date(t.tanggal).toLocaleDateString("id-ID") }}</td>
            <td>{{ t.kelompok === "pendapatan" ? "Pendapatan" : "Pengeluaran" }}</td>
            <td>{{ t.subKategori || "-" }}</td>
            <td class="num mono">{{ rupiah(t.nominal) }}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" @click="openEditTx(t)">Edit</button>
              <button class="btn btn-ghost btn-sm" @click="removeTx(t)">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="msub" style="margin-top:12px;">
        Pendapatan unit ini otomatis tercatat juga sebagai pengeluaran "Sewa Armada &amp; Excavator" di
        Laporan Divisi Supplier (baris "Excavator").
      </div>
    </div>
  </div>

  <!-- Modal catat/edit transaksi -->
  <div v-if="showTxModal" class="modal-bg" @click.self="showTxModal = false">
    <div class="modal">
      <button class="modal-close" @click="showTxModal = false">×</button>
      <h2>{{ editingTxId ? "Edit" : "Catat" }} Transaksi &mdash; {{ detailUnit?.nama }}</h2>

      <div class="field">
        <label>Jenis</label>
        <select v-model="txForm.jenisTx">
          <option value="pendapatan">Pendapatan (Sewa/Rental)</option>
          <option value="operasional">Pengeluaran Operasional</option>
        </select>
      </div>

      <div class="field" v-if="txForm.jenisTx === 'operasional'">
        <label>Rincian</label>
        <select v-model="txForm.subKategori">
          <option value="Uang Makan">Uang Makan</option>
          <option value="Sparepart">Sparepart</option>
          <option value="Solar">Solar</option>
        </select>
      </div>

      <div class="row">
        <div class="field"><label>Nominal</label><input v-model.number="txForm.nominal" type="number" /></div>
        <div class="field"><label>Tanggal</label><input v-model="txForm.tanggal" type="date" /></div>
      </div>

      <div class="field"><label>Catatan (opsional)</label><input v-model="txForm.keterangan" /></div>

      <button class="btn btn-primary" @click="submitTx">{{ editingTxId ? "Simpan Perubahan" : "Simpan" }}</button>
    </div>
  </div>
</template>

<style scoped>
.armada-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.armada-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: box-shadow 0.15s, transform 0.15s;
}
.armada-card:hover {
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.armada-card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.armada-nopol {
  font-weight: 700;
  font-size: 16px;
}
.armada-summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
  margin-top: 4px;
}
.armada-summary div {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.armada-summary-detail {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
}
.armada-hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 8px;
}
</style>