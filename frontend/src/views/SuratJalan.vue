<script setup>
import ScanDokumen from "../components/ScanDokumen.vue";
import { ref, onMounted, computed, watch, nextTick } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printSJ } from "../services/print.js";
import SearchableSelect from "../components/SearchableSelect.vue";
import MoneyInput from "../components/MoneyInput.vue";
import { fmtM3 } from "../utils/format.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const armadaList = ref([]);
const sopirList = ref([]); // master Sopir (aktif) -- dropdown + auto-isi komisi default
const customers = ref([]);
const stockMasterList = ref([]);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);
const selectedIds = ref([]); // buat pilih beberapa SJ sekaligus (cetak/export gabungan)
const editingId = ref(null);
const applyToBatch = ref(true); // default: sinkron ke semua SJ dalam grup yang sama
const editingBatchMateCount = ref(0);

// ---- search daftar Surat Jalan (cari No / Penerima / Customer / Tujuan / No.Polisi) ----
// Hit ke backend (bukan cuma filter di browser) supaya tetap enak dipakai
// walau datanya sudah banyak. Di-debounce biar ga nembak API tiap ketik 1 huruf.
const searchQuery = ref("");
let searchDebounce = null;
function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => reloadList(), 350);
}

// ---- search customer di form Buat/Edit Surat Jalan ----
// Dropdown customer biasa (<select>) susah dicari kalau customernya banyak,
// jadi dibuat combobox simple: ketik buat filter, klik buat pilih.
const customerSearch = ref("");
const showCustomerOptions = ref(false);
const filteredCustomers = computed(() => {
  const q = customerSearch.value.trim().toLowerCase();
  if (!q) return customers.value;
  return customers.value.filter(
    (c) =>
      c.nama?.toLowerCase().includes(q) ||
      c.kode?.toLowerCase().includes(q) ||
      c.alamat?.toLowerCase().includes(q)
  );
});
function pickCustomer(c) {
  form.value.customerId = c.id;
  customerSearch.value = `${c.kode} — ${c.nama}`;
  showCustomerOptions.value = false;
  onCustomerChange();
}
function clearCustomerPick() {
  form.value.customerId = "";
  customerSearch.value = "";
  onCustomerChange();
}

const emptyForm = () => ({
  divisi: DIVISI[0],
  customerId: "",
  recipientId: "",
  penerima: "",
  tujuan: "",
  armadaId: "",
  jenisBarang: "",
  noPolisi: "",
  sopir: "",
  sopirId: "",
  belanjaPasir: 0,
  uangMobil: 0,
  uangJalan: 0,
  uangKomisi: 0,
  panjang: 0,
  lebar: 0,
  tinggi: 0,
  tanggal: new Date().toISOString().slice(0, 10),
  jam: new Date().toTimeString().slice(0, 5),
  jumlahSuratJalan: 1,
  isDraft: true,
});

const form = ref(emptyForm());

// ---- Komisi sopir otomatis ----
// Cold Diesel : komisi = Uang Jalan - dasar uang jalan (default 160.000, bisa
//               diubah di menu Pengaturan). Mis. 185.000 - 160.000 = 25.000.
// Tronton     : komisi flat dari master Sopir (default 50.000).
// Komisi tetap bisa diedit manual; begitu diedit, perhitungan otomatis
// berhenti sampai tombol "Hitung otomatis" ditekan.
const uangJalanDasar = ref(160000);
const komisiManual = ref(false);

const sopirDipilih = computed(() => sopirList.value.find((x) => x.id === form.value.sopirId) || null);

const komisiAuto = computed(() => {
  const s = sopirDipilih.value;
  if (s?.tipe === "TRONTON") {
    const flat = Number(s.komisiDefault) || 50000;
    return { nilai: flat, teks: `Tronton: komisi flat ${rupiah(flat)}` };
  }
  const uj = Number(form.value.uangJalan) || 0;
  if (uj <= 0) return null;
  const dasar = uangJalanDasar.value;
  const nilai = Math.max(uj - dasar, 0);
  return {
    nilai,
    teks:
      uj > dasar
        ? `Uang jalan ${rupiah(uj)} − ${rupiah(dasar)} = komisi ${rupiah(nilai)}`
        : `Uang jalan ${rupiah(uj)} tidak melebihi dasar ${rupiah(dasar)}, komisi ${rupiah(0)}`,
  };
});

watch([() => form.value.uangJalan, () => form.value.sopirId, uangJalanDasar], () => {
  if (komisiManual.value || !komisiAuto.value) return;
  form.value.uangKomisi = komisiAuto.value.nilai;
});

function onKomisiEdit(v) {
  form.value.uangKomisi = v;
  komisiManual.value = true;
}

function hitungKomisiOtomatis() {
  komisiManual.value = false;
  if (komisiAuto.value) form.value.uangKomisi = komisiAuto.value.nilai;
}

const jumlahDraft = computed(() => list.value.filter((item) => item.isDraft).length);
const jumlahTTD = computed(
  () => list.value.filter((item) => item.statusTTD === "LENGKAP").length
);

// "Penerima" & "Tujuan" mengikuti daftar Penerima milik Customer (menu
// Customer > Penerima), sesuai format kertas fisik. Kalau customer belum
// punya daftar Penerima, dianggap penerima tunggal = nama & alamat
// customer itu sendiri. Setelah dipilih dari dropdown, kedua kolom ini
// tetap bisa diketik ulang / diedit manual kalau ada perbedaan di lapangan.
const formCustomer = computed(() => customers.value.find((c) => c.id === form.value.customerId));
const recipientOptions = computed(() => formCustomer.value?.recipients || []);

function onCustomerChange() {
  form.value.recipientId = "";
  if (recipientOptions.value.length) {
    // Customer distributor dengan banyak penerima - biarkan dipilih dulu.
    form.value.penerima = "";
    form.value.tujuan = "";
  } else {
    // Customer biasa - penerima = customer itu sendiri.
    form.value.penerima = formCustomer.value?.nama || "";
    form.value.tujuan = formCustomer.value?.alamat || "";
  }
}

function onRecipientChange() {
  const r = recipientOptions.value.find((x) => x.id === form.value.recipientId);
  if (r) { form.value.penerima = r.nama; form.value.tujuan = r.alamat; }
}
function onTujuanChange() {
  const r = recipientOptions.value.find((x) => x.alamat === form.value.tujuan && x.nama === form.value.penerima) || recipientOptions.value.find((x) => x.alamat === form.value.tujuan);
  if (r) { form.value.recipientId = r.id; form.value.penerima = r.nama; }
}

const m3Preview = computed(() => {
  const p = Number(form.value.panjang || 0);
  const l = Number(form.value.lebar || 0);
  const t = Number(form.value.tinggi || 0);
  return Math.round(p * l * t * 1000) / 1000;
});

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

// Ambil ulang daftar Surat Jalan saja (dipakai waktu ngetik di kolom
// search), tanpa nge-fetch ulang armada/customer/stock yang jarang berubah.
async function reloadList() {
  loading.value = true;
  try {
    const q = searchQuery.value.trim();
    list.value = await api.get(`/surat-jalan${q ? `?search=${encodeURIComponent(q)}` : ""}`);
  } catch (error) {
    console.error(error);
    toast("Gagal memuat data surat jalan");
  } finally {
    loading.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const q = searchQuery.value.trim();
    const [suratJalanData, armadaData, customerData, stockData, sopirData, settingData] = await Promise.all([
      api.get(`/surat-jalan${q ? `?search=${encodeURIComponent(q)}` : ""}`),
      api.get("/armada"),
      api.get("/customers"),
      api.get("/stock-master"),
      api.get("/sopir?all=1&terakhir=1"),
      api.get("/settings").catch(() => ({})),
    ]);
    const dasar = Number(settingData?.uangJalanDasar);
    if (Number.isFinite(dasar) && dasar >= 0 && settingData?.uangJalanDasar !== "") uangJalanDasar.value = dasar;
    list.value = suratJalanData;
    armadaList.value = armadaData;
    customers.value = customerData;
    stockMasterList.value = stockData;
    sopirList.value = sopirData;
  } catch (error) {
    console.error(error);
    toast("Gagal memuat data surat jalan");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  editingId.value = null;
  autoKendaraan.value = { nopol: "", armadaId: "" };
  komisiManual.value = false;
  form.value = emptyForm();
  customerSearch.value = "";
  showModal.value = true;
}

function openEdit(sj) {
  editingId.value = sj.id;
  autoKendaraan.value = { nopol: "", armadaId: "" }; // data tersimpan tidak boleh ditimpa otomatis
  komisiManual.value = true; // tahan perhitungan otomatis selama form diisi ulang
  customerSearch.value = sj.customer ? `${sj.customer.kode} — ${sj.customer.nama}` : "";
  // Hitung berapa SJ lain yang satu batch (dibuat bareng lewat "Jumlah
  // Surat Jalan" > 1), buat tampilin opsi "terapkan ke semua".
  editingBatchMateCount.value = sj.batchId
    ? list.value.filter((x) => x.batchId === sj.batchId && x.id !== sj.id).length
    : 0;
  applyToBatch.value = true;
  form.value = {
    divisi: sj.divisi,
    customerId: sj.customerId || "",
    recipientId: "",
    penerima: sj.penerima || "",
    tujuan: sj.tujuan || "",
    armadaId: sj.armadaId || "",
    jenisBarang: sj.jenisBarang || "",
    noPolisi: sj.noPolisi || "",
    sopir: sj.sopir || "",
    sopirId: sj.sopirId || "",
    belanjaPasir: sj.belanjaPasir || 0,
    uangMobil: sj.uangMobil || 0,
    uangJalan: sj.uangJalan || 0,
    uangKomisi: sj.uangKomisi || 0,
    panjang: sj.panjang || 0,
    lebar: sj.lebar || 0,
    tinggi: sj.tinggi || 0,
    tanggal: sj.tanggal ? new Date(sj.tanggal).toISOString().slice(0, 10) : "",
    jam: sj.jam || "",
    jumlahSuratJalan: 1,
    isDraft: !!sj.isDraft,
  };
  // Komisi tersimpan yang BEDA dari hitungan otomatis dianggap diubah manual,
  // jangan ditimpa. Kalau sama, perhitungan otomatis aktif lagi.
  nextTick(() => {
    komisiManual.value = komisiAuto.value ? Number(form.value.uangKomisi) !== komisiAuto.value.nilai : false;
  });
  showModal.value = true;
}

function closeModal() {
  if (saving.value) return;
  showModal.value = false;
}

function formatTanggal(tanggal) {
  if (!tanggal) return "-";
  return new Date(tanggal).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function statusText(sj) {
  if (sj.isDraft) return "Draft";
  if (sj.statusTTD === "LENGKAP") return "TTD Lengkap";
  return "Belum TTD";
}

function statusClass(sj) {
  if (sj.isDraft) return "b-draft";
  if (sj.statusTTD === "LENGKAP") return "b-ttd";
  return "b-belumttd";
}

// --- Auto-isi No. Polisi dari Sopir -------------------------------------
// Nilai yang terakhir diisi OTOMATIS dicatat di sini. Selama kolom No. Polisi
// masih kosong atau masih sama dengan nilai otomatis itu, ganti sopir/armada
// boleh menggantinya lagi. Begitu staf mengetik/mengubahnya sendiri, nilainya
// tidak pernah ditimpa lagi.
const autoKendaraan = ref({ nopol: "", armadaId: "" });
const normNopol = (s) => (s || "").toString().toUpperCase().replace(/\s+/g, "");

// Kendaraan untuk sopir tertentu, urutan sumber data:
// 1) kendaraan yang di menu Armada memakai sopir ini (kalau lebih dari satu,
//    pilih yang terakhir dipakai di Surat Jalan),
// 2) kendaraan di Surat Jalan terakhir sopir ini.
function kendaraanUntukSopir(sopirId) {
  const s = sopirList.value.find((x) => x.id === sopirId);
  if (!s) return null;
  const dipegang = armadaList.value.filter((a) => a.sopirId === sopirId);
  let armada = null;
  if (dipegang.length === 1) armada = dipegang[0];
  else if (dipegang.length > 1) armada = dipegang.find((a) => a.id === s.armadaIdTerakhir) || dipegang[0];
  else if (s.armadaIdTerakhir) armada = armadaList.value.find((a) => a.id === s.armadaIdTerakhir) || null;
  if (armada) return { armadaId: armada.id, nopol: armada.nopol };
  if (s.nopolTerakhir) {
    const cocok = armadaList.value.find((a) => normNopol(a.nopol) === normNopol(s.nopolTerakhir));
    return { armadaId: cocok?.id || "", nopol: cocok?.nopol || s.nopolTerakhir };
  }
  return null;
}

function isiKendaraanDariSopir() {
  const k = kendaraanUntukSopir(form.value.sopirId);
  if (!k) return;
  const noPol = (form.value.noPolisi || "").trim();
  const bolehTimpa = !noPol || noPol === autoKendaraan.value.nopol;
  if (!bolehTimpa) return; // sudah diketik / diubah manual -> jangan ditimpa
  form.value.noPolisi = k.nopol;
  // armada ikut dikaitkan hanya kalau kosong atau juga hasil otomatis
  if (k.armadaId && (!form.value.armadaId || form.value.armadaId === autoKendaraan.value.armadaId)) {
    form.value.armadaId = k.armadaId;
  }
  autoKendaraan.value = { nopol: k.nopol, armadaId: k.armadaId || "" };
}

// Kalau staf mengubah No. Polisi sendiri sehingga tidak lagi sama dengan armada
// yang terisi otomatis, kaitan armada otomatis itu dilepas (atau dipindah ke
// armada yang nopolnya cocok) -- supaya nopol yang diketik yang dianggap benar
// di Rekap Armada, bukan armada lama yang terisi otomatis.
watch(
  () => form.value.noPolisi,
  (v) => {
    const aid = form.value.armadaId;
    if (!aid || aid !== autoKendaraan.value.armadaId) return;
    const a = armadaList.value.find((x) => x.id === aid);
    if (!a || normNopol(a.nopol) === normNopol(v)) return;
    const cocok = armadaList.value.find((x) => normNopol(x.nopol) === normNopol(v));
    form.value.armadaId = cocok ? cocok.id : "";
  }
);

// Dipanggil HANYA saat user memilih sopir di dropdown.
function onSopirDipilih() {
  isiKendaraanDariSopir();
  onSopirChange();
}

// Kalau Armada dipilih, ambil otomatis No. Polisi & Sopir dari master
// Armada (masih boleh diubah manual kalau perlu).
function onArmadaChange() {
  const armada = armadaList.value.find((a) => a.id === form.value.armadaId);
  if (armada) {
    const noPol = (form.value.noPolisi || "").trim();
    if (!noPol || noPol === autoKendaraan.value.nopol) {
      form.value.noPolisi = armada.nopol;
      autoKendaraan.value = { nopol: armada.nopol, armadaId: armada.id };
    }
    if (!form.value.sopirId && armada.sopirId) {
      form.value.sopirId = armada.sopirId;
      onSopirChange();
    } else if (!form.value.sopir && armada.sopir) {
      form.value.sopir = armada.sopir;
    }
  }
}

// Kalau sopir dipilih dari master, auto-isi Uang Komisi dari komisi
// defaultnya (Tronton biasanya 50rb, Cold Diesel biasanya 0 karena manual
// tiap kali) -- HANYA kalau kolom komisi masih kosong/0, supaya tidak
// menimpa nilai yang sudah diketik manual (situasional).
function onSopirChange() {
  // Ganti sopir = hitung ulang komisi (Tronton flat / Cold Diesel dari uang
  // jalan), kecuali komisi sudah diketik manual.
  const s = sopirDipilih.value;
  if (komisiManual.value) return;
  if (komisiAuto.value) form.value.uangKomisi = komisiAuto.value.nilai;
  else if (s && !form.value.uangKomisi) form.value.uangKomisi = s.komisiDefault || 0;
}

function validateForm() {
  if (!form.value.divisi) {
    toast("Divisi wajib dipilih");
    return false;
  }
  if (!form.value.penerima?.trim()) {
    toast("Penerima wajib diisi");
    return false;
  }
  if (!form.value.tujuan?.trim()) {
    toast("Tujuan wajib diisi");
    return false;
  }
  if (!form.value.tanggal) {
    toast("Tanggal wajib diisi");
    return false;
  }
  if (!editingId.value && (!Number.isInteger(Number(form.value.jumlahSuratJalan)) || Number(form.value.jumlahSuratJalan) < 1 || Number(form.value.jumlahSuratJalan) > 100)) {
    toast("Jumlah surat jalan harus antara 1 sampai 100");
    return false;
  }
  return true;
}

async function submit() {
  if (!validateForm()) return;

  saving.value = true;
  try {
    const payload = {
      divisi: form.value.divisi,
      customerId: form.value.customerId,
      armadaId: form.value.armadaId || null,
      penerima: form.value.penerima?.trim() || null,
      tujuan: form.value.tujuan?.trim() || "",
      jenisBarang: form.value.jenisBarang?.trim() || null,
      noPolisi: form.value.noPolisi?.trim() || null,
      sopir: form.value.sopir?.trim() || null,
      sopirId: form.value.sopirId || null,
      belanjaPasir: Number(form.value.belanjaPasir) || 0,
      uangMobil: Number(form.value.uangMobil) || 0,
      uangJalan: Number(form.value.uangJalan) || 0,
      uangKomisi: Number(form.value.uangKomisi) || 0,
      panjang: Number(form.value.panjang) || 0,
      lebar: Number(form.value.lebar) || 0,
      tinggi: Number(form.value.tinggi) || 0,
      tanggal: form.value.tanggal,
      jam: form.value.jam || null,
      isDraft: !!form.value.isDraft,
      ...(!editingId.value ? { jumlahSuratJalan: Number(form.value.jumlahSuratJalan) || 1 } : {}),
      ...(editingId.value && editingBatchMateCount.value ? { applyToBatch: applyToBatch.value } : {}),
    };

    if (editingId.value) {
      const updated = await api.put(`/surat-jalan/${editingId.value}`, payload);
      toast(
        updated.updatedBatchCount
          ? `Surat jalan diperbarui, ikut disamakan ke ${updated.updatedBatchCount} SJ lain dalam grup ini`
          : "Surat jalan berhasil diperbarui"
      );
    } else {
      const created = await api.post("/surat-jalan", payload);
      if (Array.isArray(created)) {
        toast(`${created.length} surat jalan berhasil disimpan (${created[0]?.no} s/d ${created[created.length - 1]?.no})`);
      } else {
        toast(`Surat jalan ${created.no} berhasil disimpan`);
      }
    }

    showModal.value = false;
    await load();
  } catch (error) {
    console.error(error);
    toast(error?.message || "Gagal menyimpan surat jalan");
  } finally {
    saving.value = false;
  }
}

async function tandaiTTD(id) {
  try {
    await api.patch(`/surat-jalan/${id}/ttd`, {});
    toast("Status TTD diperbarui");
    await load();
  } catch (error) {
    console.error(error);
    toast("Gagal memperbarui status TTD");
  }
}

async function removeSJ(sj) {
  if (!confirm(`Hapus surat jalan ${sj.no}?`)) return;
  try {
    await api.delete(`/surat-jalan/${sj.id}`);
    toast("Surat jalan berhasil dihapus");
    await load();
  } catch (error) {
    toast(error?.message || "Gagal menghapus surat jalan");
  }
}

function cetak(sj) {
  printSJ(sj);
}

function batchMateCount(sj) {
  if (!sj.batchId) return 0;
  return list.value.filter((x) => x.batchId === sj.batchId && x.id !== sj.id).length;
}

// ---- pilih banyak SJ sekaligus ----
const allSelected = computed(
  () => list.value.length > 0 && selectedIds.value.length === list.value.length
);

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : list.value.map((sj) => sj.id);
}

function toggleSelectOne(id) {
  const i = selectedIds.value.indexOf(id);
  if (i === -1) selectedIds.value.push(id);
  else selectedIds.value.splice(i, 1);
}

function selectedSJList() {
  // urutan sesuai tampilan tabel (bukan urutan klik), biar hasil cetak
  // urut sama seperti yang terlihat di layar
  const idSet = new Set(selectedIds.value);
  return list.value.filter((sj) => idSet.has(sj.id));
}

function cetakTerpilih() {
  const items = selectedSJList();
  if (!items.length) return toast("Pilih dulu Surat Jalan yang mau dicetak");
  printSJ(items); // print.js sudah mendukung array - satu print job berurutan tanpa jeda
}

// Export beberapa SJ sekaligus jadi SATU file .xlsx (satu sheet per SJ).
// Nanti waktu diprint di PC print, harus diprint sebagai satu
// file/workbook (bukan sheet satu-satu) supaya kertas terus nyambung -
// PrintSJExcel.vbs sudah otomatis melakukan ini.
async function exportSJXlsxTerpilih() {
  const ids = selectedIds.value;
  if (!ids.length) return toast("Pilih dulu Surat Jalan yang mau di-export");
  try {
    await api.download("/surat-jalan/export-xlsx-batch", `SJ-Batch-${ids.length}dok.xlsx`, {
      method: "POST",
      body: { ids },
    });
  } catch (error) {
    toast(error?.message || "Gagal export ke Excel");
  }
}

// Export ke .xlsx (Page Setup terkunci di file, dicetak lewat Excel -
// lebih stabil di kertas continuous form / dot matrix daripada lewat
// dialog print browser, karena settingnya tidak balik ke default tiap
// print). Pakai posisi kalibrasi yang sama dengan "Cetak" biasa.
async function exportSJXlsx(sj) {
  try {
    await api.download(`/surat-jalan/${sj.id}/export-xlsx`, `SJ-${sj.no}.xlsx`);
  } catch (error) {
    toast(error?.message || "Gagal export ke Excel");
  }
}

onMounted(load);

// ---- Scan kamera (HP): foto Surat Jalan kertas -> masuk sistem ----
const showScan = ref(false);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Surat Jalan</h1>
      <div class="desc">Dokumen pengiriman barang</div>
    </div>

    <div style="display: flex; gap: 8px; flex-wrap: wrap">
      <button class="btn" @click="showScan = true">📷 Scan Surat Jalan</button>
      <button class="btn btn-primary" @click="openModal">+ Buat Surat Jalan</button>
    </div>
  </div>

  <div class="content">
    <div class="sj-search">
      <input
        v-model="searchQuery"
        @input="onSearchInput"
        type="text"
        placeholder="Cari No. Surat Jalan / Penerima / Customer / Tujuan / No. Polisi..."
      />
      <button v-if="searchQuery" class="btn btn-sm btn-ghost" @click="searchQuery = ''; reloadList()">✕</button>
    </div>

    <!-- RINGKASAN -->
    <div v-if="!loading && list.length" class="sj-summary">
      <div class="sj-summary-card">
        <div class="sj-summary-icon">📄</div>
        <div>
          <div class="sj-summary-label">TOTAL SURAT JALAN</div>
          <div class="sj-summary-value">{{ list.length }}</div>
        </div>
      </div>
      <div class="sj-summary-card">
        <div class="sj-summary-icon draft">📝</div>
        <div>
          <div class="sj-summary-label">DRAFT</div>
          <div class="sj-summary-value">{{ jumlahDraft }}</div>
        </div>
      </div>
      <div class="sj-summary-card">
        <div class="sj-summary-icon ttd">✓</div>
        <div>
          <div class="sj-summary-label">TTD LENGKAP</div>
          <div class="sj-summary-value">{{ jumlahTTD }}</div>
        </div>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length && searchQuery" class="empty">
      <div class="big">🔍</div>
      <div>Tidak ada surat jalan yang cocok dengan pencarian "{{ searchQuery }}".</div>
    </div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">📄</div>
      <div>Belum ada surat jalan.</div>
      <button class="btn btn-primary" style="margin-top: 14px" @click="openModal">
        + Buat Surat Jalan Pertama
      </button>
    </div>

    <div v-else class="card sj-table-card">
      <div class="section-title">
        Daftar Surat Jalan
        <span class="tag">{{ list.length }} Dokumen</span>
      </div>

      <div v-if="selectedIds.length" class="sj-batch-bar">
        <span>{{ selectedIds.length }} dipilih</span>
        <button class="btn btn-sm" @click="cetakTerpilih" title="Cetak semua yang dipilih berurutan tanpa jeda">
          🖨 Cetak Terpilih
        </button>
        <button class="btn btn-sm" @click="exportSJXlsxTerpilih" title="Export semua yang dipilih jadi satu file Excel">
          📊 Export Excel Terpilih
        </button>
        <button class="btn btn-sm btn-ghost" @click="selectedIds = []">Batal pilih</button>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="checkbox-col">
                <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" />
              </th>
              <th>No Surat Jalan</th>
              <th>Customer / Tujuan</th>
              <th>Jenis Barang</th>
              <th>No. Polisi</th>
              <th class="num">M3</th>
              <th>Tanggal</th>
              <th>Status</th>
              <th class="action-col">Aksi</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="sj in list" :key="sj.id">
              <td class="checkbox-col">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(sj.id)"
                  @change="toggleSelectOne(sj.id)"
                />
              </td>
              <td><span class="sj-number mono">{{ sj.no }}</span><span v-if="batchMateCount(sj) > 0" class="sj-batch-badge" :title="`Satu grup dengan ${batchMateCount(sj)} SJ lain (dibuat bareng)`">🔗 {{ batchMateCount(sj) + 1 }}</span></td>
              <td>
                <strong>{{ sj.customer?.nama || "-" }}</strong>
                <div v-if="sj.penerima && sj.penerima !== sj.customer?.nama" class="sj-penerima-sub">→ {{ sj.penerima }}</div>
                <div class="sj-tujuan-sub">{{ sj.tujuan }}</div>
              </td>
              <td>{{ sj.jenisBarang || "-" }}</td>
              <td class="mono">{{ sj.noPolisi || "-" }}</td>
              <td class="num mono">{{ fmtM3(sj.m3) }}</td>
              <td>{{ formatTanggal(sj.tanggal) }}</td>
              <td>
                <span class="badge" :class="statusClass(sj)">{{ statusText(sj) }}</span>
              </td>
              <td>
                <div class="sj-actions">
                  <button
                    v-if="sj.statusTTD !== 'LENGKAP'"
                    class="btn btn-sm btn-ghost"
                    @click="tandaiTTD(sj.id)"
                  >
                    ✓ TTD
                  </button>
                  <button class="btn btn-sm btn-ghost" @click="cetak(sj)" title="Cetak lewat browser">🖨</button>
                  <button class="btn btn-sm btn-ghost" @click="exportSJXlsx(sj)" title="Export ke Excel (buat cetak lewat Excel)">📊</button>
                  <button class="btn btn-sm btn-ghost" @click="openEdit(sj)">Edit</button>
                  <button class="btn btn-sm btn-danger" @click="removeSJ(sj)">Hapus</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="sj-hint">Nomor surat jalan dibuat otomatis oleh sistem.</div>
    </div>
  </div>

  <!-- MODAL -->
  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">×</button>

      <h2>{{ editingId ? "Edit Surat Jalan" : "Buat Surat Jalan" }}</h2>
      <div class="msub">
        Isi informasi pengiriman. Nomor surat jalan akan dibuat otomatis oleh sistem. Kalau pembeli kontan/tidak terdaftar, Customer boleh dikosongkan — isi Penerima & Tujuan manual saja.
      </div>

      <div class="row">
        <div class="field">
          <label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>

        <div class="field">
          <label>Customer <span class="optional">(opsional — A/P Dari)</span></label>
          <div class="combobox">
            <input
              v-model="customerSearch"
              type="text"
              placeholder="Ketik nama / kode customer untuk cari..."
              autocomplete="off"
              @focus="showCustomerOptions = true"
              @input="showCustomerOptions = true"
              @blur="() => setTimeout(() => (showCustomerOptions = false), 150)"
            />
            <button
              v-if="form.customerId"
              type="button"
              class="combobox-clear"
              @mousedown.prevent="clearCustomerPick"
              title="Hapus pilihan"
            >×</button>
            <div v-if="showCustomerOptions" class="combobox-options">
              <div
                v-for="c in filteredCustomers"
                :key="c.id"
                class="combobox-option"
                @mousedown.prevent="pickCustomer(c)"
              >
                <strong>{{ c.kode }}</strong> — {{ c.nama }}
              </div>
              <div v-if="!filteredCustomers.length" class="combobox-empty">Customer tidak ditemukan</div>
            </div>
          </div>
        </div>
      </div>

      <div class="row" v-if="recipientOptions.length">
        <div class="field">
          <label>Penerima</label>
          <select v-model="form.recipientId" @change="onRecipientChange">
            <option value="" disabled>Pilih PT / penerima...</option>
            <option v-for="r in recipientOptions" :key="r.id" :value="r.id">{{ r.nama }} — {{ r.alamat }}</option>
          </select>
        </div>
        <div class="field">
          <label>Tujuan</label>
          <select v-model="form.tujuan" @change="onTujuanChange">
            <option value="" disabled>Pilih alamat tujuan...</option>
            <option v-for="r in recipientOptions" :key="r.id" :value="r.alamat">{{ r.alamat }}</option>
          </select>
        </div>
      </div>
      <div class="row" v-else>
        <div class="field"><label>Penerima</label><input v-model="form.penerima" placeholder="Nama penerima" /></div>
        <div class="field"><label>Tujuan</label><input v-model="form.tujuan" placeholder="Alamat tujuan pengiriman" /></div>
      </div>

      <div class="field">
        <label>Jenis Barang / Stock</label>
        <SearchableSelect
          v-model="form.jenisBarang"
          :options="stockMasterList.map(s => ({ value: s.nama, label: `${s.kode} — ${s.nama}` }))"
          placeholder="Pilih jenis barang..."
        />
      </div>

      <div class="row">
        <div class="field">
          <label>Armada <span class="optional">(opsional)</span></label>
          <SearchableSelect
            v-model="form.armadaId"
            @change="onArmadaChange"
            :options="armadaList.map(a => ({ value: a.id, label: `${a.nopol} — ${a.jenis}` }))"
            placeholder="- Pilih armada, atau isi manual di bawah -"
          />
        </div>
        <div class="field">
          <label>Tanggal</label>
          <input v-model="form.tanggal" type="date" />
        </div>
      </div>

      <div v-if="!editingId" class="field">
        <label>Jumlah Surat Jalan</label>
        <input v-model.number="form.jumlahSuratJalan" type="number" min="1" max="100" step="1" />
        <div class="field-hint">Untuk customer dan tujuan yang sama. Setiap surat jalan akan dibuat dengan nomor yang berbeda otomatis.</div>
      </div>

      <label v-if="editingId && editingBatchMateCount" class="draft-check">
        <input v-model="applyToBatch" type="checkbox" />
        <div>
          <div>Terapkan perubahan ini ke {{ editingBatchMateCount }} surat jalan lain dalam grup ini</div>
          <div class="draft-check-sub">
            Dokumen ini dibuat bareng lewat "Jumlah Surat Jalan" saat dibuat. Nomor SJ masing-masing tetap beda,
            tapi data lain (customer, tujuan, ukuran, dll) bisa disamakan sekaligus. Uncentang kalau cuma mau ubah dokumen ini saja.
          </div>
        </div>
      </label>

      <div class="row">
        <div class="field">
          <label>No. Polisi</label>
          <input v-model="form.noPolisi" placeholder="Contoh: B 9012 XYZ" />
          <div class="field-hint">Terisi otomatis saat sopir dipilih (dari data sebelumnya), tetap bisa diubah.</div>
        </div>
        <div class="field">
          <label>Sopir</label>
          <SearchableSelect
            v-model="form.sopirId"
            @change="onSopirDipilih"
            :options="sopirList.map(s => ({ value: s.id, label: s.nama, sub: s.tipe === 'TRONTON' ? 'Tronton' : 'Cold Diesel' }))"
            placeholder="Pilih dari master Sopir..."
          />
          <input
            v-if="!form.sopirId"
            v-model="form.sopir"
            placeholder="Atau ketik manual"
            style="margin-top:6px;"
          />
        </div>
      </div>

      <div class="msub" style="margin-top:10px;">Biaya operasional pengiriman ini (opsional, internal) — dipotong dari harga jual untuk hitung Net di Invoice, tidak ikut dicetak ke customer</div>
      <div class="row row-4">
        <div class="field">
          <label>Belanja Pasir</label>
          <MoneyInput v-model="form.belanjaPasir" />
        </div>
        <div class="field">
          <label>Uang Mobil</label>
          <MoneyInput v-model="form.uangMobil" />
        </div>
        <div class="field">
          <label>Uang Jalan</label>
          <MoneyInput v-model="form.uangJalan" />
        </div>
        <div class="field">
          <label>Uang Komisi</label>
          <MoneyInput :model-value="form.uangKomisi" @update:model-value="onKomisiEdit" />
        </div>
      </div>

      <div v-if="komisiAuto || komisiManual" class="komisi-hint" :class="{ manual: komisiManual }">
        <template v-if="komisiManual">
          Komisi diisi manual: <strong>{{ rupiah(form.uangKomisi) }}</strong>.
          <button v-if="komisiAuto" type="button" class="komisi-reset" @click="hitungKomisiOtomatis">↺ Hitung otomatis</button>
        </template>
        <template v-else>💡 {{ komisiAuto.teks }}. Bisa diubah manual di kolom Uang Komisi.</template>
      </div>

      <div class="row row-4">
        <div class="field">
          <label>Panjang (m)</label>
          <input v-model.number="form.panjang" type="number" step="0.01" min="0" />
        </div>
        <div class="field">
          <label>Lebar (m)</label>
          <input v-model.number="form.lebar" type="number" step="0.01" min="0" />
        </div>
        <div class="field">
          <label>Tinggi (m)</label>
          <input v-model.number="form.tinggi" type="number" step="0.01" min="0" />
        </div>
        <div class="field">
          <label>Jam</label>
          <input v-model="form.jam" type="time" />
        </div>
      </div>

      <div class="m3-hint">M3 = <strong>{{ fmtM3(m3Preview) }}</strong></div>

      <label class="draft-check">
        <input v-model="form.isDraft" type="checkbox" />
        <div>
          <div>Simpan sebagai Draft</div>
          <div class="draft-check-sub">Draft dapat digunakan sebelum dokumen ditandatangani.</div>
        </div>
      </label>

      <div class="modal-actions">
        <button class="btn btn-ghost" :disabled="saving" @click="closeModal">Batal</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? "Menyimpan..." : "Simpan Surat Jalan" }}
        </button>
      </div>
    </div>
  </div>

  <ScanDokumen v-if="showScan" tipe="SJ" @close="showScan = false" @saved="reloadList" />
</template>

<style scoped>
.sj-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 18px; }
.sj-summary-card { display: flex; align-items: center; gap: 10px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.sj-summary-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; background: var(--bms-blue-soft); font-size: 16px; }
.sj-summary-icon.draft { background: #fff2d9; }
.sj-summary-icon.ttd { background: #dcf5e4; }
.sj-summary-label { font-size: 10.5px; color: var(--ink-soft); letter-spacing: .04em; }
.sj-summary-value { font-size: 20px; font-weight: 800; }
.sj-tujuan-sub { font-size: 11px; color: var(--ink-soft); max-width: 260px; }
.sj-penerima-sub { font-size: 11px; color: var(--bms-blue-dark); font-weight: 600; max-width: 260px; }
.sj-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.checkbox-col { width: 32px; text-align: center; }
.sj-batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  background: #eef4ff;
  border: 1px solid #cfe0fb;
  border-radius: 8px;
  font-size: 13px;
}
.sj-hint { margin-top: 10px; font-size: 11.5px; color: var(--ink-soft); }
.row-4 { grid-template-columns: repeat(4, 1fr); }
.m3-hint { font-size: 12.5px; color: var(--ink-soft); margin: 6px 0 12px; }
.draft-check { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; margin-bottom: 14px; cursor: pointer; }
.draft-check input { margin-top: 3px; }
.draft-check-sub { font-size: 11px; color: var(--ink-soft); }
.optional { font-weight: 400; color: var(--ink-soft); font-size: 11px; }
.sj-search { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.sj-search input {
  flex: 1;
  max-width: 420px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  font-size: 13px;
}
.combobox { position: relative; }
.combobox input { width: 100%; padding-right: 26px; }
.combobox-clear {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  border: none; background: none; cursor: pointer; font-size: 16px; color: var(--ink-soft); line-height: 1;
}
.combobox-options {
  position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0;
  max-height: 220px; overflow-y: auto;
  background: #fff; border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 8px 20px rgba(0,0,0,.08);
}
.combobox-option { padding: 8px 12px; font-size: 13px; cursor: pointer; }
.combobox-option:hover { background: var(--bms-blue-soft); }
.combobox-empty { padding: 8px 12px; font-size: 12px; color: var(--ink-soft); }
.sj-batch-badge {
  display: inline-block; margin-left: 6px; font-size: 10.5px; font-weight: 600;
  color: var(--bms-blue-dark); background: var(--bms-blue-soft);
  border-radius: 999px; padding: 1px 7px;
}
.komisi-hint { font-size: 12px; background: #eef7ee; border: 1px solid #cfe8d2; color: #15622c; border-radius: 8px; padding: 7px 10px; margin: -2px 0 12px; }
.komisi-hint.manual { background: #fff7e6; border-color: #f3dfb0; color: #8a5a00; }
.komisi-reset { margin-left: 6px; border: none; background: none; color: var(--bms-blue-dark); font-weight: 600; cursor: pointer; font-size: 12px; }
.field-hint { margin-top: 5px; font-size: 11px; color: var(--ink-soft); line-height: 1.4; }

@media (max-width: 700px) {
  .sj-summary { grid-template-columns: 1fr; }
  .row-4 { grid-template-columns: 1fr 1fr; }
}
</style>