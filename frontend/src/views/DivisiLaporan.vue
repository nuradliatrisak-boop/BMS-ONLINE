<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRoute } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { parseDivisiExcel } from "../utils/excelImport.js";
import { exportLaporanDivisiExcel, exportSolarStokExcel } from "../utils/excelExport.js";
import { exportLaporanDivisiPdf, exportSolarStokPdf } from "../utils/pdfExport.js";
import { exportSolarStokWord } from "../utils/wordExport.js";
import InvoiceDrilldownModal from "../components/InvoiceDrilldownModal.vue";
import RincianTransaksiModal from "../components/RincianTransaksiModal.vue";
import PetaTitik from "../components/PetaTitik.vue";
import NamaCombo from "../components/NamaCombo.vue";
import LainnyaModal from "../components/LainnyaModal.vue";
import SolarChart from "../components/SolarChart.vue";
import RingkasList from "../components/RingkasList.vue";
import SolarMasukTable from "../components/SolarMasukTable.vue";
import SolarKeluarTable from "../components/SolarKeluarTable.vue";
import WilayahSelect from "../components/WilayahSelect.vue";
import RapikanNamaModal from "../components/RapikanNamaModal.vue";
import { fmtL, fmtTgl, isoLokal } from "../utils/solarUtil.js";

const route = useRoute();
const tab = ref(route.query.tab === "solar" ? "solar" : "laba-rugi"); // "laba-rugi" | "solar"

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

// Drill-down: klik baris "Invoice (Sistem)" -> tampilkan daftar invoice
// yang jadi sumber angka itu (divisi + rentang bulan yang lagi dibuka).
const showDrilldown = ref(false);
const drilldownRange = computed(() => {
  if (!bulan.value) return { dari: "", sampai: "" };
  const [y, m] = bulan.value.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    dari: `${bulan.value}-01`,
    sampai: `${bulan.value}-${String(lastDay).padStart(2, "0")}`,
  };
});
// Drill-down umum: baris "Invoice (Sistem)" -> InvoiceDrilldownModal (di
// atas). Baris kategori lain (mis. Uang Makan, Pembayaran Cash, dst) yang
// nominalnya bukan 0 -> RincianTransaksiModal, nampilin transaksi manual
// yang jadi sumber angka baris itu. Baris kosong (nominal 0, cuma tampil
// biar formatnya konsisten) sengaja tidak diklik karena memang belum ada
// datanya.
const showRincian = ref(false);
const rincianCtx = ref({ kelompok: "", kelompokLabel: "", kategori: "", subKategori: "" });
function openRowDetail(k, r) {
  if (!r.nominal) return;
  if (r.kategori === "Invoice (Sistem)") {
    showDrilldown.value = true;
    return;
  }
  rincianCtx.value = {
    kelompok: k.key,
    kelompokLabel: k.label,
    kategori: r.kategori,
    subKategori: r.subKategori || "",
  };
  showRincian.value = true;
}

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
const solarData = ref({
  items: [],
  totalMasuk: 0, // stok real yang masuk
  totalCatatan: 0, // total menurut buku catatan sopir (baris yang catatannya sudah diisi)
  totalKeluar: 0,
  totalKurang: 0,
  totalLebih: 0,
  belumDicek: 0,
  belumDicekSemua: 0,
  saldoBulan: 0,
  saldoSaatIni: 0,
});
const solarUtang = ref([]); // rekap saldo utang per sopir (semua waktu)
const namaMasuk = ref([]); // daftar nama untuk dropdown
const namaKeluar = ref([]);
const belumDicekList = ref([]); // semua solar masuk yang catatan bukunya belum diisi (semua tanggal)
const cekMassal = ref({}); // { [id]: string } catatan buku yang diketik di panel Cek
const cekMassalSaving = ref(false);
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
  literCatatan: "", // catatan buku sopir (khusus MASUK, opsional)
  lokasi: "",
  keterangan: "",
});
const solarForm = ref(emptySolarForm("MASUK"));
const solarExistingBukti = ref(null); // { url, nama } kalau lagi edit & sudah ada file
const solarHapusBukti = ref(false);

const solarMasukList = computed(() => solarData.value.items.filter((t) => t.tipe === "MASUK"));
const solarKeluarList = computed(() => solarData.value.items.filter((t) => t.tipe === "KELUAR"));

// --- Filter waktu tab Solar: "Per Bulan", "Per Minggu" (Senin-Minggu),
// "Rentang Tanggal" (dari - sampai bebas), atau "Semua Waktu" (keseluruhan).
// Independen dari tab Laba Rugi yang selalu per bulan. ---
const solarPeriodeMode = ref("bulan"); // "bulan" | "minggu" | "rentang" | "semua"
const hariIniStr = isoLokal(new Date());
const solarDari = ref(hariIniStr);
const solarSampai = ref(hariIniStr);
const solarMingguTgl = ref(hariIniStr); // tanggal mana saja di dalam minggu yang dilihat

const tglLokal = (str) => new Date(str + "T00:00:00");
const fmtDMY = (str) => tglLokal(str).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

const mingguRange = computed(() => {
  const d = tglLokal(solarMingguTgl.value || hariIniStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // mundur ke Senin
  const e = new Date(d);
  e.setDate(e.getDate() + 6);
  return { dari: isoLokal(d), sampai: isoLokal(e) };
});
function geserMinggu(n) {
  const d = tglLokal(solarMingguTgl.value || hariIniStr);
  d.setDate(d.getDate() + 7 * n);
  solarMingguTgl.value = isoLokal(d);
}
function geserBulan(n) {
  const [y, m] = bulan.value.split("-").map(Number);
  bulan.value = isoLokal(new Date(y, m - 1 + n, 1)).slice(0, 7);
}
function presetRentang(hari) {
  const s = new Date();
  const d = new Date();
  d.setDate(d.getDate() - (hari - 1));
  solarDari.value = isoLokal(d);
  solarSampai.value = isoLokal(s);
}
function presetTahunIni() {
  solarDari.value = `${new Date().getFullYear()}-01-01`;
  solarSampai.value = hariIniStr;
}

const solarPeriodeLabel = computed(() => {
  const m = solarPeriodeMode.value;
  if (m === "semua") return "Semua Waktu";
  if (m === "minggu") return `${fmtDMY(mingguRange.value.dari)} – ${fmtDMY(mingguRange.value.sampai)}`;
  if (m === "rentang") {
    if (!solarDari.value && !solarSampai.value) return "Semua Waktu";
    const d = solarDari.value ? fmtDMY(solarDari.value) : "awal";
    const s = solarSampai.value ? fmtDMY(solarSampai.value) : "sekarang";
    return `${d} – ${s}`;
  }
  return bulanLabel.value;
});

// --- Rekap Solar Keluar per Wilayah/Lokasi ---
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

// --- Titik peta Solar Keluar, dikelompokkan per lokasi ---
const titikSolarPeta = computed(() => {
  const map = new Map();
  for (const t of solarKeluarList.value) {
    if (t.lokasiLat == null || t.lokasiLng == null) continue;
    const lok = (t.lokasi || "").trim() || "(Tanpa nama)";
    const p = map.get(lok) || { lat: t.lokasiLat, lng: t.lokasiLng, label: lok, liter: 0, jumlah: 0 };
    p.liter += t.liter;
    p.jumlah += 1;
    map.set(lok, p);
  }
  return [...map.values()].map((p) => ({ ...p, valueLabel: `${p.liter} Liter • ${p.jumlah} transaksi` }));
});
const solarTanpaKoordinat = computed(() => {
  const seen = new Set();
  for (const t of solarKeluarList.value) {
    if (t.lokasi && (t.lokasiLat == null || t.lokasiLng == null)) seen.add(t.lokasi);
  }
  return [...seen];
});

// Rekap per wilayah selalu dihitung dari SELURUH data periode (tidak ikut
// filter tabel), supaya tetap bisa membandingkan semua wilayah.
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

// ---------- Ringkasan & grafik ----------
const r1 = (x) => Math.round(x * 10) / 10;
const kunciTgl = (t) => String(t.tanggal).slice(0, 10);

const keluarPerHari = computed(() => {
  const m = new Map();
  for (const t of solarKeluarList.value) m.set(kunciTgl(t), (m.get(kunciTgl(t)) || 0) + t.liter);
  return m;
});
const rataKeluarHari = computed(() =>
  keluarPerHari.value.size ? r1(solarData.value.totalKeluar / keluarPerHari.value.size) : 0
);
const hariPuncak = computed(() => {
  let best = null;
  for (const [k, v] of keluarPerHari.value) if (!best || v > best.v) best = { k, v };
  return best;
});

const periodeRange = computed(() => {
  const m = solarPeriodeMode.value;
  if (m === "bulan" && bulan.value) {
    const [y, mo] = bulan.value.split("-").map(Number);
    return { start: isoLokal(new Date(y, mo - 1, 1)), end: isoLokal(new Date(y, mo, 0)) };
  }
  if (m === "minggu") return { start: mingguRange.value.dari, end: mingguRange.value.sampai };
  if (m === "rentang" && solarDari.value && solarSampai.value && solarDari.value <= solarSampai.value)
    return { start: solarDari.value, end: solarSampai.value };
  return null; // "semua": ikut rentang data
});

const rangeEfektif = computed(() => {
  let r = periodeRange.value;
  if (!r) {
    const items = solarData.value.items;
    if (!items.length) return null;
    const ds = items.map(kunciTgl).sort();
    r = { start: ds[0], end: ds[ds.length - 1] };
  }
  const span = Math.round((new Date(r.end + "T00:00:00Z") - new Date(r.start + "T00:00:00Z")) / 864e5) + 1;
  return { ...r, unit: span <= 45 ? "hari" : span <= 200 ? "minggu" : "bulan" };
});
const solarBarUnit = computed(() => (rangeEfektif.value ? `per ${rangeEfektif.value.unit}` : ""));

const solarBars = computed(() => {
  const r = rangeEfektif.value;
  if (!r) return [];
  const items = solarData.value.items;
  const unit = r.unit;
  const s = new Date(r.start + "T00:00:00Z");
  const e = new Date(r.end + "T00:00:00Z");
  const keyOf = (ds) => {
    if (unit === "hari") return ds;
    if (unit === "bulan") return ds.slice(0, 7);
    const d = new Date(ds + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };
  const map = new Map();
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = keyOf(d.toISOString().slice(0, 10));
    if (!map.has(k)) map.set(k, { key: k, masuk: 0, keluar: 0 });
  }
  for (const t of items) {
    const b = map.get(keyOf(kunciTgl(t)));
    if (!b) continue;
    if (t.tipe === "MASUK") b.masuk += t.liter;
    else b.keluar += t.liter;
  }
  const HARI = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  return [...map.values()].map((b) => {
    const [yy, mm, dd] = b.key.split("-");
    let label, tip;
    if (unit === "hari") {
      const d = new Date(b.key + "T00:00:00Z");
      label = String(Number(dd));
      tip = `${HARI[d.getUTCDay()]}, ${Number(dd)} ${BULAN_NAMA[Number(mm) - 1]} ${yy}`;
    } else if (unit === "minggu") {
      const akhir = new Date(b.key + "T00:00:00Z");
      akhir.setUTCDate(akhir.getUTCDate() + 6);
      label = `${Number(dd)}/${Number(mm)}`;
      tip = `Minggu ${Number(dd)} ${BULAN_NAMA[Number(mm) - 1]} – ${akhir.getUTCDate()} ${BULAN_NAMA[akhir.getUTCMonth()]} ${akhir.getUTCFullYear()}`;
    } else {
      label = `${BULAN_NAMA[Number(mm) - 1].slice(0, 3)} ${yy.slice(2)}`;
      tip = `${BULAN_NAMA[Number(mm) - 1]} ${yy}`;
    }
    return { label, tip, masuk: r1(b.masuk), keluar: r1(b.keluar) };
  });
});

const operatorRows = computed(() => {
  const m = new Map();
  for (const t of solarKeluarList.value) {
    const k = t.nama.trim().toLowerCase();
    const cur = m.get(k) || { label: t.nama, value: 0, n: 0, lok: new Map() };
    cur.value += t.liter;
    cur.n += 1;
    if (t.lokasi) cur.lok.set(t.lokasi, (cur.lok.get(t.lokasi) || 0) + t.liter);
    m.set(k, cur);
  }
  return [...m.values()]
    .sort((a, b) => b.value - a.value)
    .map((r) => {
      const top = [...r.lok.entries()].sort((a, b) => b[1] - a[1])[0];
      return { label: r.label, value: r1(r.value), sub: `${r.n} pengambilan${top ? ` • terbanyak ke ${top[0]}` : ""}` };
    });
});
const wilayahRows = computed(() =>
  rekapPerWilayah.value.map((w) => ({ label: w.lokasi, value: r1(w.liter), sub: `${w.jumlah} transaksi` }))
);
const sopirRows = computed(() => {
  const m = new Map();
  for (const t of solarMasukList.value) {
    const k = t.nama.trim().toLowerCase();
    const cur = m.get(k) || { label: t.nama, value: 0, n: 0, kurang: 0 };
    cur.value += t.liter;
    cur.n += 1;
    if (t.selisih < 0) cur.kurang += -t.selisih;
    m.set(k, cur);
  }
  return [...m.values()]
    .sort((a, b) => b.value - a.value)
    .map((r) => ({
      label: r.label,
      value: r1(r.value),
      sub: `${r.n} setoran${r.kurang > 0 ? ` • kurang setor ${fmtL(r.kurang)} L` : ""}`,
    }));
});

// ---------- Daftar ringkas + "Lainnya" ----------
const PREVIEW = 8;
const showSemua = ref(""); // "" | "MASUK" | "KELUAR" | "UTANG"
const cariSemua = ref("");
const statusSemua = ref("");
const cekExpand = ref(false);
const showRapikan = ref(false);

function bukaSemua(jenis) {
  cariSemua.value = "";
  statusSemua.value = "";
  showSemua.value = jenis;
}
const cocokCari = (t, ...fields) => {
  const q = cariSemua.value.trim().toLowerCase();
  return !q || fields.some((f) => String(t[f] ?? "").toLowerCase().includes(q));
};
const masukPreview = computed(() => solarMasukList.value.slice(0, PREVIEW));
const keluarPreview = computed(() => solarKeluarListFiltered.value.slice(0, PREVIEW));
const masukModal = computed(() =>
  solarMasukList.value.filter(
    (t) => cocokCari(t, "nama", "keterangan", "no") && (!statusSemua.value || t.statusCek === statusSemua.value)
  )
);
const keluarModal = computed(() =>
  solarKeluarListFiltered.value.filter((t) => cocokCari(t, "nama", "lokasi", "keterangan", "no"))
);
const utangPreview = computed(() => solarUtang.value.slice(0, 6));
const utangModal = computed(() => {
  const q = cariSemua.value.trim().toLowerCase();
  return q ? solarUtang.value.filter((r) => r.nama.toLowerCase().includes(q)) : solarUtang.value;
});
const belumDicekTampil = computed(() => (cekExpand.value ? belumDicekList.value : belumDicekList.value.slice(0, 6)));

function pilihWilayah(label) {
  if (label === "(Tanpa lokasi)") return (solarWilayah.value = "");
  solarWilayah.value = solarWilayah.value === label ? "" : label;
}

// ---------- Wilayah tujuan: dropdown + isian otomatis dari kebiasaan ----------
const lokasiOpsi = ref([]); // [{ lokasi, jumlah }]
const polaNama = ref({}); // { "wartono": "Cimanggis" }
const lokasiDefault = ref("");
const lokasiManual = ref(false); // true = staf sudah memilih sendiri, jangan ditimpa otomatis
const namaKeyF = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

async function loadSolarLokasi() {
  try {
    const r = await api.get("/solar-tx/lokasi");
    lokasiOpsi.value = r.lokasi;
    polaNama.value = r.polaNama;
    lokasiDefault.value = r.defaultLokasi || "";
  } catch (e) {
    console.error(e);
  }
}
const lokasiOtomatisInfo = computed(() => {
  if (solarForm.value.tipe !== "KELUAR" || editingSolarId.value || lokasiManual.value) return "";
  const pola = polaNama.value[namaKeyF(solarForm.value.nama)];
  if (pola && solarForm.value.lokasi === pola) return `Diisi otomatis: biasanya ${solarForm.value.nama} ke ${pola}. Bisa diganti.`;
  if (solarForm.value.lokasi && solarForm.value.lokasi === lokasiDefault.value) return "Diisi otomatis dari wilayah yang paling sering dipakai. Bisa diganti.";
  return "";
});
function isiLokasiOtomatis() {
  if (solarForm.value.tipe !== "KELUAR" || editingSolarId.value || lokasiManual.value) return;
  solarForm.value.lokasi = polaNama.value[namaKeyF(solarForm.value.nama)] || lokasiDefault.value || "";
}
function ubahLokasi(v) {
  lokasiManual.value = true;
  solarForm.value.lokasi = v;
}

async function loadSolar() {
  const mode = solarPeriodeMode.value;
  if (mode === "bulan" && !bulan.value) return;

  const params = new URLSearchParams();
  if (mode === "bulan") {
    params.set("bulan", bulan.value);
  } else if (mode === "minggu") {
    params.set("dari", mingguRange.value.dari);
    params.set("sampai", mingguRange.value.sampai);
  } else if (mode === "rentang") {
    if (solarDari.value) params.set("dari", solarDari.value);
    if (solarSampai.value) params.set("sampai", solarSampai.value);
  }
  // mode "semua" -> tanpa parameter sama sekali

  solarLoading.value = true;
  try {
    const qs = params.toString();
    solarData.value = await api.get(`/solar-tx${qs ? `?${qs}` : ""}`);
    loadSolarUtang();
    loadSolarNama();
    loadSolarLokasi();
    loadBelumDicek();
  } finally {
    solarLoading.value = false;
  }
}

async function loadBelumDicek() {
  try {
    belumDicekList.value = await api.get("/solar-tx/belum-dicek");
  } catch (e) {
    console.error(e);
  }
}

const cekMassalTerisi = computed(() =>
  belumDicekList.value.filter((t) => cekMassal.value[t.id] !== undefined && cekMassal.value[t.id] !== "")
);
// selisih = real - catatan buku (minus = kurang)
const selisihMassal = (t) => t.liter - Number(cekMassal.value[t.id]);

async function simpanCekMassal() {
  const items = cekMassalTerisi.value.map((t) => ({ id: t.id, literCatatan: Number(cekMassal.value[t.id]) }));
  if (!items.length) return toast("Isi dulu catatan buku minimal satu baris");
  cekMassalSaving.value = true;
  try {
    const r = await api.post("/solar-tx/catatan-massal", { items });
    toast(`${r.disimpan} catatan buku disimpan${r.dilewati.length ? `, ${r.dilewati.length} dilewati` : ""}`);
    for (const t of cekMassalTerisi.value) delete cekMassal.value[t.id];
    await loadSolar();
  } catch (e) {
    toast(e.message || "Gagal menyimpan hasil cek");
  } finally {
    cekMassalSaving.value = false;
  }
}

async function loadSolarUtang() {
  try {
    solarUtang.value = await api.get("/solar-tx/utang");
  } catch (e) {
    console.error(e);
  }
}

async function loadSolarNama() {
  try {
    const [m, k] = await Promise.all([api.get("/solar-tx/nama?tipe=MASUK"), api.get("/solar-tx/nama?tipe=KELUAR")]);
    namaMasuk.value = m;
    namaKeluar.value = k;
  } catch (e) {
    console.error(e);
  }
}

const solarNamaOptions = computed(() => (solarForm.value.tipe === "MASUK" ? namaMasuk.value : namaKeluar.value));

// --- Cek keesokan hari: angka real yang masuk (sudah tercatat) dibandingkan
// dengan catatan di buku sopir untuk tanggal itu. Selisih, status, dan saldo
// utang per sopir dihitung otomatis di backend. ---
async function cekSesuai(t) {
  try {
    await api.post(`/solar-tx/${t.id}/catatan`, {});
    toast(`${t.nama} — catatan buku sama dengan real (${t.liter} L)`);
    await loadSolar();
  } catch (e) {
    toast(e.message || "Gagal menyimpan catatan buku");
  }
}

async function cekBeda(t, nilai) {
  if (nilai === undefined || nilai === "" || Number.isNaN(Number(nilai))) {
    return toast("Isi dulu angka di buku catatan");
  }
  try {
    await api.post(`/solar-tx/${t.id}/catatan`, { literCatatan: Number(nilai) });
    toast(`${t.nama} — catatan buku ${nilai} L disimpan`);
    await loadSolar();
  } catch (e) {
    toast(e.message || "Gagal menyimpan catatan buku");
  }
}

async function batalCek(t) {
  if (!confirm(`Hapus catatan buku untuk ${t.nama} (${new Date(t.tanggal).toLocaleDateString("id-ID")})?`)) return;
  try {
    await api.post(`/solar-tx/${t.id}/hapus-catatan`, {});
    toast("Catatan buku dihapus");
    await loadSolar();
  } catch (e) {
    toast(e.message || "Gagal menghapus catatan buku");
  }
}

function openSolarModal(tipe) {
  editingSolarId.value = null;
  solarForm.value = emptySolarForm(tipe);
  lokasiManual.value = false;
  if (tipe === "KELUAR") solarForm.value.lokasi = lokasiDefault.value || "";
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
    literCatatan: t.literCatatan ?? "",
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
    return toast("Wilayah tujuan wajib diisi untuk Solar Keluar");
  }

  const fd = new FormData();
  fd.append("tipe", solarForm.value.tipe);
  fd.append("tanggal", solarForm.value.tanggal);
  fd.append("nama", solarForm.value.nama);
  fd.append("liter", String(literNum));
  if (solarForm.value.tipe === "MASUK") fd.append("literCatatan", String(solarForm.value.literCatatan ?? ""));
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
    return { bulanLabel: solarPeriodeLabel.value, ...solarData.value };
  }
  const items = solarData.value.items.filter(
    (t) => t.tipe === "MASUK" || (t.lokasi || "").trim() === wilayah
  );
  return {
    bulanLabel: `${solarPeriodeLabel.value} — Wilayah: ${wilayah}`,
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
  if (tab.value === "solar" && solarPeriodeMode.value === "bulan") loadSolar();
});
watch(() => solarForm.value.nama, isiLokasiOtomatis);
watch(solarMingguTgl, () => {
  if (tab.value === "solar" && solarPeriodeMode.value === "minggu") loadSolar();
});
watch(solarPeriodeMode, () => {
  if (tab.value === "solar") loadSolar();
});
watch([solarDari, solarSampai], () => {
  if (tab.value === "solar" && solarPeriodeMode.value === "rentang") loadSolar();
});

onMounted(async () => {
  await loadConfig();
  await load();
  if (tab.value === "solar") loadSolar();
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
      <button class="btn btn-ghost" title="Gabungkan nama yang sama tapi ditulis beda (mis. Warto & Wartono)" @click="showRapikan = true">Rapikan Nama</button>
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

    <div class="row" style="margin-bottom: 20px; align-items: flex-end" v-else>
      <div class="field" style="max-width: 200px">
        <label>Filter Waktu</label>
        <select v-model="solarPeriodeMode">
          <option value="bulan">Per Bulan</option>
          <option value="minggu">Per Minggu</option>
          <option value="rentang">Rentang Tanggal</option>
          <option value="semua">Keseluruhan</option>
        </select>
      </div>
      <div class="field" style="max-width: 280px" v-if="solarPeriodeMode === 'bulan'">
        <label>Bulan</label>
        <div class="sol-nav">
          <button class="btn btn-ghost btn-sm" title="Bulan sebelumnya" @click="geserBulan(-1)">‹</button>
          <input v-model="bulan" type="month" />
          <button class="btn btn-ghost btn-sm" title="Bulan berikutnya" @click="geserBulan(1)">›</button>
        </div>
      </div>
      <div class="field" style="max-width: 400px" v-if="solarPeriodeMode === 'minggu'">
        <label>Minggu (Senin – Minggu) &mdash; pilih tanggal mana saja</label>
        <div class="sol-nav">
          <button class="btn btn-ghost btn-sm" title="Minggu sebelumnya" @click="geserMinggu(-1)">‹</button>
          <input v-model="solarMingguTgl" type="date" />
          <button class="btn btn-ghost btn-sm" title="Minggu berikutnya" @click="geserMinggu(1)">›</button>
        </div>
        <div class="desc" style="margin-top: 4px">{{ solarPeriodeLabel }}</div>
      </div>
      <template v-if="solarPeriodeMode === 'rentang'">
        <div class="field" style="max-width: 180px">
          <label>Dari Tanggal</label>
          <input v-model="solarDari" type="date" />
        </div>
        <div class="field" style="max-width: 180px">
          <label>Sampai Tanggal</label>
          <input v-model="solarSampai" type="date" />
        </div>
        <div class="field" style="max-width: 320px">
          <label>Pintasan</label>
          <div class="sol-chips">
            <button class="btn btn-ghost btn-sm" @click="presetRentang(7)">7 hari</button>
            <button class="btn btn-ghost btn-sm" @click="presetRentang(30)">30 hari</button>
            <button class="btn btn-ghost btn-sm" @click="presetRentang(90)">90 hari</button>
            <button class="btn btn-ghost btn-sm" @click="presetTahunIni">Tahun ini</button>
          </div>
        </div>
      </template>
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
              <tr
                v-for="(r, i) in k.rows"
                :key="r.kategori + (r.subKategori || '')"
                :class="{ 'clickable-row': !!r.nominal }"
                @click="openRowDetail(k, r)"
              >
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
              <th>Catatan</th>
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
              <td style="max-width: 360px; white-space: normal">{{ t.keterangan || "-" }}</td>
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
      <!-- ===== RINGKASAN PERIODE ===== -->
      <div class="sol-periode">
        <div>
          <div class="msub">Periode</div>
          <div class="sol-periode-label">{{ solarPeriodeLabel }}</div>
        </div>
        <div class="msub" v-if="!solarLoading">
          {{ solarMasukList.length }} setoran masuk • {{ solarKeluarList.length }} pengambilan keluar
        </div>
        <div class="msub" v-else>Memuat…</div>
      </div>

      <div class="sol-kpis">
        <div class="sol-kpi" style="--c: #159447">
          <div class="sol-kpi-lbl">Solar Masuk</div>
          <div class="sol-kpi-val">{{ fmtL(solarData.totalMasuk) }} <small>L</small></div>
          <div class="sol-kpi-sub">{{ solarMasukList.length }} setoran</div>
        </div>
        <div class="sol-kpi" style="--c: #e08a12">
          <div class="sol-kpi-lbl">Solar Keluar</div>
          <div class="sol-kpi-val">{{ fmtL(solarData.totalKeluar) }} <small>L</small></div>
          <div class="sol-kpi-sub">{{ solarKeluarList.length }} pengambilan • rata-rata {{ fmtL(rataKeluarHari) }} L/hari aktif</div>
        </div>
        <div class="sol-kpi" :style="{ '--c': solarData.saldoBulan >= 0 ? '#2459a6' : '#c91c22' }">
          <div class="sol-kpi-lbl">Selisih Periode (Masuk − Keluar)</div>
          <div class="sol-kpi-val">{{ solarData.saldoBulan > 0 ? "+" : "" }}{{ fmtL(solarData.saldoBulan) }} <small>L</small></div>
          <div class="sol-kpi-sub">{{ solarData.saldoBulan >= 0 ? "Stok bertambah" : "Stok berkurang" }} di periode ini</div>
        </div>
        <div class="sol-kpi sol-kpi-utama" style="--c: #173f7a">
          <div class="sol-kpi-lbl">Sisa Stok Saat Ini</div>
          <div class="sol-kpi-val">{{ fmtL(solarData.saldoSaatIni) }} <small>L</small></div>
          <div class="sol-kpi-sub">Semua waktu, tidak terpengaruh filter</div>
        </div>
        <div class="sol-kpi" :style="{ '--c': solarData.totalKurang > 0 ? '#c91c22' : '#159447' }">
          <div class="sol-kpi-lbl">Kurang Setor</div>
          <div class="sol-kpi-val" :style="solarData.totalKurang > 0 ? 'color: #b91c1c' : ''">{{ fmtL(solarData.totalKurang) }} <small>L</small></div>
          <div class="sol-kpi-sub">Lebih setor {{ fmtL(solarData.totalLebih) }} L</div>
        </div>
        <div class="sol-kpi" :style="{ '--c': solarData.belumDicek > 0 ? '#c47b12' : '#159447' }">
          <div class="sol-kpi-lbl">Belum Dicek</div>
          <div class="sol-kpi-val">{{ solarData.belumDicek }} <small>catatan</small></div>
          <div class="sol-kpi-sub">{{ solarData.belumDicekSemua }} di semua waktu</div>
        </div>
      </div>

      <!-- ===== GRAFIK ===== -->
      <div class="card" style="margin-bottom: 20px">
        <div class="section-title">
          Grafik Masuk vs Keluar
          <span class="tag" v-if="solarBars.length">{{ solarBarUnit }}</span>
        </div>
        <SolarChart :bars="solarBars" />
        <div v-if="hariPuncak" class="msub" style="margin-top: 6px">
          Pengambilan terbanyak: <b>{{ fmtL(hariPuncak.v) }} L</b> pada {{ fmtTgl(hariPuncak.k) }}.
        </div>
      </div>

      <!-- ===== PERINGKAT ===== -->
      <div class="card" style="margin-bottom: 20px">
        <div class="sol-rank">
          <RingkasList
            title="Wilayah Tujuan Terbanyak"
            :rows="wilayahRows"
            :aktif="solarWilayah"
            klikable
            warna="#e08a12"
            kosong="Belum ada solar keluar pada periode ini."
            @pilih="pilihWilayah"
          />
          <RingkasList
            title="Operator Pengambil Terbanyak"
            :rows="operatorRows"
            warna="#e08a12"
            kosong="Belum ada solar keluar pada periode ini."
          />
          <RingkasList
            title="Sopir Penyetor Terbanyak"
            :rows="sopirRows"
            warna="#159447"
            kosong="Belum ada solar masuk pada periode ini."
          />
        </div>
        <div class="desc" style="margin-top: 10px">Klik salah satu wilayah untuk memfilter daftar Solar Keluar di bawah.</div>
      </div>

      <!-- ===== CEK SOLAR MASUK ===== -->
      <div v-if="belumDicekList.length" class="card" style="margin-bottom: 20px; border-color: #f3b4b4">
        <div class="section-title">
          Cek Solar Masuk
          <span class="tag">{{ belumDicekList.length }} belum dicek</span>
        </div>
        <div class="msub" style="margin-bottom: 10px">
          Angka real yang sudah tercatat (kiri) dan catatan buku sopir (kanan) berdampingan. Isi angka di buku
          catatan, selisih langsung kelihatan. Urut dari yang paling lama.
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Nama Sopir</th>
                <th class="num">Real yang Masuk (L)</th>
                <th>Catatan Buku Sopir (L)</th>
                <th>Selisih</th>
                <th>Keterangan</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in belumDicekTampil" :key="t.id">
                <td>{{ fmtTgl(t.tanggal) }}</td>
                <td>{{ t.nama }}</td>
                <td class="num mono"><b>{{ fmtL(t.liter) }}</b></td>
                <td>
                  <div style="display: flex; gap: 6px; align-items: center">
                    <input v-model="cekMassal[t.id]" type="number" step="0.1" min="0" placeholder="Buku (L)" style="width: 110px" />
                    <button class="btn btn-sm btn-ghost" title="Samakan dengan angka real" @click="cekMassal[t.id] = String(t.liter)">
                      = Sesuai
                    </button>
                  </div>
                </td>
                <td class="mono">
                  <template v-if="cekMassal[t.id] !== undefined && cekMassal[t.id] !== ''">
                    <span v-if="selisihMassal(t) === 0" style="color: #15803d">Pas</span>
                    <span v-else-if="selisihMassal(t) < 0" style="color: #b91c1c">Kurang {{ Math.abs(Math.round(selisihMassal(t) * 100) / 100) }}</span>
                    <span v-else style="color: #b45309">Lebih {{ Math.round(selisihMassal(t) * 100) / 100 }}</span>
                  </template>
                  <span v-else class="msub">-</span>
                </td>
                <td>{{ t.keterangan || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="belumDicekList.length > 6"
          class="btn btn-ghost btn-sm"
          style="margin-top: 8px"
          @click="cekExpand = !cekExpand"
        >{{ cekExpand ? "Sembunyikan" : `Lainnya (${belumDicekList.length - 6}) ›` }}</button>
        <div style="margin-top: 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
          <button class="btn btn-primary" :disabled="cekMassalSaving || !cekMassalTerisi.length" @click="simpanCekMassal">
            {{ cekMassalSaving ? "Menyimpan..." : `Simpan yang sudah diisi (${cekMassalTerisi.length})` }}
          </button>
          <span class="msub">Baris yang dikosongkan tidak disimpan. Angka real tidak berubah.</span>
        </div>
      </div>

      <!-- ===== SOLAR MASUK ===== -->
      <div class="card" style="margin-bottom: 20px">
        <div class="section-title">
          Solar Masuk &mdash; {{ solarPeriodeLabel }}
          <span class="tag">{{ solarMasukList.length }} catatan</span>
        </div>
        <div v-if="solarLoading" class="empty">Memuat...</div>
        <div v-else-if="!solarMasukList.length" class="empty">Belum ada catatan solar masuk pada periode ini.</div>
        <template v-else>
          <SolarMasukTable
            :items="masukPreview"
            @sesuai="cekSesuai"
            @beda="cekBeda"
            @batal="batalCek"
            @edit="openSolarEditModal"
            @hapus="removeSolar"
          />
          <button v-if="solarMasukList.length > PREVIEW" class="btn btn-ghost" style="margin-top: 10px" @click="bukaSemua('MASUK')">
            Lainnya ({{ solarMasukList.length - PREVIEW }}) &rsaquo; lihat semua
          </button>
          <div class="desc" style="margin-top: 8px">
            Menampilkan {{ Math.min(PREVIEW, solarMasukList.length) }} catatan terbaru. Catatan buku sopir dicocokkan dengan angka real
            <b>keesokan harinya</b>. Stok selalu memakai angka real.
          </div>
        </template>
      </div>

      <!-- ===== UTANG PER SOPIR ===== -->
      <div class="card" style="margin-bottom: 20px">
        <div class="section-title">Rekap Utang Solar per Sopir</div>
        <div class="msub" style="margin-bottom: 10px">
          Dihitung otomatis dari semua catatan yang sudah dicek (semua waktu). Kelebihan setor di hari lain
          otomatis menutup kekurangan sebelumnya.
        </div>
        <div v-if="!solarUtang.length" class="empty" style="padding: 10px 0">Belum ada catatan buku yang dicocokkan.</div>
        <template v-else>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nama Sopir</th>
                  <th class="num">Total Dicatat (L)</th>
                  <th class="num">Total Real (L)</th>
                  <th class="num">Saldo Utang (L)</th>
                  <th class="num">Belum Dicek</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in utangPreview" :key="r.nama">
                  <td>{{ r.nama }}</td>
                  <td class="num mono">{{ fmtL(r.totalDicatat) }}</td>
                  <td class="num mono">{{ fmtL(r.totalReal) }}</td>
                  <td class="num mono" :style="{ color: r.saldo > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }">
                    <template v-if="r.saldo > 0">{{ fmtL(r.saldo) }}</template>
                    <template v-else-if="r.saldo < 0">0 <span style="font-size: 11px; font-weight: 400">(lebih {{ fmtL(Math.abs(r.saldo)) }})</span></template>
                    <template v-else>0 <span style="font-size: 11px; font-weight: 400">(lunas)</span></template>
                  </td>
                  <td class="num mono">{{ r.belumDicek || "-" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <button v-if="solarUtang.length > 6" class="btn btn-ghost btn-sm" style="margin-top: 8px" @click="bukaSemua('UTANG')">
            Lainnya ({{ solarUtang.length - 6 }}) &rsaquo;
          </button>
        </template>
      </div>

      <!-- ===== PETA ===== -->
      <div class="card" style="margin-bottom: 20px">
        <div class="section-title">Peta Lokasi Solar Keluar</div>
        <PetaTitik :points="titikSolarPeta" :height="260" empty-text="Belum ada titik lokasi solar keluar pada periode ini." />
        <div class="note" v-if="solarTanpaKoordinat.length" style="margin-top: 8px">
          {{ solarTanpaKoordinat.length }} nama lokasi belum ketemu koordinatnya (cek ejaan nama lokasinya):
          {{ solarTanpaKoordinat.join(", ") }}
        </div>
      </div>

      <!-- ===== SOLAR KELUAR ===== -->
      <div class="card" style="margin-bottom: 20px">
        <div class="topbar" style="padding: 0; margin-bottom: 14px; align-items: center">
          <div class="section-title" style="margin-bottom: 0">
            Solar Keluar &mdash; {{ solarPeriodeLabel }}
            <span class="tag">{{ solarKeluarListFiltered.length }} catatan</span>
          </div>
          <div class="field" style="max-width: 260px; width: 100%">
            <select v-model="solarWilayah">
              <option value="">Semua Wilayah</option>
              <option v-for="w in solarWilayahOptions" :key="w" :value="w">{{ w }}</option>
            </select>
          </div>
        </div>
        <div v-if="solarLoading" class="empty">Memuat...</div>
        <div v-else-if="!solarKeluarListFiltered.length" class="empty">
          {{ solarWilayah ? `Belum ada catatan solar keluar untuk wilayah "${solarWilayah}" pada periode ini.` : "Belum ada catatan solar keluar pada periode ini." }}
        </div>
        <template v-else>
          <SolarKeluarTable :items="keluarPreview" @edit="openSolarEditModal" @hapus="removeSolar" />
          <button v-if="solarKeluarListFiltered.length > PREVIEW" class="btn btn-ghost" style="margin-top: 10px" @click="bukaSemua('KELUAR')">
            Lainnya ({{ solarKeluarListFiltered.length - PREVIEW }}) &rsaquo; lihat semua
          </button>
          <div class="desc" style="margin-top: 8px">Menampilkan {{ Math.min(PREVIEW, solarKeluarListFiltered.length) }} catatan terbaru.</div>
        </template>
      </div>

      <!-- ===== MODAL "LAINNYA" ===== -->
      <LainnyaModal
        v-if="showSemua === 'MASUK'"
        :title="`Semua Solar Masuk — ${solarPeriodeLabel}`"
        @close="showSemua = ''"
      >
        <div class="sol-modal-filter">
          <input v-model="cariSemua" placeholder="Cari nama sopir / keterangan / nomor…" />
          <select v-model="statusSemua">
            <option value="">Semua status</option>
            <option value="KURANG">Kurang</option>
            <option value="LEBIH">Lebih</option>
            <option value="SESUAI">Sesuai</option>
            <option value="BELUM_DICEK">Belum dicek</option>
            <option value="MENUNGGU">Dicek besok</option>
          </select>
        </div>
        <div v-if="!masukModal.length" class="empty">Tidak ada yang cocok.</div>
        <SolarMasukTable v-else :items="masukModal" @sesuai="cekSesuai" @beda="cekBeda" @batal="batalCek" @edit="openSolarEditModal" @hapus="removeSolar" />
      </LainnyaModal>

      <LainnyaModal
        v-if="showSemua === 'KELUAR'"
        :title="`Semua Solar Keluar — ${solarPeriodeLabel}${solarWilayah ? ' • ' + solarWilayah : ''}`"
        @close="showSemua = ''"
      >
        <div class="sol-modal-filter">
          <input v-model="cariSemua" placeholder="Cari operator / wilayah / keterangan / nomor…" />
          <select v-model="solarWilayah">
            <option value="">Semua Wilayah</option>
            <option v-for="w in solarWilayahOptions" :key="w" :value="w">{{ w }}</option>
          </select>
        </div>
        <div v-if="!keluarModal.length" class="empty">Tidak ada yang cocok.</div>
        <SolarKeluarTable v-else :items="keluarModal" @edit="openSolarEditModal" @hapus="removeSolar" />
      </LainnyaModal>

      <LainnyaModal v-if="showSemua === 'UTANG'" title="Rekap Utang Solar — Semua Sopir" lebar="820px" @close="showSemua = ''">
        <div class="sol-modal-filter"><input v-model="cariSemua" placeholder="Cari nama sopir…" /></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nama Sopir</th>
                <th class="num">Total Dicatat (L)</th>
                <th class="num">Total Real (L)</th>
                <th class="num">Saldo Utang (L)</th>
                <th class="num">Belum Dicek</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in utangModal" :key="r.nama">
                <td>{{ r.nama }}</td>
                <td class="num mono">{{ fmtL(r.totalDicatat) }}</td>
                <td class="num mono">{{ fmtL(r.totalReal) }}</td>
                <td class="num mono" :style="{ color: r.saldo > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }">
                  <template v-if="r.saldo > 0">{{ fmtL(r.saldo) }}</template>
                  <template v-else-if="r.saldo < 0">0 <span style="font-size: 11px; font-weight: 400">(lebih {{ fmtL(Math.abs(r.saldo)) }})</span></template>
                  <template v-else>0 <span style="font-size: 11px; font-weight: 400">(lunas)</span></template>
                </td>
                <td class="num mono">{{ r.belumDicek || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </LainnyaModal>

      <RapikanNamaModal v-if="showRapikan" @close="showRapikan = false" @selesai="loadSolar" />
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
          <NamaCombo
            v-model="solarForm.nama"
            :options="solarNamaOptions"
            :placeholder="solarForm.tipe === 'MASUK' ? 'Pilih / ketik nama sopir' : 'Pilih / ketik nama operator'"
          />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>{{ solarForm.tipe === "MASUK" ? "Jumlah Liter Real yang Masuk" : "Jumlah Liter" }}</label>
          <input v-model.number="solarForm.liter" type="number" min="0" />
        </div>
        <div class="field" v-if="solarForm.tipe === 'MASUK'">
          <label>Catatan Buku Sopir (L, opsional)</label>
          <input v-model="solarForm.literCatatan" type="number" min="0" step="0.1" placeholder="Angka di buku" />
          <div class="desc" style="margin-top: 4px">
            Kalau dikosongkan, bisa diisi belakangan lewat panel Cek Solar Masuk.
          </div>
        </div>
        <div class="field" v-if="solarForm.tipe === 'KELUAR'">
          <label>Wilayah Tujuan</label>
          <WilayahSelect :model-value="solarForm.lokasi" :options="lokasiOpsi" @update:model-value="ubahLokasi" />
          <div v-if="lokasiOtomatisInfo" class="desc" style="margin-top: 4px">{{ lokasiOtomatisInfo }}</div>
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

  <InvoiceDrilldownModal
    v-if="showDrilldown"
    :divisi="divisi"
    :dari="drilldownRange.dari"
    :sampai="drilldownRange.sampai"
    :label="bulanLabel"
    @close="showDrilldown = false"
  />

  <RincianTransaksiModal
    v-if="showRincian"
    :divisi="divisi"
    :kelompok="rincianCtx.kelompok"
    :kelompok-label="rincianCtx.kelompokLabel"
    :kategori="rincianCtx.kategori"
    :sub-kategori="rincianCtx.subKategori"
    :dari="drilldownRange.dari"
    :sampai="drilldownRange.sampai"
    :label="bulanLabel"
    @close="showRincian = false"
  />
</template>

<style scoped>
.sol-periode {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.sol-periode-label {
  font-size: 20px;
  font-weight: 800;
  color: var(--ink);
}
.sol-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.sol-kpi {
  background: var(--card, #fff);
  border: 1px solid var(--line);
  border-left: 4px solid var(--c, #2459a6);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: var(--shadow-sm);
}
.sol-kpi-utama {
  background: var(--bms-blue-soft, #eaf1fb);
}
.sol-kpi-lbl {
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 600;
}
.sol-kpi-val {
  font-size: 24px;
  font-weight: 800;
  margin: 2px 0;
  font-variant-numeric: tabular-nums;
}
.sol-kpi-val small {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}
.sol-kpi-sub {
  font-size: 12px;
  color: var(--ink-soft);
}
.sol-rank {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 24px;
}
.sol-nav {
  display: flex;
  gap: 6px;
  align-items: center;
}
.sol-nav input {
  flex: 1;
  min-width: 0;
}
.sol-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.sol-modal-filter {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.sol-modal-filter input {
  flex: 1;
  min-width: 200px;
}
.sol-modal-filter select {
  max-width: 220px;
}
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