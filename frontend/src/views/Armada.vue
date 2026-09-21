<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import DokumenAsetPanel from "../components/DokumenAsetPanel.vue";
import SearchableSelect from "../components/SearchableSelect.vue";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

// Pilihan "Jenis Armada" dibakukan (dropdown) supaya penamaan konsisten
// di seluruh sistem -- terutama Tronton & Cold Diesel, karena nama ini
// dipakai untuk mengelompokkan kendaraan di halaman Laporan Divisi &
// Rekap Armada (kalau ditulis beda-beda, mis. "cold diesel" vs "Colt
// Diesel", kendaraannya tidak akan ketemu di rekap). Tetap bisa ketik
// manual lewat opsi "Lainnya" untuk jenis alat/kendaraan di luar daftar.
const JENIS_ARMADA_OPTIONS = ["Tronton", "Cold Diesel", "Excavator", "Lainnya (ketik manual)"];

const list = ref([]);
const sopirList = ref([]); // master Sopir (aktif) -- dropdown pilih sopir per kendaraan
const rekap = ref(null); // hasil /armada/rekap/:bulan (pendapatan, sparepart, hasilBersih per nopol)
const txAll = ref([]); // semua transaksi divisi Armada bulan ini (utk rincian per kendaraan)
const bulan = ref(new Date().toISOString().slice(0, 10).slice(0, 7));
const loading = ref(true);

// --- Search & filter daftar kendaraan ---
const search = ref("");
const filterDivisi = ref("Semua");
const filterJenis = ref("Semua");
const jenisTersedia = computed(() => Array.from(new Set(list.value.map((a) => a.jenis).filter(Boolean))).sort());
const filteredList = computed(() => {
  const q = search.value.trim().toLowerCase();
  return list.value.filter((a) => {
    if (filterDivisi.value !== "Semua" && a.divisi !== filterDivisi.value) return false;
    if (filterJenis.value !== "Semua" && a.jenis !== filterJenis.value) return false;
    if (!q) return true;
    return (
      (a.nopol || "").toLowerCase().includes(q) ||
      (a.sopir || "").toLowerCase().includes(q)
    );
  });
});

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

// --- Modal Tambah/Edit data master kendaraan ---
const showModal = ref(false);
const editingId = ref(null);
const jenisCustom = ref(false);

const emptyForm = () => ({
  nopol: "",
  jenis: "",
  sopir: "",
  sopirId: "",
  divisi: DIVISI[0],
  panjang: "",
  lebar: "",
  tinggi: "",
  volume: "",
});

const form = ref(emptyForm());

const volumeOtomatis = computed(() => {
  const p = Number(form.value.panjang);
  const l = Number(form.value.lebar);
  const t = Number(form.value.tinggi);
  if (!p || !l || !t) return null;
  return Math.round(p * l * t * 100) / 100;
});

function pakaiVolumeOtomatis() {
  if (volumeOtomatis.value !== null) {
    form.value.volume = String(volumeOtomatis.value);
  }
}

async function load() {
  loading.value = true;
  try {
    const [armadaList, rekapData, tx, sopirData] = await Promise.all([
      api.get("/armada"),
      api.get(`/armada/rekap/${bulan.value}`),
      api.get(`/divisi-tx?bulan=${bulan.value}`),
      api.get("/sopir?all=1"),
    ]);
    list.value = armadaList;
    rekap.value = rekapData;
    txAll.value = tx.filter((t) => t.divisi === "Armada");
    sopirList.value = sopirData;
  } catch (e) {
    toast(e.message || "Gagal memuat data armada");
  } finally {
    loading.value = false;
  }
}

function rekapFor(nopol) {
  return rekap.value?.rekap.find((r) => r.nopol === nopol) || null;
}

function txFor(nopol) {
  return txAll.value
    .filter((t) => t.subKategori === nopol)
    .sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));
}

function kelompokTotal(nopol, kelompok) {
  if (!nopol) return 0;
  return txFor(nopol)
    .filter((t) => t.kelompok === kelompok)
    .reduce((s, t) => s + t.nominal, 0);
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  jenisCustom.value = false;
  showModal.value = true;
}

function openEdit(a) {
  editingId.value = a.id;
  jenisCustom.value = !!a.jenis && !JENIS_ARMADA_OPTIONS.slice(0, -1).includes(a.jenis);
  form.value = {
    nopol: a.nopol,
    jenis: a.jenis,
    sopir: a.sopir || "",
    sopirId: a.sopirId || "",
    divisi: a.divisi,
    panjang: a.panjang ?? "",
    lebar: a.lebar ?? "",
    tinggi: a.tinggi ?? "",
    volume: a.volume ?? "",
  };
  showModal.value = true;
}

function onJenisSelect(val) {
  if (val === "Lainnya (ketik manual)") {
    jenisCustom.value = true;
    form.value.jenis = "";
  } else {
    jenisCustom.value = false;
    form.value.jenis = val;
  }
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nopol || !form.value.jenis) {
    return toast("Nomor polisi dan jenis armada wajib diisi");
  }

  try {
    if (editingId.value) {
      await api.put(`/armada/${editingId.value}`, form.value);
      toast("Armada berhasil diperbarui");
    } else {
      await api.post("/armada", form.value);
      toast("Armada berhasil ditambahkan");
    }

    showModal.value = false;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan armada");
  }
}

async function remove(id) {
  if (!confirm("Hapus armada ini? Data transaksi terkait (pendapatan/sparepart) TIDAK ikut terhapus.")) return;

  try {
    await api.delete(`/armada/${id}`);
    toast("Armada berhasil dihapus");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus armada");
  }
}

function fmtUkuran(a) {
  if (!a.panjang && !a.lebar && !a.tinggi) return "-";
  return `${a.panjang ?? "-"} x ${a.lebar ?? "-"} x ${a.tinggi ?? "-"} m`;
}

// --- Kartu per kendaraan: buka detail (khusus divisi "Armada", yang
// pendapatan/pengeluarannya dilacak lewat Laporan Divisi per nomor polisi) ---
const showDetail = ref(false);
const detailArmada = ref(null);

function openDetail(a) {
  if (a.divisi !== "Armada") {
    // Kendaraan divisi lain (mis. armada Supplier untuk surat jalan) belum
    // dilacak pendapatan/pengeluarannya di sini -- langsung buka edit data.
    return openEdit(a);
  }
  detailArmada.value = a;
  showDetail.value = true;
}

function closeDetail() {
  showDetail.value = false;
  detailArmada.value = null;
}

// --- Dokumen kelengkapan kendaraan (STNK, KIR, Foto Mobil, dst) ---
const showDokumen = ref(false);
const dokumenArmada = ref(null);
function openDokumen(a) {
  dokumenArmada.value = a;
  showDokumen.value = true;
}
function closeDokumen() {
  showDokumen.value = false;
  dokumenArmada.value = null;
}

function isTronton(jenis) {
  return (jenis || "").toLowerCase().includes("tronton");
}
function isDiesel(jenis) {
  return (jenis || "").toLowerCase().includes("diesel");
}
function kategoriHasil(jenis) {
  if (isTronton(jenis)) return "Hasil Mobil Tronton";
  if (isDiesel(jenis)) return "Hasil Mobil Cold Diesel";
  return `Hasil Mobil ${jenis}`;
}
function kategoriUangJalan(jenis) {
  if (isTronton(jenis)) return "Uang Jalan Tronton";
  if (isDiesel(jenis)) return "Uang Jalan Cold Diesel";
  return `Uang Jalan ${jenis}`;
}
function kategoriSparepart(jenis) {
  if (isTronton(jenis)) return "Sparepart Tronton";
  if (isDiesel(jenis)) return "Sparepart Cold Diesel";
  return `Sparepart ${jenis}`;
}

// --- Kolom/kategori pengeluaran-pendapatan per kendaraan: 3 kelompok bawaan
// (Pendapatan, Sparepart, Operasional Sopir) + kolom CUSTOM bebas yang bisa
// ditambah user sendiri (nama & kelompok pendapatan/pengeluaran bebas), dan
// otomatis "diingat" untuk dipakai lagi di kendaraan lain (diambil dari
// kategori yang sudah pernah dipakai sebelumnya di divisi Armada).
const CUSTOM_OPT = "__custom__";
const KELOMPOK_OPTIONS = [
  { key: "pendapatan", label: "Pendapatan" },
  { key: "sparepart", label: "Pengeluaran — Sparepart" },
  { key: "operasional", label: "Pengeluaran — Operasional Sopir (Uang Jalan, Beli Material, dst)" },
];

// Daftar kategori custom yang pernah dipakai (dikumpulkan dari semua transaksi
// divisi Armada yang sudah ada), supaya kolom baru yang pernah diketik user
// bisa dipilih lagi lewat dropdown -- bukan diketik ulang tiap saat.
const kategoriTerpakai = computed(() => {
  const map = { pendapatan: new Set(), sparepart: new Set(), operasional: new Set() };
  for (const t of txAll.value) {
    if (map[t.kelompok]) map[t.kelompok].add(t.kategori);
  }
  return map;
});

function kategoriDefaultUntuk(kelompok, jenis) {
  if (kelompok === "pendapatan") return [kategoriHasil(jenis), kategoriUangJalan(jenis)];
  if (kelompok === "sparepart") return [kategoriSparepart(jenis)];
  return ["Uang Jalan Sopir", "Pembelian Material"];
}

function kategoriOptionsUntuk(kelompok, jenis) {
  const set = new Set(kategoriDefaultUntuk(kelompok, jenis));
  for (const k of kategoriTerpakai.value[kelompok] || []) set.add(k);
  return Array.from(set);
}

// --- Form catat transaksi cepat dari dalam kartu kendaraan ---
const showTxModal = ref(false);
const txForm = ref({
  kelompok: "operasional",
  kategori: "",
  kategoriCustom: false,
  nominal: "",
  tanggal: new Date().toISOString().slice(0, 10),
  keterangan: "",
});
const editingTxId = ref(null);

const kategoriOptionsAktif = computed(() =>
  detailArmada.value ? kategoriOptionsUntuk(txForm.value.kelompok, detailArmada.value.jenis) : []
);

function onTxKategoriSelect(val) {
  if (val === CUSTOM_OPT) {
    txForm.value.kategoriCustom = true;
    txForm.value.kategori = "";
  } else {
    txForm.value.kategoriCustom = false;
    txForm.value.kategori = val;
  }
}

function openTambahTx(kelompok, kategoriAwal) {
  editingTxId.value = null;
  txForm.value = {
    kelompok,
    kategori: kategoriAwal || "",
    kategoriCustom: !kategoriAwal,
    nominal: "",
    tanggal: new Date().toISOString().slice(0, 10),
    keterangan: "",
  };
  showTxModal.value = true;
}

function openEditTx(t) {
  editingTxId.value = t.id;
  const kelompok = t.kelompok === "sparepart" ? "sparepart" : t.kelompok === "operasional" ? "operasional" : "pendapatan";
  const opsi = detailArmada.value ? kategoriOptionsUntuk(kelompok, detailArmada.value.jenis) : [];
  txForm.value = {
    kelompok,
    kategori: t.kategori || "",
    kategoriCustom: !opsi.includes(t.kategori),
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
  if (!detailArmada.value) return;
  if (!txForm.value.kategori) {
    return toast("Kategori/kolom wajib dipilih atau diisi");
  }
  if (!txForm.value.nominal || Number(txForm.value.nominal) <= 0) {
    return toast("Nominal wajib diisi dan lebih dari 0");
  }

  const kelompok = txForm.value.kelompok;
  const payload = {
    divisi: "Armada",
    tipe: kelompok === "pendapatan" ? "penjualan" : "pengeluaran",
    kelompok,
    kategori: txForm.value.kategori,
    subKategori: detailArmada.value.nopol,
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
  } catch (e) {
    toast(e.message || "Gagal menghapus transaksi");
  }
}

watch(bulan, load);
onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Armada</h1>
      <div class="desc">Kendaraan &amp; alat operasional perusahaan, per nomor polisi</div>
    </div>

    <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
      <div class="field" style="margin:0;">
        <label>Bulan</label>
        <input v-model="bulan" type="month" />
      </div>
      <button class="btn btn-primary" @click="openModal">+ Tambah Armada</button>
    </div>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="margin:0; flex:1; min-width:200px;">
        <label>Cari (Nopol / Sopir)</label>
        <input v-model="search" placeholder="Contoh: B 9244 atau Aceng" />
      </div>
      <div class="field" style="margin:0;">
        <label>Divisi</label>
        <select v-model="filterDivisi">
          <option value="Semua">Semua Divisi</option>
          <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div class="field" style="margin:0;">
        <label>Jenis</label>
        <select v-model="filterJenis">
          <option value="Semua">Semua Jenis</option>
          <option v-for="j in jenisTersedia" :key="j" :value="j">{{ j }}</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🚚</div>
      <div>Belum ada armada terdaftar.</div>
      <button class="btn btn-primary" style="margin-top:14px;" @click="openModal">+ Tambah Armada</button>
    </div>

    <div v-else-if="!filteredList.length" class="empty">
      <div class="big">🔎</div>
      <div>Tidak ada armada yang cocok dengan pencarian/filter.</div>
    </div>

    <div v-else class="armada-grid">
      <div v-for="a in filteredList" :key="a.id" class="card armada-card" @click="openDetail(a)">
        <div class="armada-card-top">
          <div class="armada-nopol mono">{{ a.nopol }}</div>
          <span class="tag">{{ a.jenis }}</span>
        </div>
        <div class="armada-sopir">{{ a.sopir || "Belum ada sopir" }}</div>
        <div class="armada-divisi">Divisi {{ a.divisi }}</div>

        <button type="button" class="btn btn-sm btn-ghost" style="margin: 6px 0;" @click.stop="openDokumen(a)">
          📎 Dokumen
        </button>

        <template v-if="a.divisi === 'Armada'">
          <div class="armada-summary">
            <div>
              <span>Pendapatan</span>
              <b>{{ rupiah(rekapFor(a.nopol)?.pendapatan || 0) }}</b>
            </div>
            <div>
              <span>Pengeluaran</span>
              <b>{{ rupiah(rekapFor(a.nopol)?.sparepart || 0) }}</b>
            </div>
            <div>
              <span>Hasil Bersih</span>
              <b :style="{ color: (rekapFor(a.nopol)?.hasilBersih || 0) >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)' }">
                {{ rupiah(rekapFor(a.nopol)?.hasilBersih || 0) }}
              </b>
            </div>
          </div>
          <div class="armada-hint">Klik untuk lihat rincian &amp; catat transaksi →</div>
        </template>
        <template v-else>
          <div class="armada-hint">Klik untuk edit data kendaraan →</div>
        </template>
      </div>
    </div>
  </div>

  <!-- Modal Tambah/Edit data master kendaraan -->
  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">×</button>
      <h2>{{ editingId ? "Edit Armada" : "Tambah Armada" }}</h2>
      <div class="msub">Isi data kendaraan atau alat operasional</div>

      <div class="row">
        <div class="field">
          <label>Nomor Polisi</label>
          <input v-model="form.nopol" placeholder="Contoh: B 1234 XYZ" />
        </div>
        <div class="field">
          <label>Jenis Armada</label>
          <select :value="jenisCustom ? 'Lainnya (ketik manual)' : form.jenis" @change="onJenisSelect($event.target.value)">
            <option value="" disabled>Pilih jenis</option>
            <option v-for="j in JENIS_ARMADA_OPTIONS" :key="j" :value="j">{{ j }}</option>
          </select>
          <input v-if="jenisCustom" v-model="form.jenis" placeholder="Ketik jenis armada/alat, mis. Dump Truck" style="margin-top: 6px" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Sopir / Operator</label>
          <SearchableSelect
            v-model="form.sopirId"
            :options="sopirList.map(s => ({ value: s.id, label: s.nama, sub: s.tipe === 'TRONTON' ? 'Tronton' : 'Cold Diesel' }))"
            placeholder="Pilih dari master Sopir..."
          />
          <input
            v-if="!form.sopirId"
            v-model="form.sopir"
            placeholder="Atau ketik manual kalau belum ada di master Sopir"
            style="margin-top:6px;"
          />
          <div class="field-hint" v-if="!form.sopirId && form.sopir">
            Belum dikaitkan ke master Sopir — komisi &amp; biaya sopir ini tidak akan auto-terisi di Surat Jalan.
            Tambahkan dulu di menu <router-link to="/sopir">Sopir</router-link> kalau perlu.
          </div>
        </div>
        <div class="field">
          <label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>

      <div class="msub" style="margin-top:10px;">Index P-L-T (ukuran bak, meter) &amp; Volume — opsional</div>

      <div class="row">
        <div class="field"><label>Panjang (m)</label><input v-model="form.panjang" type="number" step="0.01" /></div>
        <div class="field"><label>Lebar (m)</label><input v-model="form.lebar" type="number" step="0.01" /></div>
        <div class="field"><label>Tinggi (m)</label><input v-model="form.tinggi" type="number" step="0.01" /></div>
      </div>

      <div class="row">
        <div class="field"><label>Volume (m³)</label><input v-model="form.volume" type="number" step="0.01" /></div>
        <div class="field" style="justify-content:flex-end; display:flex; flex-direction:column;">
          <button v-if="volumeOtomatis !== null" type="button" class="btn btn-ghost btn-sm" @click="pakaiVolumeOtomatis">
            Pakai hasil P×L×T ({{ volumeOtomatis }} m³)
          </button>
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:space-between; margin-top:8px;">
        <button v-if="editingId" class="btn btn-danger" @click="remove(editingId); closeModal()">Hapus Armada</button>
        <div style="display:flex; gap:8px; margin-left:auto;">
          <button class="btn btn-ghost" @click="closeModal">Batal</button>
          <button class="btn btn-primary" @click="submit">Simpan Armada</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Modal Dokumen kelengkapan kendaraan: STNK, KIR, Foto Mobil, dst -->
  <div v-if="showDokumen && dokumenArmada" class="modal-bg" @click.self="closeDokumen">
    <div class="modal" style="max-width: 640px;">
      <button class="modal-close" @click="closeDokumen">×</button>
      <h2>Dokumen — {{ dokumenArmada.nopol }}</h2>
      <div class="msub">Kelengkapan dokumen kendaraan ini</div>
      <DokumenAsetPanel aset-tipe="MOBIL" :aset-id="dokumenArmada.id" />
    </div>
  </div>

  <!-- Modal Detail per kendaraan: rincian pendapatan/sparepart bulan berjalan -->
  <div v-if="showDetail && detailArmada" class="modal-bg" @click.self="closeDetail">
    <div class="modal" style="max-width:640px; width:94%;">
      <button class="modal-close" @click="closeDetail">×</button>
      <h2 class="mono">{{ detailArmada.nopol }}</h2>
      <div class="msub">
        {{ detailArmada.sopir || "Belum ada sopir" }} &middot; {{ detailArmada.jenis }} &middot; Divisi {{ detailArmada.divisi }}
      </div>

      <div class="armada-summary armada-summary-detail">
        <div>
          <span>Pendapatan (Uang Jalan + Hasil Mobil)</span>
          <b>{{ rupiah(rekapFor(detailArmada.nopol)?.pendapatan || 0) }}</b>
        </div>
        <div>
          <span>Total Pengeluaran (Sparepart + Operasional + lainnya)</span>
          <b>{{ rupiah(rekapFor(detailArmada.nopol)?.sparepart || 0) }}</b>
        </div>
        <div>
          <span>Hasil Bersih</span>
          <b :style="{ color: (rekapFor(detailArmada.nopol)?.hasilBersih || 0) >= 0 ? 'var(--green,#16a34a)' : 'var(--red,#dc2626)' }">
            {{ rupiah(rekapFor(detailArmada.nopol)?.hasilBersih || 0) }}
          </b>
        </div>
      </div>

      <div class="armada-summary armada-summary-detail" style="margin-top:8px;">
        <div>
          <span>Pengeluaran Operasional Sopir</span>
          <b>{{ rupiah(kelompokTotal(detailArmada?.nopol, "operasional")) }}</b>
        </div>
        <div>
          <span>Pengeluaran Sparepart</span>
          <b>{{ rupiah(kelompokTotal(detailArmada?.nopol, "sparepart")) }}</b>
        </div>
      </div>

      <div style="display:flex; gap:8px; margin:14px 0; flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('pendapatan', kategoriHasil(detailArmada.jenis))">+ Hasil Mobil</button>
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('pendapatan', kategoriUangJalan(detailArmada.jenis))">+ Uang Jalan (Sewa)</button>
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('operasional', 'Uang Jalan Sopir')">+ Uang Jalan Sopir</button>
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('operasional', 'Pembelian Material')">+ Beli Material</button>
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('sparepart', kategoriSparepart(detailArmada.jenis))">+ Sparepart</button>
        <button class="btn btn-ghost btn-sm" @click="openTambahTx('operasional')">+ Kolom Lain (Custom)</button>
      </div>

      <div class="section-title">
        Transaksi Bulan Ini
        <span class="tag">{{ txFor(detailArmada.nopol).length }}</span>
      </div>

      <div v-if="!txFor(detailArmada.nopol).length" class="empty" style="padding:16px;">
        Belum ada transaksi untuk kendaraan ini bulan ini.
      </div>
      <table v-else>
        <thead>
          <tr>
            <th>Tanggal</th>
            <th>Kategori</th>
            <th class="num">Nominal</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in txFor(detailArmada.nopol)" :key="t.id">
            <td>{{ new Date(t.tanggal).toLocaleDateString("id-ID") }}</td>
            <td>{{ t.kategori }}</td>
            <td class="num mono">{{ rupiah(t.nominal) }}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-ghost btn-sm" @click="openEditTx(t)">Edit</button>
              <button class="btn btn-ghost btn-sm" @click="removeTx(t)">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="msub" style="margin-top:12px;">
        Pendapatan kendaraan ini (Hasil Mobil &amp; Uang Jalan) otomatis tercatat juga sebagai
        pengeluaran "Sewa Armada &amp; Excavator" di Laporan Divisi Supplier.
      </div>
    </div>
  </div>

  <!-- Modal catat/edit transaksi cepat -->
  <div v-if="showTxModal" class="modal-bg" @click.self="showTxModal = false">
    <div class="modal">
      <button class="modal-close" @click="showTxModal = false">×</button>
      <h2>{{ editingTxId ? "Edit" : "Catat" }} Transaksi &mdash; {{ detailArmada?.nopol }}</h2>

      <div class="field">
        <label>Kelompok</label>
        <select v-model="txForm.kelompok" @change="txForm.kategori = ''; txForm.kategoriCustom = false;">
          <option v-for="k in KELOMPOK_OPTIONS" :key="k.key" :value="k.key">{{ k.label }}</option>
        </select>
      </div>

      <div class="field">
        <label>Kategori / Kolom</label>
        <select :value="txForm.kategoriCustom ? CUSTOM_OPT : txForm.kategori" @change="onTxKategoriSelect($event.target.value)">
          <option value="" disabled>Pilih kategori</option>
          <option v-for="k in kategoriOptionsAktif" :key="k" :value="k">{{ k }}</option>
          <option :value="CUSTOM_OPT">+ Kolom baru (ketik manual)</option>
        </select>
        <input
          v-if="txForm.kategoriCustom"
          v-model="txForm.kategori"
          placeholder="Nama kolom/kategori baru, mis. Uang Tol, Denda, dst"
          style="margin-top:6px;"
        />
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
.armada-sopir {
  font-weight: 600;
  color: var(--ink);
}
.armada-divisi {
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: 6px;
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
