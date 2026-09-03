<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { parseDivisiExcel } from "../utils/excelImport.js";
import { exportLaporanDivisiExcel, exportSolarStokExcel } from "../utils/excelExport.js";
import { exportLaporanDivisiPdf, exportSolarStokPdf } from "../utils/pdfExport.js";
import { exportSolarStokWord } from "../utils/wordExport.js";

const tab = ref("laba-rugi"); // "laba-rugi" | "solar"

const BULAN_NAMA = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const divisiList = ref([]);
const config = ref({}); // { [divisi]: { kelompok: [...] } }
const divisi = ref("");
const bulan = ref(new Date().toISOString().slice(0, 7));
const laporan = ref(null);
const txList = ref([]);
const loading = ref(false);
const showModal = ref(false);
const editingId = ref(null);
const TX_PAGE_SIZE = 15;
const txVisibleCount = ref(TX_PAGE_SIZE);
const populatingForm = ref(false);
const armadaMaster = ref([]); // data master kendaraan (menu "Armada"), untuk dropdown nopol

const CUSTOM_OPT = "__custom__";
const kategoriCustom = ref(false);
const nopolCustom = ref(false);

const emptyForm = () => ({
  kelompok: "",
  kategori: "",
  subKategori: "",
  qty: "",
  hargaSatuan: "",
  nominal: "",
  keterangan: "",
  tanggal: new Date().toISOString().slice(0, 10),
});
const form = ref(emptyForm());

// --- Import dari Excel ---
const showImportModal = ref(false);
const importBulan = ref(new Date().toISOString().slice(0, 7));
const importFile = ref(null);
const importResult = ref(null); // hasil parseDivisiExcel
const importParsing = ref(false);
const importSaving = ref(false);
const importError = ref("");

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

const bulanLabel = computed(() => {
  if (!bulan.value) return "-";
  const [y, m] = bulan.value.split("-");
  return `${BULAN_NAMA[Number(m) - 1]} ${y}`;
});

const kelompokOptions = computed(() => config.value[divisi.value]?.kelompok || []);

const selectedKelompok = computed(
  () => kelompokOptions.value.find((k) => k.key === form.value.kelompok) || null
);

// Untuk kelompok yang rinciannya per-kendaraan (Armada: Pendapatan &
// Sparepart), dropdown nopol difilter sesuai kategori yang dipilih
// ("...Tronton" -> kendaraan jenis Tronton, "...Cold Diesel" -> jenis
// Cold Diesel/Colt Diesel), diambil dari data master menu "Armada".
const kendaraanOptions = computed(() => {
  if (!selectedKelompok.value?.subKategoriKendaraan) return [];
  const kat = (form.value.kategori || "").toLowerCase();
  let keyword = null;
  if (kat.includes("tronton")) keyword = "tronton";
  else if (kat.includes("diesel")) keyword = "diesel";
  return armadaMaster.value.filter((a) => {
    if (a.divisi !== "Armada") return false;
    if (!keyword) return true;
    return (a.jenis || "").toLowerCase().includes(keyword);
  });
});

const nominalOtomatis = computed(() => {
  const q = Number(form.value.qty);
  const h = Number(form.value.hargaSatuan);
  if (form.value.qty !== "" && form.value.hargaSatuan !== "" && q > 0 && h >= 0) {
    return q * h;
  }
  return null;
});

async function loadConfig() {
  const c = await api.get("/divisi-tx/config");
  divisiList.value = c.divisiList;
  config.value = c.config;
  if (!divisi.value) divisi.value = divisiList.value[0];
  try {
    armadaMaster.value = await api.get("/armada");
  } catch (e) {
    armadaMaster.value = [];
  }
}

async function load() {
  if (!divisi.value || !bulan.value) return;
  loading.value = true;
  try {
    laporan.value = await api.get(`/divisi-tx/laporan/${encodeURIComponent(divisi.value)}/${bulan.value}`);
    const all = await api.get(`/divisi-tx?bulan=${bulan.value}`);
    txList.value = all.filter((t) => t.divisi === divisi.value);
    txVisibleCount.value = TX_PAGE_SIZE;
  } finally {
    loading.value = false;
  }
}

// Transaksi otomatis (mengikuti input Pendapatan di Armada/Alat Berat) tidak
// boleh diedit/dihapus dari sini -- harus dari divisi asalnya.
function isAutoMirror(t) {
  return !!t.sumber && t.sumber.startsWith("AUTO_MIRROR_OF:");
}

const txListVisible = computed(() => txList.value.slice(0, txVisibleCount.value));
function tampilkanLebihBanyak() {
  txVisibleCount.value += TX_PAGE_SIZE;
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  kategoriCustom.value = false;
  if (kelompokOptions.value.length) form.value.kelompok = kelompokOptions.value[0].key;
  showModal.value = true;
}

// Kategori: dropdown dari kategoriDefault, plus opsi "+ Kategori baru
// (ketik manual)" kalau kelompoknya allowCustom -- supaya bisa pilih dari
// daftar ATAU isi manual sesuai kebutuhan.
function onKategoriSelect(val) {
  if (val === CUSTOM_OPT) {
    kategoriCustom.value = true;
    form.value.kategori = "";
  } else {
    kategoriCustom.value = false;
    form.value.kategori = val;
  }
  form.value.subKategori = "";
}

function onNopolSelect(val) {
  if (val === "__manual__") {
    nopolCustom.value = true;
    form.value.subKategori = "";
  } else {
    nopolCustom.value = false;
    form.value.subKategori = val;
  }
}

watch(() => form.value.kelompok, () => {
  if (populatingForm.value) return;
  // Kalau kelompok ini tidak punya daftar kategori bawaan (mis. "Lainnya"),
  // langsung buka mode ketik manual biar user tidak lihat dropdown kosong.
  kategoriCustom.value = !(selectedKelompok.value?.kategoriDefault || []).length && !!selectedKelompok.value?.allowCustom;
  nopolCustom.value = false;
  form.value.kategori = "";
  form.value.subKategori = "";
});
watch(() => form.value.kategori, () => {
  if (populatingForm.value) return;
  nopolCustom.value = false;
  if (selectedKelompok.value?.subKategoriKendaraan) form.value.subKategori = "";
});

async function openEditModal(t) {
  editingId.value = t.id;
  populatingForm.value = true;
  form.value = {
    kelompok: t.kelompok || "",
    kategori: t.kategori || "",
    subKategori: t.subKategori || "",
    qty: t.qty ?? "",
    hargaSatuan: t.hargaSatuan ?? "",
    nominal: t.nominal ?? "",
    keterangan: t.keterangan || "",
    tanggal: new Date(t.tanggal).toISOString().slice(0, 10),
  };
  const k = kelompokOptions.value.find((x) => x.key === form.value.kelompok);
  kategoriCustom.value = !!form.value.kategori && !(k?.kategoriDefault || []).includes(form.value.kategori);
  nopolCustom.value = !!form.value.subKategori && k?.subKategoriKendaraan && !kendaraanOptions.value.some((a) => a.nopol === form.value.subKategori);
  showModal.value = true;
  await nextTick();
  populatingForm.value = false;
}

async function submit() {
  if (!form.value.kelompok || !form.value.kategori) {
    return toast("Kelompok dan kategori wajib dipilih/diisi");
  }
  const pakaiQty = form.value.qty !== "" && form.value.hargaSatuan !== "";
  if (!pakaiQty && !form.value.nominal) {
    return toast("Isi Nominal, atau isi Qty + Harga Satuan");
  }

  const tipe = selectedKelompok.value?.tipe === "PENJUALAN" ? "penjualan" : "pengeluaran";

  const payload = {
    divisi: divisi.value,
    tipe,
    kelompok: form.value.kelompok,
    kategori: form.value.kategori,
    subKategori: form.value.subKategori || undefined,
    qty: pakaiQty ? form.value.qty : undefined,
    hargaSatuan: pakaiQty ? form.value.hargaSatuan : undefined,
    nominal: pakaiQty ? undefined : form.value.nominal,
    keterangan: form.value.keterangan || undefined,
    tanggal: form.value.tanggal,
  };
  if (editingId.value) {
    await api.put(`/divisi-tx/${editingId.value}`, payload);
    toast("Transaksi berhasil diubah");
  } else {
    await api.post("/divisi-tx", payload);
    toast("Transaksi dicatat");
  }
  showModal.value = false;
  editingId.value = null;
  await load();
}

async function removeTx(t) {
  if (!confirm(`Hapus transaksi "${t.kategori}" (${rupiah(t.nominal)})?`)) return;
  await api.delete(`/divisi-tx/${t.id}`);
  toast("Transaksi dihapus");
  await load();
}

function kelompokLabel(key) {
  return kelompokOptions.value.find((k) => k.key === key)?.label || key || "-";
}

function exportExcel() {
  if (!laporan.value) return toast("Tampilkan laporannya dulu sebelum diexport");
  exportLaporanDivisiExcel({ divisi: divisi.value, bulanLabel: bulanLabel.value, laporan: laporan.value });
}

const exportingPdf = ref(false);
async function exportPdf() {
  if (!laporan.value) return toast("Tampilkan laporannya dulu sebelum diexport");
  exportingPdf.value = true;
  try {
    await exportLaporanDivisiPdf({ divisi: divisi.value, bulanLabel: bulanLabel.value, laporan: laporan.value });
  } catch (e) {
    toast("Gagal membuat PDF: " + (e?.message || String(e)));
  } finally {
    exportingPdf.value = false;
  }
}

// --- Import dari Excel ---
function openImportModal() {
  importFile.value = null;
  importResult.value = null;
  importError.value = "";
  importBulan.value = bulan.value || new Date().toISOString().slice(0, 7);
  showImportModal.value = true;
}

function onImportFileChange(e) {
  importFile.value = e.target.files?.[0] || null;
  importResult.value = null;
  importError.value = "";
}

async function previewImport() {
  if (!importFile.value) return toast("Pilih file Excel dulu");
  if (!importBulan.value) return toast("Pilih bulan datanya dulu");
  importParsing.value = true;
  importError.value = "";
  try {
    const result = await parseDivisiExcel(importFile.value, importBulan.value);
    if (!result.items.length) {
      importError.value =
        "Tidak ada data yang berhasil dibaca. Pastikan file punya sheet SUPPLIER / ARMADA / ALAT BERAT dengan format seperti laporan bulanan biasa.";
    }
    importResult.value = result;
  } catch (err) {
    importError.value = "Gagal membaca file: " + (err?.message || String(err));
  } finally {
    importParsing.value = false;
  }
}

async function confirmImport() {
  if (!importResult.value?.items?.length) return;
  importSaving.value = true;
  try {
    const res = await api.post("/divisi-tx/import", { items: importResult.value.items });
    toast(`Import selesai: ${res.dibuat} transaksi baru dibuat, ${res.dilewati} dilewati (sudah pernah diimport).`);
    showImportModal.value = false;
    await load();
  } catch (err) {
    toast("Gagal menyimpan hasil import: " + (err?.message || String(err)));
  } finally {
    importSaving.value = false;
  }
}

watch([divisi, bulan], load);

// ------------------------------------------------------------
// Tab "Stok Solar (BBM)" -- catatan stok solar Alat Berat, terpisah dari
// data keuangan DivisiTx (lihat backend/src/routes/solarTx.js). Dipakai
// bareng "bulan" yang sama dengan tab Laba Rugi di atas.
// ------------------------------------------------------------
const solarData = ref({ items: [], totalMasuk: 0, totalKeluar: 0, saldoBulan: 0, saldoSaatIni: 0 });
const solarLoading = ref(false);
const showSolarModal = ref(false);
const editingSolarId = ref(null);
const solarFileInput = ref(null);
const solarUploading = ref(false);

const emptySolarForm = (tipe) => ({
  tipe,
  tanggal: new Date().toISOString().slice(0, 10),
  nama: "",
  liter: "",
  lokasi: "",
  keterangan: "",
});
const solarForm = ref(emptySolarForm("MASUK"));
const solarExistingBukti = ref(null); // { url, nama } kalau lagi edit & sudah ada file
const solarHapusBukti = ref(false);

const solarMasukList = computed(() => solarData.value.items.filter((t) => t.tipe === "MASUK"));
const solarKeluarList = computed(() => solarData.value.items.filter((t) => t.tipe === "KELUAR"));

// --- Rekap Solar Keluar per Wilayah/Lokasi ---
// "Lokasi" diisi bebas di form (mis. "Cimanggis 2", "Kp. Rambutan"), jadi
// daftar wilayah untuk filter & rekap diambil dari data yang sudah ada,
// bukan daftar tetap.
const solarWilayah = ref(""); // "" = semua wilayah

const solarWilayahOptions = computed(() => {
  const seen = new Set();
  for (const t of solarKeluarList.value) {
    const lok = (t.lokasi || "").trim();
    if (lok) seen.add(lok);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
});

const solarKeluarListFiltered = computed(() => {
  if (!solarWilayah.value) return solarKeluarList.value;
  return solarKeluarList.value.filter((t) => (t.lokasi || "").trim() === solarWilayah.value);
});

const totalKeluarFiltered = computed(() =>
  solarKeluarListFiltered.value.reduce((s, t) => s + t.liter, 0)
);

// Rekap per wilayah selalu dihitung dari SELURUH data bulan itu (tidak ikut
// filter di atas), supaya tetap bisa lihat perbandingan semua wilayah
// sekaligus meski sedang memfilter tabel ke satu wilayah tertentu.
const rekapPerWilayah = computed(() => {
  const map = new Map();
  for (const t of solarKeluarList.value) {
    const lok = (t.lokasi || "").trim() || "(Tanpa lokasi)";
    if (!map.has(lok)) map.set(lok, { lokasi: lok, liter: 0, jumlah: 0 });
    const row = map.get(lok);
    row.liter += t.liter;
    row.jumlah += 1;
  }
  return [...map.values()].sort((a, b) => b.liter - a.liter);
});

async function loadSolar() {
  if (!bulan.value) return;
  solarLoading.value = true;
  try {
    solarData.value = await api.get(`/solar-tx?bulan=${bulan.value}`);
  } finally {
    solarLoading.value = false;
  }
}

function openSolarModal(tipe) {
  editingSolarId.value = null;
  solarForm.value = emptySolarForm(tipe);
  solarExistingBukti.value = null;
  solarHapusBukti.value = false;
  if (solarFileInput.value) solarFileInput.value.value = "";
  showSolarModal.value = true;
}

function openSolarEditModal(t) {
  editingSolarId.value = t.id;
  solarForm.value = {
    tipe: t.tipe,
    tanggal: new Date(t.tanggal).toISOString().slice(0, 10),
    nama: t.nama,
    liter: t.liter,
    lokasi: t.lokasi || "",
    keterangan: t.keterangan || "",
  };
  solarExistingBukti.value = t.buktiUrl ? { url: api.fileUrl(t.buktiUrl), nama: t.buktiNama } : null;
  solarHapusBukti.value = false;
  if (solarFileInput.value) solarFileInput.value.value = "";
  showSolarModal.value = true;
}

function hapusBuktiExisting() {
  solarExistingBukti.value = null;
  solarHapusBukti.value = true;
}

async function submitSolar() {
  if (!solarForm.value.nama || !solarForm.value.tanggal) {
    return toast("Nama dan tanggal wajib diisi");
  }
  const literNum = Number(solarForm.value.liter);
  if (!literNum || literNum <= 0) {
    return toast("Jumlah liter wajib diisi dan lebih dari 0");
  }
  if (solarForm.value.tipe === "KELUAR" && !solarForm.value.lokasi) {
    return toast("Lokasi/unit tujuan wajib diisi untuk Solar Keluar");
  }

  const fd = new FormData();
  fd.append("tipe", solarForm.value.tipe);
  fd.append("tanggal", solarForm.value.tanggal);
  fd.append("nama", solarForm.value.nama);
  fd.append("liter", String(literNum));
  if (solarForm.value.tipe === "KELUAR") fd.append("lokasi", solarForm.value.lokasi);
  if (solarForm.value.keterangan) fd.append("keterangan", solarForm.value.keterangan);
  const file = solarFileInput.value?.files?.[0];
  if (file) fd.append("bukti", file);
  if (editingSolarId.value && solarHapusBukti.value) fd.append("hapusBukti", "true");

  solarUploading.value = true;
  try {
    if (editingSolarId.value) {
      await api.upload(`/solar-tx/${editingSolarId.value}`, fd, "PUT");
      toast("Catatan solar berhasil diubah");
    } else {
      await api.upload("/solar-tx", fd, "POST");
      toast(solarForm.value.tipe === "MASUK" ? "Solar masuk dicatat" : "Solar keluar dicatat");
    }
    showSolarModal.value = false;
    await loadSolar();
  } catch (e) {
    toast("Gagal menyimpan: " + (e?.message || String(e)));
  } finally {
    solarUploading.value = false;
  }
}

async function removeSolar(t) {
  if (!confirm(`Hapus catatan ${t.tipe === "MASUK" ? "solar masuk" : "solar keluar"} "${t.nama}" (${t.liter} liter)?`)) return;
  await api.delete(`/solar-tx/${t.id}`);
  toast("Catatan dihapus");
  await loadSolar();
}

function exportSolarExcel() {
  exportSolarStokExcel(buildSolarExportData());
}
const exportingSolarPdf = ref(false);
async function exportSolarPdf() {
  exportingSolarPdf.value = true;
  try {
    await exportSolarStokPdf(buildSolarExportData());
  } catch (e) {
    toast("Gagal membuat PDF: " + (e?.message || String(e)));
  } finally {
    exportingSolarPdf.value = false;
  }
}
function exportSolarWord() {
  exportSolarStokWord(buildSolarExportData());
}

// Kalau lagi difilter per wilayah, export (Excel/PDF/Word) ikut hanya
// menampilkan Solar Keluar wilayah itu -- Solar Masuk & saldo saat ini tetap
// apa adanya karena tidak berkaitan dengan wilayah tujuan.
function buildSolarExportData() {
  const wilayah = solarWilayah.value;
  if (!wilayah) {
    return { bulanLabel: bulanLabel.value, ...solarData.value };
  }
  const items = solarData.value.items.filter(
    (t) => t.tipe === "MASUK" || (t.lokasi || "").trim() === wilayah
  );
  return {
    bulanLabel: `${bulanLabel.value} — Wilayah: ${wilayah}`,
    items,
    totalMasuk: solarData.value.totalMasuk,
    totalKeluar: totalKeluarFiltered.value,
    saldoSaatIni: solarData.value.saldoSaatIni,
  };
}

watch(tab, (t) => {
  if (t === "solar" && !solarData.value.items.length) loadSolar();
  if (t !== "solar") solarWilayah.value = "";
});
watch(bulan, () => {
  if (tab.value === "solar") loadSolar();
});

onMounted(async () => {
  await loadConfig();
  await load();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Laporan Divisi</h1>
      <div class="desc">Laba rugi bulanan per divisi &amp; stok solar (BBM) alat berat</div>
    </div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap" v-if="tab === 'laba-rugi'">
      <button class="btn btn-ghost" @click="openImportModal">Import dari Excel</button>
      <button class="btn btn-ghost" :disabled="!laporan" @click="exportExcel">⬇ Export Excel</button>
      <button class="btn btn-ghost" :disabled="!laporan || exportingPdf" @click="exportPdf">
        {{ exportingPdf ? "Membuat PDF..." : "⬇ Export PDF" }}
      </button>
      <button class="btn btn-primary" @click="openModal">+ Catat Transaksi</button>
    </div>
    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center" v-else>
      <span v-if="solarWilayah" class="tag" style="margin-right: 4px">Filter: {{ solarWilayah }}</span>
      <button class="btn btn-ghost" @click="exportSolarExcel">⬇ Excel</button>
      <button class="btn btn-ghost" :disabled="exportingSolarPdf" @click="exportSolarPdf">
        {{ exportingSolarPdf ? "Membuat PDF..." : "⬇ PDF" }}
      </button>
      <button class="btn btn-ghost" @click="exportSolarWord">⬇ Word</button>
      <button class="btn btn-primary" @click="openSolarModal('MASUK')">+ Solar Masuk</button>
      <button class="btn btn-primary" @click="openSolarModal('KELUAR')">+ Solar Keluar</button>
    </div>
  </div>

  <div class="content">
    <div class="tabs" style="display: flex; gap: 8px; margin-bottom: 18px; border-bottom: 1px solid var(--line)">
      <button
        class="tab-btn"
        :class="{ active: tab === 'laba-rugi' }"
        @click="tab = 'laba-rugi'"
      >Laba Rugi</button>
      <button
        class="tab-btn"
        :class="{ active: tab === 'solar' }"
        @click="tab = 'solar'"
      >Stok Solar (BBM)</button>
    </div>

    <div class="row" style="max-width: 420px; margin-bottom: 20px" v-if="tab === 'laba-rugi'">
      <div class="field">
        <label>Divisi</label>
        <select v-model="divisi">
          <option v-for="d in divisiList" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div class="field"><label>Bulan</label><input v-model="bulan" type="month" /></div>
    </div>

    <div class="row" style="max-width: 220px; margin-bottom: 20px" v-else>
      <div class="field"><label>Bulan</label><input v-model="bulan" type="month" /></div>
    </div>

    <template v-if="tab === 'laba-rugi'">
    <div v-if="laporan" class="lr-doc">
      <div class="lr-head">
        <div class="lr-company">PT. BINTANG MUARA SEJATI</div>
        <div class="lr-title">LAPORAN LABA RUGI &mdash; DIVISI {{ divisi.toUpperCase() }}</div>
        <div class="lr-period">Bulan {{ bulanLabel }}</div>
      </div>

      <div v-for="k in laporan.kelompok" :key="k.key" class="card lr-section">
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
                <th v-if="k.hasQty || k.rows.some((r) => r.subKategori)">Rincian</th>
                <th class="num">Nominal</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in k.rows" :key="r.kategori + (r.subKategori || '')">
                <td>{{ i + 1 }}</td>
                <td>{{ r.kategori }}</td>
                <td v-if="k.hasQty || k.rows.some((x) => x.subKategori)">{{ r.subKategori || "-" }}</td>
                <td class="num mono">{{ rupiah(r.nominal) }}</td>
              </tr>
              <tr v-if="!k.rows.length">
                <td :colspan="k.hasQty || k.rows.some((x) => x.subKategori) ? 4 : 3" class="empty" style="padding: 10px">
                  Belum ada data.
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td :colspan="k.hasQty || k.rows.some((x) => x.subKategori) ? 3 : 2"><b>Total {{ k.label }}</b></td>
                <td class="num mono"><b>{{ rupiah(k.subtotal) }}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card lr-summary">
        <div class="lr-summary-row"><span>Total Penjualan / Pendapatan</span><b class="mono">{{ rupiah(laporan.totalPenjualan) }}</b></div>
        <div class="lr-summary-row"><span>Total Pengeluaran</span><b class="mono">{{ rupiah(laporan.totalPengeluaran) }}</b></div>
        <div class="lr-summary-row lr-final" :class="laporan.labaBersih >= 0 ? 'lr-positif' : 'lr-negatif'">
          <span>Hasil Bersih (Laba / Rugi)</span>
          <b class="mono">{{ rupiah(laporan.labaBersih) }}</b>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 24px">
      <div class="section-title">Transaksi Manual Bulan Ini</div>
      <div v-if="!txList.length" class="empty">Belum ada transaksi manual bulan ini.</div>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Kelompok</th>
              <th>Kategori</th>
              <th>Rincian</th>
              <th class="num">Nominal</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in txListVisible" :key="t.id">
              <td>{{ new Date(t.tanggal).toLocaleDateString("id-ID") }}</td>
              <td>{{ kelompokLabel(t.kelompok) }}</td>
              <td>{{ t.kategori }}</td>
              <td>
                <span v-if="t.subKategori">{{ t.subKategori }}</span>
                <span v-else-if="t.qty && t.hargaSatuan">{{ t.qty }} x {{ rupiah(t.hargaSatuan) }}</span>
                <span v-else>-</span>
              </td>
              <td class="num mono">{{ rupiah(t.nominal) }}</td>
              <td style="white-space: nowrap">
                <span v-if="isAutoMirror(t)" class="tag" title="Otomatis mengikuti input Pendapatan di Armada/Alat Berat, edit/hapus dari sana.">
                  Otomatis
                </span>
                <template v-else>
                  <button class="btn btn-ghost btn-sm" @click="openEditModal(t)">Edit</button>
                  <button class="btn btn-ghost btn-sm" @click="removeTx(t)">Hapus</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="txVisibleCount < txList.length" style="text-align:center; margin-top:12px;">
          <button class="btn btn-ghost btn-sm" @click="tampilkanLebihBanyak">
            Tampilkan Lainnya ({{ txList.length - txVisibleCount }} lagi)
          </button>
        </div>
      </div>
    </div>
    </template>

    <template v-else>
      <div class="card" style="margin-bottom: 20px">
        <div class="row" style="max-width: 640px">
          <div class="field">
            <label>Total Solar Masuk (bulan ini)</label>
            <input :value="`${solarData.totalMasuk} Liter`" disabled class="mono" />
          </div>
          <div class="field">
            <label>Total Solar Keluar (bulan ini)</label>
            <input :value="`${solarData.totalKeluar} Liter`" disabled class="mono" />
          </div>
          <div class="field">
            <label>Sisa Stok Saat Ini</label>
            <input :value="`${solarData.saldoSaatIni} Liter`" disabled class="mono" style="font-weight: 700" />
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom: 20px">
        <div class="section-title">Solar Masuk &mdash; Bulan {{ bulanLabel }}</div>
        <div v-if="solarLoading" class="empty">Memuat...</div>
        <div v-else-if="!solarMasukList.length" class="empty">Belum ada catatan solar masuk bulan ini.</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Nama Sopir</th>
                <th class="num">Liter</th>
                <th>Keterangan</th>
                <th>Bukti</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in solarMasukList" :key="t.id">
                <td class="mono">{{ t.no }}</td>
                <td>{{ new Date(t.tanggal).toLocaleDateString("id-ID") }}</td>
                <td>{{ t.nama }}</td>
                <td class="num mono">{{ t.liter }}</td>
                <td>{{ t.keterangan || "-" }}</td>
                <td>
                  <a v-if="t.buktiUrl" :href="api.fileUrl(t.buktiUrl)" target="_blank" rel="noopener">Lihat</a>
                  <span v-else>-</span>
                </td>
                <td style="white-space: nowrap">
                  <button class="btn btn-ghost btn-sm" @click="openSolarEditModal(t)">Edit</button>
                  <button class="btn btn-ghost btn-sm" @click="removeSolar(t)">Hapus</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3"><b>Total Masuk</b></td>
                <td class="num mono"><b>{{ solarData.totalMasuk }}</b></td>
                <td colspan="3"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card" style="margin-bottom: 20px">
        <div class="section-title">Rekap Solar Keluar per Wilayah &mdash; Bulan {{ bulanLabel }}</div>
        <div v-if="solarLoading" class="empty">Memuat...</div>
        <div v-else-if="!rekapPerWilayah.length" class="empty">Belum ada catatan solar keluar bulan ini.</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Wilayah / Lokasi</th>
                <th class="num">Jumlah Transaksi</th>
                <th class="num">Total Liter</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="w in rekapPerWilayah"
                :key="w.lokasi"
                style="cursor: pointer"
                :class="{ mono: false }"
                @click="solarWilayah = w.lokasi === '(Tanpa lokasi)' ? '' : (solarWilayah === w.lokasi ? '' : w.lokasi)"
              >
                <td>{{ w.lokasi }}</td>
                <td class="num mono">{{ w.jumlah }}</td>
                <td class="num mono">{{ w.liter }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td><b>Total</b></td>
                <td class="num mono"><b>{{ solarKeluarList.length }}</b></td>
                <td class="num mono"><b>{{ solarData.totalKeluar }}</b></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="desc" style="margin-top: 8px">Klik salah satu wilayah untuk memfilter tabel di bawah.</div>
      </div>

      <div class="card" style="margin-bottom: 20px">
        <div class="topbar" style="padding: 0; margin-bottom: 14px; align-items: center">
          <div class="section-title" style="margin-bottom: 0">Solar Keluar &mdash; Bulan {{ bulanLabel }}</div>
          <div class="field" style="max-width: 260px; width: 100%">
            <select v-model="solarWilayah">
              <option value="">Semua Wilayah</option>
              <option v-for="w in solarWilayahOptions" :key="w" :value="w">{{ w }}</option>
            </select>
          </div>
        </div>
        <div v-if="solarLoading" class="empty">Memuat...</div>
        <div v-else-if="!solarKeluarListFiltered.length" class="empty">
          {{ solarWilayah ? `Belum ada catatan solar keluar untuk wilayah "${solarWilayah}" bulan ini.` : "Belum ada catatan solar keluar bulan ini." }}
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Tanggal</th>
                <th>Nama Operator</th>
                <th class="num">Liter</th>
                <th>Lokasi</th>
                <th>Keterangan</th>
                <th>Bukti</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in solarKeluarListFiltered" :key="t.id">
                <td class="mono">{{ t.no }}</td>
                <td>{{ new Date(t.tanggal).toLocaleDateString("id-ID") }}</td>
                <td>{{ t.nama }}</td>
                <td class="num mono">{{ t.liter }}</td>
                <td>{{ t.lokasi || "-" }}</td>
                <td>{{ t.keterangan || "-" }}</td>
                <td>
                  <a v-if="t.buktiUrl" :href="api.fileUrl(t.buktiUrl)" target="_blank" rel="noopener">Lihat</a>
                  <span v-else>-</span>
                </td>
                <td style="white-space: nowrap">
                  <button class="btn btn-ghost btn-sm" @click="openSolarEditModal(t)">Edit</button>
                  <button class="btn btn-ghost btn-sm" @click="removeSolar(t)">Hapus</button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3"><b>Total {{ solarWilayah ? "Keluar (wilayah ini)" : "Keluar" }}</b></td>
                <td class="num mono"><b>{{ totalKeluarFiltered }}</b></td>
                <td colspan="4"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>{{ editingId ? "Edit Transaksi" : "Catat Transaksi" }} &mdash; {{ divisi }}</h2>

      <div class="field">
        <label>Kelompok</label>
        <select v-model="form.kelompok">
          <option v-for="k in kelompokOptions" :key="k.key" :value="k.key">{{ k.label }}</option>
        </select>
      </div>

      <div class="field">
        <label>Kategori</label>
        <select
          :value="kategoriCustom ? CUSTOM_OPT : form.kategori"
          @change="onKategoriSelect($event.target.value)"
        >
          <option value="" disabled>Pilih kategori</option>
          <option v-for="kt in selectedKelompok?.kategoriDefault || []" :key="kt" :value="kt">{{ kt }}</option>
          <option v-if="selectedKelompok?.allowCustom" :value="CUSTOM_OPT">+ Kategori baru (ketik manual)</option>
        </select>
        <input
          v-if="kategoriCustom"
          v-model="form.kategori"
          placeholder="Ketik nama kategori baru"
          style="margin-top: 6px"
        />
      </div>

      <!-- Rincian per kendaraan (Armada: Pendapatan & Sparepart) -->
      <div class="field" v-if="selectedKelompok?.subKategoriKendaraan">
        <label>Rincian &mdash; Nomor Polisi</label>
        <select
          :value="nopolCustom ? '__manual__' : form.subKategori"
          @change="onNopolSelect($event.target.value)"
        >
          <option value="" disabled>Pilih kendaraan</option>
          <option v-for="a in kendaraanOptions" :key="a.id" :value="a.nopol">
            {{ a.nopol }}<span v-if="a.sopir"> &mdash; {{ a.sopir }}</span>
          </option>
          <option value="__manual__">+ Nopol lain (belum terdaftar, ketik manual)</option>
        </select>
        <input
          v-if="nopolCustom"
          v-model="form.subKategori"
          placeholder="Ketik nomor polisi, mis. B 1234 XYZ"
          style="margin-top: 6px"
        />
        <div class="desc" style="margin-top: 4px">
          Kendaraan diambil dari menu Armada. Belum ada di daftar? Tambahkan dulu di menu
          <b>Armada</b>, atau ketik manual dulu di sini.
        </div>
      </div>

      <!-- Rincian bebas biasa (mis. Alat Berat: Uang Makan/Sparepart/Solar) -->
      <div class="field" v-else-if="selectedKelompok?.subKategoriDefault?.length">
        <label>Rincian (opsional)</label>
        <input v-model="form.subKategori" list="subkategori-list" placeholder="Mis. Uang Makan / Sparepart / Solar" />
        <datalist id="subkategori-list">
          <option v-for="s in selectedKelompok.subKategoriDefault" :key="s" :value="s" />
        </datalist>
      </div>

      <div v-if="selectedKelompok?.hasQty" class="row">
        <div class="field"><label>Qty</label><input v-model.number="form.qty" type="number" placeholder="mis. jumlah hari" /></div>
        <div class="field"><label>Harga Satuan</label><input v-model.number="form.hargaSatuan" type="number" /></div>
      </div>
      <div v-if="selectedKelompok?.hasQty && nominalOtomatis !== null" class="field">
        <label>Nominal (otomatis)</label>
        <input :value="rupiah(nominalOtomatis)" disabled />
      </div>

      <div class="field" v-if="!selectedKelompok?.hasQty || nominalOtomatis === null">
        <label>Nominal</label>
        <input v-model.number="form.nominal" type="number" />
      </div>

      <div class="row">
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
      </div>

      <div class="field"><label>Catatan (opsional)</label><input v-model="form.keterangan" /></div>

      <button class="btn btn-primary" @click="submit">{{ editingId ? "Simpan Perubahan" : "Simpan" }}</button>
    </div>
  </div>

  <div v-if="showImportModal" class="modal-bg" @click.self="showImportModal = false">
    <div class="modal" style="max-width: 640px; width: 92%">
      <button class="modal-close" @click="showImportModal = false">×</button>
      <h2>Import Laporan dari Excel</h2>
      <div class="desc" style="margin-bottom: 14px">
        Untuk file "Pengeluaran &lt;Bulan&gt; &lt;Tahun&gt;.xlsx" dengan sheet SUPPLIER, ARMADA,
        dan ALAT BERAT. Semua divisi di sheet-sheet itu akan diimport sekaligus.
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
        <div v-if="importResult.sheetsMissing.length" class="desc" style="margin-bottom: 8px">
          Sheet tidak ditemukan di file ini (dilewati): {{ importResult.sheetsMissing.join(", ") }}
        </div>
        <div v-for="(d, div) in importResult.perDivisi" :key="div" class="card" style="margin-bottom: 10px; padding: 10px 14px">
          <b>{{ div }}</b> &mdash; {{ d.items.length }} baris data
          <div class="desc">
            Pendapatan {{ rupiah(d.penjualan) }} &middot; Pengeluaran {{ rupiah(d.pengeluaran) }} &middot;
            Hasil Bersih {{ rupiah(d.penjualan - d.pengeluaran) }}
          </div>
        </div>
        <button class="btn btn-primary" :disabled="importSaving" @click="confirmImport">
          {{ importSaving ? "Menyimpan..." : `Simpan ${importResult.items.length} Transaksi` }}
        </button>
        <div class="desc" style="margin-top: 8px">
          Baris yang datanya persis sama dengan transaksi yang sudah ada (divisi, kelompok, kategori,
          rincian, tanggal, dan nominal sama) otomatis dilewati, jadi aman diimport ulang.
        </div>
      </div>
    </div>
  </div>

  <div v-if="showSolarModal" class="modal-bg" @click.self="showSolarModal = false">
    <div class="modal">
      <button class="modal-close" @click="showSolarModal = false">×</button>
      <h2>
        {{ editingSolarId ? "Edit" : "Catat" }}
        {{ solarForm.tipe === "MASUK" ? "Solar Masuk" : "Solar Keluar" }}
      </h2>

      <div class="row">
        <div class="field"><label>Tanggal</label><input v-model="solarForm.tanggal" type="date" /></div>
        <div class="field">
          <label>{{ solarForm.tipe === "MASUK" ? "Nama Sopir" : "Nama Operator" }}</label>
          <input v-model="solarForm.nama" :placeholder="solarForm.tipe === 'MASUK' ? 'Mis. Aceng' : 'Mis. Heri'" />
        </div>
      </div>

      <div class="row">
        <div class="field"><label>Jumlah Liter</label><input v-model.number="solarForm.liter" type="number" min="0" /></div>
        <div class="field" v-if="solarForm.tipe === 'KELUAR'">
          <label>Lokasi / Unit Tujuan</label>
          <input v-model="solarForm.lokasi" placeholder="Mis. Cimanggis / Kp. Rambutan" />
        </div>
      </div>

      <div class="field"><label>Catatan (opsional)</label><input v-model="solarForm.keterangan" /></div>

      <div class="field">
        <label>Bukti (foto surat jalan / dokumen pendukung, opsional)</label>
        <div v-if="solarExistingBukti" style="margin-bottom: 8px">
          <a :href="solarExistingBukti.url" target="_blank" rel="noopener">{{ solarExistingBukti.nama || "Lihat file saat ini" }}</a>
          <button class="btn btn-ghost btn-sm" style="margin-left: 8px" @click="hapusBuktiExisting">Hapus file ini</button>
        </div>
        <input ref="solarFileInput" type="file" accept="image/*,.pdf" />
        <div class="desc" style="margin-top: 4px">Format: foto (JPG/PNG) atau PDF, maks 10MB.</div>
      </div>

      <button class="btn btn-primary" :disabled="solarUploading" @click="submitSolar">
        {{ solarUploading ? "Menyimpan..." : editingSolarId ? "Simpan Perubahan" : "Simpan" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-btn {
  background: none;
  border: none;
  padding: 10px 16px;
  font-weight: 600;
  color: var(--ink-soft);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.tab-btn.active {
  color: var(--ink);
  border-bottom-color: var(--accent, #2563eb);
}
.lr-doc {
  max-width: 820px;
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
