<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import SearchableSelect from "../components/SearchableSelect.vue";

// ---- Penyimpanan lokal: pilihan filter & orientasi tidak hilang saat refresh ----
const FILTER_KEY = "bms.rekapPenjualan.ui";
function readLS(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
function writeLS(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* storage penuh / diblokir -> abaikan */
  }
}
const savedUi = readLS(FILTER_KEY) || {};

const customers = ref([]);
const rows = ref([]);
const summary = ref({ count: 0, jumlah: 0, total: 0 });
const groups = ref([]); // hasil tampilan "Rekap Keseluruhan" (per penerima)
// Tampilan "Rekapan Invoice" (format lembar BMS: per invoice + pembayaran)
const invRows = ref([]); // baris mentah dari server: 1 baris = 1 (invoice x penerima)
const invSummary = ref({ count: 0, totalTagihan: 0, totalDibayar: 0, sisa: 0 });
// Sisa Deposit (opsional, input manual): tampil sebagai baris pertama rekap
const deposit = ref({ aktif: false, tanggal: "", noRef: "", nominal: 0 });
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);

const filter = ref({
  customerId: savedUi.customerId || "",
  customerSearch: "",
  view: savedUi.view || "rincian", // "rincian" (per surat jalan) | "keseluruhan" (total per penerima) | "invoice" (format lembar BMS)
  belumLunas: !!savedUi.belumLunas, // khusus view "invoice": hanya invoice yang masih ada sisa tagihan
  mode: savedUi.mode || "bulan", // "bulan" atau "rentang"
  bulan: savedUi.bulan || new Date().toISOString().slice(0, 7),
  dari: savedUi.dari || "",
  sampai: savedUi.sampai || "",
});

const headerForm = ref({
  pic: "",
  noInvoice: "", // otomatis: BM-<P|O><Inisial> <urut>, mis. BM-PM 385 (bisa diedit)
  tanggal: new Date().toISOString().slice(0, 10),
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
// Nama penerima dinormalisasi (huruf kecil, tanpa titik/spasi) supaya "PT. Alko"
// dan "pt alko" dianggap sama -- dipakai untuk menghilangkan penerima dobel di
// master Customer dan untuk mencocokkan nama penerima pada invoice.
function normNama(n) {
  return String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
const ALL_RECIPIENTS = "__ALL__"; // nilai dropdown "Semua Penerima"
const headerRecipientOptions = computed(() => {
  const seen = new Set();
  const out = [];
  for (const r of selectedCustomer.value?.recipients || []) {
    const k = normNama(r.nama);
    if (seen.has(k)) continue; // buang dobel (nama sama)
    seen.add(k);
    out.push(r);
  }
  return out;
});
// id penerima dobel -> id penerima pertama dengan nama yang sama
function canonicalRecipientId(id) {
  if (!id || id === ALL_RECIPIENTS) return id || "";
  const all = selectedCustomer.value?.recipients || [];
  const r = all.find((x) => x.id === id);
  if (!r) return "";
  return headerRecipientOptions.value.find((x) => normNama(x.nama) === normNama(r.nama))?.id || "";
}

function applyDefaultHeaderTujuan() {
  headerForm.value.recipientId = "";
  if (headerRecipientOptions.value.length) {
    headerForm.value.tujuan = "";
  } else {
    headerForm.value.tujuan = selectedCustomer.value?.alamat || "";
  }
}

function onHeaderRecipientChange() {
  if (headerForm.value.recipientId === ALL_RECIPIENTS) {
    // semua penerima -> alamat customer sendiri (mis. alamat Pak Alexander)
    headerForm.value.tujuan = selectedCustomer.value?.alamat || "";
    return;
  }
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
  if (!customers.value.some((c) => c.id === filter.value.customerId)) {
    filter.value.customerId = customers.value[0]?.id || "";
  }
  if (!form.value.customerId && customers.value.length) form.value.customerId = customers.value[0].id;
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (filter.value.view === "keseluruhan") params.set("view", "keseluruhan");
    if (filter.value.customerId) params.set("customerId", filter.value.customerId);
    if (filter.value.mode === "bulan" && filter.value.bulan) {
      params.set("bulan", filter.value.bulan);
    } else if (filter.value.mode === "rentang") {
      if (filter.value.dari) params.set("from", filter.value.dari);
      if (filter.value.sampai) params.set("to", filter.value.sampai);
    }
    if (filter.value.view === "invoice") {
      params.delete("view");
      if (filter.value.belumLunas) params.set("belumLunas", "1");
      const d = await api.get(`/rekap-penjualan/invoice-rekap?${params.toString()}`);
      invRows.value = d.rows || [];
      invSummary.value = d.summary || { count: 0, totalTagihan: 0, totalDibayar: 0, sisa: 0 };
      return;
    }
    const data = await api.get(`/rekap-penjualan?${params.toString()}`);
    rows.value = data.rows || [];
    groups.value = data.groups || [];
    summary.value = data.summary || { count: 0, jumlah: 0, total: 0 };
  } catch (e) {
    console.error(e);
    toast("Gagal memuat rekap penjualan");
  } finally {
    loading.value = false;
  }
}

// Nomor rekapan otomatis mengikuti format lembar rekap BMS: BM-PM 385
// (P = perusahaan, O = perorangan; huruf berikutnya = inisial nama).
async function suggestNoInvoice() {
  if (!filter.value.customerId) {
    headerForm.value.noInvoice = "";
    return;
  }
  try {
    const r = await api.get(`/rekap-penjualan/next-no?customerId=${filter.value.customerId}`);
    headerForm.value.noInvoice = r.no;
  } catch (e) {
    console.error(e);
  }
}
// Nomor dianggap terpakai saat dicetak / diexport, supaya urutan berikutnya naik.
async function commitNoInvoice() {
  try {
    await api.post("/rekap-penjualan/next-no", { no: headerForm.value.noInvoice });
  } catch (e) {
    console.error(e);
  }
}

// ---------------------------------------------------------------------------
// Draft header (PIC, tujuan, tanggal, no. rekap, sisa deposit) per customer.
// Otomatis tersimpan ke server (+ salinan di browser) tiap ada perubahan, dan
// dimuat lagi saat halaman dibuka / customer dipilih -> refresh tidak menghapus.
// ---------------------------------------------------------------------------
const headerStatus = ref(""); // "" | "Menyimpan..." | "✓ Tersimpan" | "⚠ Gagal menyimpan"
let headerToken = 0;
let lastSavedJson = "";
let pending = null; // { cid, header, timer }

function headerLSKey(cid) {
  return `bms.rekapHeader.${cid}`;
}
function snapshotHeader() {
  return {
    pic: headerForm.value.pic,
    tujuan: headerForm.value.tujuan,
    recipientId: headerForm.value.recipientId,
    tanggal: headerForm.value.tanggal,
    noInvoice: headerForm.value.noInvoice,
    deposit: { ...deposit.value },
  };
}
function comparableJson() {
  return JSON.stringify(snapshotHeader());
}
function applyHeader(h) {
  headerForm.value = {
    pic: h.pic || "",
    noInvoice: h.noInvoice || "",
    tanggal: h.tanggal || new Date().toISOString().slice(0, 10),
    recipientId: canonicalRecipientId(h.recipientId),
    tujuan: h.tujuan || "",
  };
  deposit.value = {
    aktif: !!h.deposit?.aktif,
    tanggal: h.deposit?.tanggal || "",
    noRef: h.deposit?.noRef || "",
    nominal: Number(h.deposit?.nominal) || 0,
  };
}
function resetHeaderDefaults() {
  headerForm.value = { pic: "", noInvoice: "", tanggal: new Date().toISOString().slice(0, 10), recipientId: "", tujuan: "" };
  deposit.value = { aktif: false, tanggal: "", noRef: "", nominal: 0 };
  applyDefaultHeaderTujuan();
}

async function loadHeader() {
  const token = ++headerToken;
  const cid = filter.value.customerId;
  headerStatus.value = "";
  if (!cid) {
    resetHeaderDefaults();
    lastSavedJson = comparableJson();
    return;
  }
  let server = null;
  try {
    server = (await api.get(`/rekap-penjualan/header?customerId=${cid}`)).header;
  } catch (e) {
    console.error(e);
  }
  if (token !== headerToken) return; // customer sudah ganti lagi -> abaikan hasil lama
  const local = readLS(headerLSKey(cid));
  // pakai yang paling baru antara salinan server & salinan browser
  const draft = server && local ? (Number(local.savedAt) > Number(server.savedAt) ? local : server) : server || local;
  if (draft) {
    applyHeader(draft);
    if (!headerForm.value.tujuan) applyDefaultHeaderTujuan();
    if (!headerForm.value.noInvoice) await suggestNoInvoice();
  } else {
    resetHeaderDefaults();
    await suggestNoInvoice();
  }
  if (token !== headerToken) return;
  lastSavedJson = comparableJson(); // hasil muat != perubahan user -> jangan disimpan ulang
}

async function persistHeader(p) {
  headerStatus.value = "Menyimpan...";
  try {
    await api.put("/rekap-penjualan/header", { customerId: p.cid, header: p.header });
    if (!pending) headerStatus.value = "✓ Tersimpan";
  } catch (e) {
    console.error(e);
    headerStatus.value = "⚠ Gagal menyimpan (tersimpan di browser ini)";
  }
}
function flushHeader() {
  if (!pending) return Promise.resolve();
  const p = pending;
  pending = null;
  clearTimeout(p.timer);
  return persistHeader(p);
}
function scheduleHeaderSave() {
  const cid = filter.value.customerId;
  if (!cid) return;
  const json = comparableJson();
  if (json === lastSavedJson) return;
  lastSavedJson = json;
  const header = { ...snapshotHeader(), savedAt: Date.now() };
  writeLS(headerLSKey(cid), header); // instan, jadi aman walau langsung refresh
  if (pending) clearTimeout(pending.timer);
  pending = { cid, header, timer: setTimeout(flushHeader, 500) };
  headerStatus.value = "Menyimpan...";
}

async function newRekap() {
  if (!confirm("Mulai rekap baru? Isian header (PIC, tujuan, tanggal, sisa deposit) dikosongkan dan nomor rekap berikutnya diambil.")) return;
  resetHeaderDefaults();
  await suggestNoInvoice();
  lastSavedJson = "";
  scheduleHeaderSave();
}

// ---- CRUD baris rekap: tambah / edit / hapus ----
const editingId = ref(null);

function openEdit(r) {
  editingId.value = r.id;
  form.value = {
    customerId: r.customerId,
    tanggal: String(r.tanggal).slice(0, 10),
    noSuratJalan: r.noSuratJalan,
    noPolisi: r.noPolisi,
    jenisBarang: r.jenisBarang,
    panjang: r.panjang,
    lebar: r.lebar,
    tinggi: r.tinggi,
    jumlah: r.jumlah,
    harga: r.harga,
    hargaKey: "",
    catatan: r.catatan || "",
  };
  showModal.value = true;
}

function openModal() {
  editingId.value = null;
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
  if (!saving.value) {
    showModal.value = false;
    editingId.value = null;
  }
}

async function submit() {
  if (!form.value.customerId || !form.value.tanggal || !form.value.noSuratJalan || !form.value.noPolisi || !form.value.jenisBarang) {
    return toast("Customer, tanggal, nomor surat jalan, nomor polisi, dan jenis barang wajib diisi");
  }

  saving.value = true;
  try {
    const payload = { ...form.value };
    if (!Number(payload.jumlah)) payload.jumlah = hitungVolume();
    delete payload.hargaKey;
    if (editingId.value) {
      await api.put(`/rekap-penjualan/${editingId.value}`, payload);
      toast("Data rekap berhasil diperbarui");
    } else {
      await api.post("/rekap-penjualan", payload);
      toast("Data rekap berhasil ditambahkan");
    }
    showModal.value = false;
    editingId.value = null;
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

async function printReport() {
  applyPrintOrientation();
  await commitNoInvoice();
  window.print();
}

// ---- Tampilan "Rekapan Invoice" (persis lembar BMS) ----
const BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function tglSingkat(v) {
  if (!v) return "";
  const d = new Date(v);
  return `${String(d.getDate()).padStart(2, "0")}-${BULAN_SINGKAT[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}
function tglPanjang(v) {
  return new Date(v).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}
function labelBayar(p) {
  return `${p.metode ? p.metode + " " : ""}${tglPanjang(p.tanggal)}`;
}
function angka(n) {
  return Math.round(Number(n) || 0).toLocaleString("id-ID");
}
const depositNominal = computed(() => (deposit.value.aktif ? Number(deposit.value.nominal) || 0 : 0));
// Pilihan "Pilih Penerima" di header menentukan isi Rekapan Invoice:
//  - belum dipilih          : 1 baris per invoice (customer tanpa banyak penerima)
//  - "Semua Penerima"       : 1 baris per PT, berisi total seluruh invoice PT itu
//  - satu PT tertentu       : invoice PT itu saja (persis lembar rekap satu customer)
const penerimaMode = computed(() => {
  const id = headerForm.value.recipientId;
  if (id === ALL_RECIPIENTS) return { mode: "total" };
  const r = id ? headerRecipientOptions.value.find((x) => x.id === id) : null;
  return r ? { mode: "pt", nama: r.nama, key: normNama(r.nama) } : { mode: "all" };
});
// nama tampil = nama di master Penerima (kalau cocok), supaya konsisten & tanpa dobel
const namaMaster = computed(() => {
  const m = new Map();
  for (const r of headerRecipientOptions.value) m.set(normNama(r.nama), r.nama);
  return m;
});
const invFiltered = computed(() => {
  const pm = penerimaMode.value;
  const list = pm.mode === "pt" ? invRows.value.filter((r) => normNama(r.penerima) === pm.key) : invRows.value;
  return list.map((r) => {
    const nama = namaMaster.value.get(normNama(r.penerima)) || r.penerima;
    return { ...r, penerima: nama, customer: nama };
  });
});
function noPendek(no) {
  return String(no || "").replace(/^BMS-INV-/, "");
}
const displayRows = computed(() => {
  if (penerimaMode.value.mode !== "total") return invFiltered.value;
  const m = new Map();
  for (const r of invFiltered.value) {
    const k = normNama(r.penerima);
    const g = m.get(k) || { key: "g|" + k, penerima: r.penerima, customer: r.penerima, tanggal: r.tanggal, nos: [], total: 0, dibayar: 0, pembayaran: [] };
    if (new Date(r.tanggal) > new Date(g.tanggal)) g.tanggal = r.tanggal;
    g.nos.push(noPendek(r.no));
    g.total += r.total;
    g.dibayar += r.dibayar;
    g.pembayaran.push(...r.pembayaran);
    m.set(k, g);
  }
  return [...m.values()]
    .sort((a, b) => a.penerima.localeCompare(b.penerima))
    .map((g) => ({
      ...g,
      no: [...new Set(g.nos)].join(", "),
      pembayaran: [...g.pembayaran].sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal)),
    }));
});
const jumlahInvoice = computed(() => new Set(invFiltered.value.map((r) => r.id)).size);
// Nama pada baris "Rekapan Invoice" di kop cetak: PT terpilih, atau customer-nya
const rekapNama = computed(() => (penerimaMode.value.mode === "pt" ? penerimaMode.value.nama : selectedCustomer.value?.nama || "-"));
const invTotalTagihan = computed(() => displayRows.value.reduce((s, r) => s + r.total, 0));
const invTotalBayar = computed(() => displayRows.value.reduce((s, r) => s + r.dibayar, 0) + depositNominal.value);
const invSisa = computed(() => invTotalTagihan.value - invTotalBayar.value);
// baris kosong pengisi supaya tabel cetak terlihat penuh seperti lembar aslinya
const fillerRows = computed(() => {
  const used = displayRows.value.length + (deposit.value.aktif ? 1 : 0);
  return Math.max(0, 15 - used);
});
// Saat Sisa Deposit dicentang, no. referensi default = nomor rekap sebelumnya
// (BM-PM 385 -> BM-PM 384), tanggal default = hari ini. Keduanya bisa diedit.
watch(() => deposit.value.aktif, (on) => {
  if (!on) return;
  if (!deposit.value.tanggal) deposit.value.tanggal = new Date().toISOString().slice(0, 10);
  if (!deposit.value.noRef) {
    const m = String(headerForm.value.noInvoice || "").match(/^(BM-[A-Z]{2})\s+(\d+)$/i);
    if (m && Number(m[2]) > 1) deposit.value.noRef = `${m[1].toUpperCase()} ${Number(m[2]) - 1}`;
  }
});

const tanggalCetak = computed(() =>
  new Date(headerForm.value.tanggal || Date.now()).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
);

// Orientasi kertas cetak Rekap Penjualan (Landscape/Portrait) -- karena
// window.print() browser dikontrol dari @page CSS, orientasinya diterapkan
// dengan menyuntik <style> baru ke <head> tepat sebelum print supaya
// override aturan default di bawah (selalu ditaruh paling akhir).
const printOrientation = ref(savedUi.printOrientation || "landscape"); // "landscape" | "portrait"
function applyPrintOrientation() {
  const old = document.getElementById("rekap-penjualan-print-orientation");
  if (old) old.remove();
  const styleTag = document.createElement("style");
  styleTag.id = "rekap-penjualan-print-orientation";
  styleTag.textContent = `@media print { @page { size: A4 ${printOrientation.value}; margin: 9mm; } }`;
  document.head.appendChild(styleTag);
}

async function exportExcel() {
  if (filter.value.view === "invoice") {
    if (!displayRows.value.length) return toast("Tidak ada data untuk diexport");
    const XLSXi = await import("xlsx");
    await commitNoInvoice();
    const out = [];
    if (deposit.value.aktif) {
      out.push({ No: "", Tanggal: tglSingkat(deposit.value.tanggal), "No.Invoice": deposit.value.noRef, Customer: "Sisa Deposit", "Jumlah Tagihan": "", "Tanggal Pembayaran": "", "Jumlah Pembayaran": depositNominal.value });
    }
    displayRows.value.forEach((r, i) => {
      out.push({
        No: i + 1,
        Tanggal: tglSingkat(r.tanggal),
        "No.Invoice": r.no,
        Customer: r.customer,
        "Jumlah Tagihan": r.total,
        "Tanggal Pembayaran": r.pembayaran.map(labelBayar).join("; "),
        "Jumlah Pembayaran": r.dibayar || "",
      });
    });
    out.push({ No: "", Tanggal: "", "No.Invoice": "", Customer: "TOTAL TAGIHAN", "Jumlah Tagihan": invTotalTagihan.value, "Tanggal Pembayaran": "", "Jumlah Pembayaran": invTotalBayar.value });
    out.push({ No: "", Tanggal: "", "No.Invoice": "", Customer: "SISA TAGIHAN", "Jumlah Tagihan": invSisa.value, "Tanggal Pembayaran": "", "Jumlah Pembayaran": "" });
    const wsi = XLSXi.utils.json_to_sheet(out);
    const wbi = XLSXi.utils.book_new();
    XLSXi.utils.book_append_sheet(wbi, wsi, "Rekapan Invoice");
    const nm = selectedCustomer.value?.nama?.replace(/[^a-z0-9]+/gi, "-") || "semua-customer";
    XLSXi.writeFile(wbi, `${(headerForm.value.noInvoice || "rekapan-invoice").replace(/\s+/g, "-")}-${nm}.xlsx`);
    return;
  }
  if (!rows.value.length) {
    return toast("Tidak ada data untuk diexport");
  }
  const XLSX = await import("xlsx");
  if (filter.value.view === "keseluruhan") {
    await commitNoInvoice();
    const dataK = groups.value.map((g, i) => ({
      No: i + 1,
      Customer: g.penerima,
      "Jumlah SJ": g.count,
      "Total Volume": g.jumlah,
      "Jumlah Tagihan": g.total,
    }));
    dataK.push({ No: "", Customer: "TOTAL", "Jumlah SJ": summary.value.count, "Total Volume": summary.value.jumlah, "Jumlah Tagihan": summary.value.total });
    const wsK = XLSX.utils.json_to_sheet(dataK);
    const wbK = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbK, wsK, "Rekap Keseluruhan");
    const nmK = selectedCustomer.value?.nama?.replace(/[^a-z0-9]+/gi, "-") || "semua-customer";
    const lbK = filter.value.mode === "bulan" ? filter.value.bulan : `${filter.value.dari || "awal"}_${filter.value.sampai || "akhir"}`;
    XLSX.writeFile(wbK, `${(headerForm.value.noInvoice || "rekap").replace(/\s+/g, "-")}-${nmK}-${lbK}.xlsx`);
    return;
  }
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
    () => filter.value.view,
    () => filter.value.belumLunas,
  ],
  load
);
watch(
  () => filter.value.customerId,
  async () => {
    await flushHeader(); // simpan dulu draft customer sebelumnya
    await loadHeader();
  }
);
// autosave draft header
watch([headerForm, deposit], scheduleHeaderSave, { deep: true });
// simpan pilihan filter di browser
watch(
  [filter, printOrientation],
  () => {
    const f = filter.value;
    writeLS(FILTER_KEY, {
      customerId: f.customerId,
      view: f.view,
      belumLunas: f.belumLunas,
      mode: f.mode,
      bulan: f.bulan,
      dari: f.dari,
      sampai: f.sampai,
      printOrientation: printOrientation.value,
    });
  },
  { deep: true }
);
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
    await loadHeader();
  } catch (e) {
    toast("Gagal memuat master customer");
  }
});

onBeforeUnmount(() => {
  flushHeader();
});
</script>

<template>
  <div class="topbar no-print">
    <div>
      <h1>Rekap Penjualan</h1>
      <div class="desc">Rekap tagihan customer dengan format tabel seperti lembar rekap BMS.</div>
    </div>
    <div class="top-actions">
      <div class="field orientasi-field">
        <label>Orientasi Cetak</label>
        <select v-model="printOrientation">
          <option value="landscape">Horizontal (Landscape)</option>
          <option value="portrait">Vertikal (Portrait)</option>
        </select>
      </div>
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
          <SearchableSelect
            v-model="filter.customerId"
            :options="filteredCustomerOptions.map(c => ({ value: c.id, label: `${c.kode} — ${c.nama}` }))"
            placeholder="Semua Customer"
          />
        </div>
        <div class="field">
          <label>Tampilan</label>
          <select v-model="filter.view">
            <option value="rincian">Rincian per Surat Jalan</option>
            <option value="keseluruhan">Rekap Keseluruhan (total per penerima)</option>
            <option value="invoice">Rekapan Invoice (format lembar BMS + pembayaran)</option>
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
        <div class="field"><label>No. Invoice Rekapan <span class="opt">(otomatis, bisa diedit)</span></label><input v-model="headerForm.noInvoice" placeholder="BM-PM 385" /></div>
        <div class="field"><label>Tanggal</label><input v-model="headerForm.tanggal" type="date" /></div>
        <div class="field"><label>PIC / Kepada</label><input v-model="headerForm.pic" placeholder="Contoh: Bp. Ali" /></div>
      </div>
      <div v-if="filter.view === 'invoice'" class="deposit-box">
        <label class="chk"><input v-model="filter.belumLunas" type="checkbox" /> Hanya invoice yang belum lunas</label>
        <label class="chk"><input v-model="deposit.aktif" type="checkbox" /> Ada Sisa Deposit <span class="opt">(input manual, jadi baris pertama rekap)</span></label>
        <div v-if="deposit.aktif" class="row">
          <div class="field"><label>Tanggal Deposit</label><input v-model="deposit.tanggal" type="date" /></div>
          <div class="field"><label>No. Rekap Sebelumnya</label><input v-model="deposit.noRef" placeholder="BM-PM 384" /></div>
          <div class="field"><label>Nominal Sisa Deposit</label><input v-model.number="deposit.nominal" type="number" min="0" /></div>
        </div>
      </div>
      <div class="row" v-if="headerRecipientOptions.length">
        <div class="field">
          <label>Pilih Penerima <span class="opt">(customer ini punya {{ headerRecipientOptions.length }} tujuan)</span></label>
          <select v-model="headerForm.recipientId" @change="onHeaderRecipientChange">
            <option value="" disabled>Pilih penerima...</option>
            <option value="__ALL__">★ Semua Penerima (rekap total per PT)</option>
            <option v-for="r in headerRecipientOptions" :key="r.id" :value="r.id">{{ r.nama }}</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Tujuan</label><input v-model="headerForm.tujuan" placeholder="Alamat / tujuan tagihan" /></div>
      <div class="draft-bar">
        <span class="draft-status">{{ headerStatus || "Isian header tersimpan otomatis per customer" }}</span>
        <button class="btn btn-sm btn-ghost" @click="newRekap">↺ Rekap Baru</button>
      </div>
    </div>

    <div v-if="filter.view === 'invoice'" class="rekap-summary grid g3">
      <div class="stat"><div class="lbl">JUMLAH INVOICE</div><div class="val">{{ jumlahInvoice }}</div></div>
      <div class="stat"><div class="lbl">TOTAL TAGIHAN</div><div class="val">{{ rupiah(invTotalTagihan) }}</div></div>
      <div class="stat"><div class="lbl">SISA TAGIHAN</div><div class="val">{{ rupiah(invSisa) }}</div></div>
    </div>
    <div v-else class="rekap-summary grid g3">
      <div class="stat"><div class="lbl">JUMLAH BARIS</div><div class="val">{{ summary.count }}</div></div>
      <div class="stat"><div class="lbl">TOTAL VOLUME</div><div class="val">{{ Number(summary.jumlah || 0).toLocaleString("id-ID") }}</div></div>
      <div class="stat"><div class="lbl">TOTAL TAGIHAN</div><div class="val">{{ rupiah(summary.total) }}</div></div>
    </div>

    <div class="card">
      <div v-if="loading" class="empty">Memuat rekap...</div>
      <div v-else-if="filter.view === 'invoice' ? !displayRows.length : !rows.length" class="empty">
        <div class="big">🧾</div>
        <strong>Belum ada data rekap</strong>
        <div class="empty-desc">Tambahkan baris dari surat jalan yang sudah selesai untuk membentuk rekap tagihan customer.</div>
        <button class="btn btn-primary" style="margin-top:14px" @click="openModal">＋ Tambah Baris</button>
      </div>
      <div v-else-if="filter.view === 'invoice'" class="table-wrap rekap-table-wrap">
        <table class="rekap-table">
          <thead>
            <tr><th>No</th><th>Tanggal</th><th>No. Invoice</th><th>Customer</th><th class="num">Jumlah Tagihan</th><th>Tanggal Pembayaran</th><th class="num">Jumlah Pembayaran</th></tr>
          </thead>
          <tbody>
            <tr v-if="deposit.aktif">
              <td></td><td>{{ tglSingkat(deposit.tanggal) }}</td><td class="mono">{{ deposit.noRef }}</td><td><i>Sisa Deposit</i></td><td></td><td></td><td class="num">{{ angka(depositNominal) }}</td>
            </tr>
            <tr v-for="(r, idx) in displayRows" :key="r.key">
              <td>{{ idx + 1 }}</td><td>{{ tglSingkat(r.tanggal) }}</td><td class="mono">{{ r.no }}</td><td>{{ r.customer }}</td>
              <td class="num">{{ angka(r.total) }}</td>
              <td><div v-for="(p, pi) in r.pembayaran" :key="pi">{{ labelBayar(p) }}</div></td>
              <td class="num"><div v-for="(p, pi) in r.pembayaran" :key="pi">{{ angka(p.nominal) }}</div></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4"><b>TOTAL TAGIHAN</b></td>
              <td class="num"><b>{{ angka(invTotalTagihan) }}</b></td><td></td>
              <td class="num"><b>{{ angka(invTotalBayar) }}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div v-else-if="filter.view === 'keseluruhan'" class="table-wrap rekap-table-wrap">
        <table class="rekap-table">
          <thead>
            <tr><th>No</th><th>Customer / Penerima</th><th class="num">Jumlah SJ</th><th class="num">Total Volume</th><th class="num">Jumlah Tagihan</th></tr>
          </thead>
          <tbody>
            <tr v-for="(g, idx) in groups" :key="g.penerima">
              <td>{{ idx + 1 }}</td>
              <td>{{ g.penerima }}</td>
              <td class="num">{{ g.count }}</td>
              <td class="num">{{ Number(g.jumlah).toLocaleString("id-ID") }}</td>
              <td class="num">{{ Math.round(g.total).toLocaleString("id-ID") }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><b>TOTAL</b></td>
              <td class="num"><b>{{ summary.count }}</b></td>
              <td class="num"><b>{{ Number(summary.jumlah || 0).toLocaleString("id-ID") }}</b></td>
              <td class="num"><b>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</b></td>
            </tr>
          </tfoot>
        </table>
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
              <td class="no-print aksi"><button class="btn btn-sm btn-ghost" @click="openEdit(r)">Edit</button> <button class="btn btn-sm btn-danger" @click="removeRow(r.id)">Hapus</button></td>
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
          <div class="company-address">Head Office : Jl. Cilincing Baru Pangkalan Pasir No. 38 Cilincing Jakarta Utara<br />Phone : (021) 4494 0288 - 440 5323 &nbsp; Fax : (021) 440 5323</div>
        </div>
      </div>

      <div v-if="filter.view === 'invoice'" class="print-meta print-meta-inv">
        <div><span>Rekapan Invoice</span><strong>: {{ rekapNama }}</strong></div>
        <div><span>No. Invoice</span><strong>: {{ headerForm.noInvoice || "-" }}</strong></div>
        <div><span>Tanggal</span><strong>: {{ tanggalCetak }}</strong></div>
        <div><span>Alamat</span><strong>: {{ headerForm.tujuan || selectedCustomer?.alamat || "-" }}</strong></div>
      </div>
      <div v-else class="print-meta">
        <div><span>Rekapan Invoice</span><strong>{{ selectedCustomer?.nama || "-" }}</strong></div>
        <div><span>Kepada</span><strong>{{ headerForm.pic || "-" }}</strong></div>
        <div><span>No. Invoice</span><strong>{{ headerForm.noInvoice || "-" }}</strong></div>
        <div><span>Tanggal</span><strong>{{ tanggalCetak }}</strong></div>
        <div><span>Alamat</span><strong>{{ headerForm.tujuan || selectedCustomer?.alamat || "-" }}</strong></div>
      </div>

      <table v-if="filter.view === 'invoice'" class="print-table print-table-inv">
        <thead>
          <tr><th>No.</th><th>Tanggal</th><th>No.Invoice</th><th>Customer</th><th>Jumlah<br />Tagihan</th><th>Tanggal<br />Pembayaran</th><th>Jumlah<br />Pembayaran</th></tr>
        </thead>
        <tbody>
          <tr v-if="deposit.aktif">
            <td></td><td>{{ tglSingkat(deposit.tanggal) }}</td><td>{{ deposit.noRef }}</td><td>Sisa Deposit</td><td></td><td></td><td class="num">{{ angka(depositNominal) }}</td>
          </tr>
          <tr v-for="(r, idx) in displayRows" :key="r.key">
            <td>{{ idx + 1 }}</td><td>{{ tglSingkat(r.tanggal) }}</td><td>{{ r.no }}</td><td class="left">{{ r.customer }}</td>
            <td class="num">{{ angka(r.total) }}</td>
            <td><div v-for="(p, pi) in r.pembayaran" :key="pi">{{ labelBayar(p) }}</div></td>
            <td class="num"><div v-for="(p, pi) in r.pembayaran" :key="pi">{{ angka(p.nominal) }}</div></td>
          </tr>
          <tr v-for="n in fillerRows" :key="'f' + n" class="filler"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        </tbody>
        <tfoot>
          <tr><td colspan="4" class="total-label">TOTAL TAGIHAN</td><td class="num">{{ angka(invTotalTagihan) }}</td><td></td><td class="num">{{ angka(invTotalBayar) }}</td></tr>
        </tfoot>
      </table>

      <table v-else-if="filter.view === 'keseluruhan'" class="print-table print-table-k">
        <thead>
          <tr><th>No</th><th>Tanggal</th><th>Customer</th><th>Jumlah SJ</th><th>Total Volume</th><th>Jumlah Tagihan</th></tr>
        </thead>
        <tbody>
          <tr v-for="(g, idx) in groups" :key="g.penerima">
            <td>{{ idx + 1 }}</td><td>{{ formatTanggal(g.tanggalTerakhir) }}</td><td class="left">{{ g.penerima }}</td>
            <td>{{ g.count }}</td><td>{{ Number(g.jumlah).toLocaleString("id-ID") }}</td><td>{{ Math.round(g.total).toLocaleString("id-ID") }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td colspan="3" class="total-label">TOTAL TAGIHAN</td><td>{{ summary.count }}</td><td>{{ Number(summary.jumlah || 0).toLocaleString("id-ID") }}</td><td>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</td></tr>
        </tfoot>
      </table>

      <table v-else class="print-table">
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

      <div v-if="filter.view === 'invoice'" class="print-total-box print-total-inv">
        <div><span>Jumlah Tagihan</span><strong>{{ angka(invTotalTagihan) }}</strong></div>
        <div><span>Pembayaran</span><strong>{{ angka(invTotalBayar) }}</strong></div>
        <div><span>Sisa Tagihan</span><strong>{{ angka(invSisa) }}</strong></div>
      </div>
      <div v-else class="print-total-box">
        <div><span>Jumlah Tagihan</span><strong>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</strong></div>
        <div><span>Total Bayar</span><strong>-</strong></div>
        <div><span>Total Tagihan</span><strong>{{ Math.round(summary.total || 0).toLocaleString("id-ID") }}</strong></div>
      </div>

      <template v-if="filter.view === 'invoice'">
        <div class="print-footer-date">Hormat Kami</div>
        <div class="signature"><strong>Syamsul Syamsudin.H</strong><span>Manager Operasional</span></div>
      </template>
      <template v-else>
        <div class="print-footer-date">Jakarta, {{ tanggalCetak }}</div>
        <div class="signature"><strong>Syamsul Syamsudin Hasan</strong><span>Direktur</span></div>
      </template>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal rekap-modal">
      <button class="modal-close" @click="closeModal">×</button>
      <h2>{{ editingId ? "Edit Data Rekap" : "Tambah Data Rekap" }}</h2>
      <div class="msub">Masukkan satu baris transaksi. Total dihitung otomatis dari jumlah × harga.</div>

      <div class="row">
        <div class="field"><label>Customer</label><SearchableSelect v-model="form.customerId" :options="customers.map(c => ({ value: c.id, label: `${c.kode} — ${c.nama}` }))" placeholder="Pilih customer" /></div>
        <div class="field"><label>Tanggal</label><input v-model="form.tanggal" type="date" /></div>
      </div>
      <div class="row">
        <div class="field"><label>No Surat Jalan</label><input v-model="form.noSuratJalan" placeholder="Contoh: 00345" /></div>
        <div class="field"><label>No Polisi</label><input v-model="form.noPolisi" placeholder="B 9086 UYY" /></div>
      </div>
      <div class="field">
        <label>Pilih Harga Customer (opsional)</label>
        <SearchableSelect
          v-model="form.hargaKey"
          @change="applyPrice"
          :options="priceOptions.map(p => ({ value: `${p.destinationCode}|${p.stockCode}`, label: `${p.destinationCode} / ${p.stockCode} — ${p.stockName}`, sub: rupiah(p.hargaM3) }))"
          placeholder="-- Pilih master harga --"
        />
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
        <button class="btn btn-primary" :disabled="saving" @click="submit">{{ saving ? "Menyimpan..." : editingId ? "Simpan Perubahan" : "Simpan Baris" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top-actions { display:flex; gap:8px; align-items:flex-end; }
.orientasi-field { min-width:170px; margin-bottom:0; }
.orientasi-field select { height:38px; }
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
.draft-bar { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:8px; }
.draft-status { font-size:11px; color:var(--ink-soft); }
.aksi { white-space:nowrap; }
.deposit-box { margin:4px 0 10px; padding:10px 12px; border-radius:8px; background:var(--bms-blue-soft); }
.chk { display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:6px; cursor:pointer; }
.chk input { width:auto; }

@media (max-width:700px) {
  .top-actions { flex-direction:column; align-items:stretch; }
  .top-actions .btn { width:100%; justify-content:center; }
  .orientasi-field { width:100%; }
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
  .print-table-k td:nth-child(5) { text-align:center; }
  .print-table-k td.left { text-align:left; }
  .print-meta.print-meta-inv { grid-template-columns:110px 1fr; }
  .print-table.print-table-inv td.left { text-align:left; }
  .print-table.print-table-inv td.num { text-align:right; }
  .print-table.print-table-inv td { height:15px; }
  .print-table.print-table-inv td:nth-child(6) { text-align:left; }
  .print-table-inv tfoot td { background:#f3f3f3; }
  .print-total-inv div { text-align:center; }
  .print-total-inv strong { text-align:right; }
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