<script setup>
// Purchase Order (PO) -- pesanan barang dari customer.
// PO = pesanan saja: stok TIDAK berubah saat PO dibuat. Barang dikirim nyicil
// (sesuai permintaan lapangan), tiap pengiriman dicatat manual di sini (boleh
// diisi no. Surat Jalan sebagai referensi). Terkirim / sisa / status dihitung
// otomatis oleh server, dan PO yang belum selesai muncul di Pengingat Dashboard.
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";
import MoneyInput from "../components/MoneyInput.vue";

const auth = useAuthStore();
const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const customers = ref([]);
const loading = ref(true);
const filter = ref("terbuka"); // terbuka | semua | SELESAI | DIBATALKAN
const cari = ref("");

const showForm = ref(false);
const editingId = ref(null);
const saving = ref(false);

const detailId = ref(null);
const detail = computed(() => list.value.find((p) => p.id === detailId.value) || null);

const hariIni = () => new Date().toLocaleDateString("en-CA");

const emptyItem = () => ({ id: null, uraian: "", satuan: "m3", qty: "", hargaSatuan: "" });
const emptyForm = () => ({
  no: "",
  tanggal: hariIni(),
  customerId: "",
  namaCustomer: "",
  divisi: auth.isAdmin ? DIVISI[0] : auth.user?.divisi || DIVISI[0],
  proyek: "",
  lokasiProyek: "",
  kepalaProyek: "",
  penerimaBarang: "",
  ppnPersen: 0,
  catatan: "",
  items: [emptyItem()],
});
const form = ref(emptyForm());

// Nomor PO: "otomatis" (dibuat server saat disimpan) atau "manual" (diketik, sesuai kertas PO customer).
// Pilihan terakhir diingat di browser masing-masing user.
const bacaMode = () => {
  try {
    return localStorage.getItem("po_mode_no") === "otomatis" ? "otomatis" : "manual";
  } catch {
    return "manual";
  }
};
const modeNo = ref(bacaMode());
const noPreview = ref("");
const pakaiOtomatis = computed(() => !editingId.value && modeNo.value === "otomatis");

async function muatPreview() {
  if (!pakaiOtomatis.value) return;
  try {
    const r = await api.get(`/po/nomor-berikutnya?tanggal=${form.value.tanggal || hariIni()}`);
    noPreview.value = r.no;
  } catch {
    noPreview.value = "";
  }
}
function setMode(m) {
  modeNo.value = m;
  try {
    localStorage.setItem("po_mode_no", m);
  } catch {
    /* abaikan */
  }
  muatPreview();
}
watch(
  () => form.value.tanggal,
  () => muatPreview()
);

const emptyPeng = () => ({ itemId: "", tanggal: hariIni(), qty: "", noSuratJalan: "", catatan: "" });
const peng = ref(emptyPeng());
const pengSaving = ref(false);

// ---------- format ----------
const rupiah = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const angka = (n) => (Number(n) || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const fmtTgl = (t) =>
  t
    ? new Date(t).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : "-";

const STATUS = {
  BARU: { label: "Belum Dikirim", cls: "badge b-belumttd" },
  SEBAGIAN: { label: "Sebagian", cls: "badge b-sebagian" },
  SELESAI: { label: "Selesai", cls: "badge b-lunas" },
  DIBATALKAN: { label: "Dibatalkan", cls: "badge b-belum" },
};
const statusLabel = (s) => STATUS[s]?.label || s;
const statusCls = (s) => STATUS[s]?.cls || "badge";
const terbuka = (p) => p.status === "BARU" || p.status === "SEBAGIAN";

// ---------- data ----------
async function load() {
  loading.value = true;
  try {
    list.value = await api.get("/po");
  } catch (e) {
    toast(e.message || "Gagal memuat data PO");
  } finally {
    loading.value = false;
  }
}

async function loadCustomers() {
  try {
    const r = await api.get("/customers");
    customers.value = (Array.isArray(r) ? r : []).filter((c) => c.aktif !== false);
  } catch (e) {
    console.error(e);
  }
}

// ganti 1 PO di daftar dengan versi terbaru dari server
function simpanKeList(po) {
  const i = list.value.findIndex((p) => p.id === po.id);
  if (i >= 0) list.value[i] = po;
  else list.value.unshift(po);
}

// ---------- daftar & filter ----------
const jumlah = computed(() => ({
  terbuka: list.value.filter(terbuka).length,
  baru: list.value.filter((p) => p.status === "BARU").length,
  sebagian: list.value.filter((p) => p.status === "SEBAGIAN").length,
  selesai: list.value.filter((p) => p.status === "SELESAI").length,
  batal: list.value.filter((p) => p.status === "DIBATALKAN").length,
  semua: list.value.length,
}));

const tampil = computed(() => {
  let rows = list.value;
  if (filter.value === "terbuka") rows = rows.filter(terbuka);
  else if (filter.value !== "semua") rows = rows.filter((p) => p.status === filter.value);
  const q = cari.value.trim().toLowerCase();
  if (q) {
    rows = rows.filter((p) =>
      [p.no, p.namaCustomerTampil, p.proyek, p.lokasiProyek].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }
  // yang paling lama menunggu di atas supaya tidak terlupa
  if (filter.value === "terbuka") rows = [...rows].sort((a, b) => b.hariTunggu - a.hariTunggu);
  return rows;
});

// ---------- form PO ----------
function openForm() {
  editingId.value = null;
  form.value = emptyForm();
  noPreview.value = "";
  showForm.value = true;
  muatPreview();
}

function openEdit(p) {
  editingId.value = p.id;
  form.value = {
    no: p.no,
    tanggal: String(p.tanggal).slice(0, 10),
    customerId: p.customerId || "",
    namaCustomer: p.namaCustomer || "",
    divisi: p.divisi,
    proyek: p.proyek || "",
    lokasiProyek: p.lokasiProyek || "",
    kepalaProyek: p.kepalaProyek || "",
    penerimaBarang: p.penerimaBarang || "",
    ppnPersen: p.ppnPersen || 0,
    catatan: p.catatan || "",
    items: p.items.map((it) => ({
      id: it.id,
      uraian: it.uraian,
      satuan: it.satuan || "",
      qty: it.qty,
      hargaSatuan: it.hargaSatuan,
    })),
  };
  if (!form.value.items.length) form.value.items.push(emptyItem());
  showForm.value = true;
}

function tambahBaris() {
  form.value.items.push(emptyItem());
}
function hapusBaris(i) {
  const it = form.value.items[i];
  if (it.id) {
    const asli = detailAsli(editingId.value)?.items.find((x) => x.id === it.id);
    if (asli && asli.terkirim > 0) {
      return toast("Barang ini sudah ada pengirimannya, tidak bisa dihapus dari PO");
    }
  }
  form.value.items.splice(i, 1);
  if (!form.value.items.length) form.value.items.push(emptyItem());
}
const detailAsli = (id) => list.value.find((p) => p.id === id);

const subtotalForm = computed(() =>
  form.value.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.hargaSatuan) || 0), 0)
);
const ppnForm = computed(() => (subtotalForm.value * (Number(form.value.ppnPersen) || 0)) / 100);

async function submit() {
  const f = form.value;
  if (!pakaiOtomatis.value && !f.no.trim()) return toast("Nomor PO wajib diisi");
  if (!f.tanggal) return toast("Tanggal PO wajib diisi");
  if (!f.customerId && !f.namaCustomer.trim()) return toast("Pilih customer atau ketik nama pemesan");

  const items = f.items.filter((it) => it.uraian.trim() || Number(it.qty) || Number(it.hargaSatuan));
  if (!items.length) return toast("Isi minimal 1 barang");
  for (const [i, it] of items.entries()) {
    if (!it.uraian.trim()) return toast(`Barang ke-${i + 1}: uraian wajib diisi`);
    if (!(Number(it.qty) > 0)) return toast(`Barang ke-${i + 1}: jumlah harus lebih dari 0`);
  }

  saving.value = true;
  try {
    const payload = { ...f, items, otomatis: pakaiOtomatis.value, no: pakaiOtomatis.value ? "" : f.no };
    let po;
    if (editingId.value) {
      po = await api.put(`/po/${editingId.value}`, payload);
      toast("PO berhasil diperbarui");
    } else {
      po = await api.post("/po", payload);
      toast(pakaiOtomatis.value ? `PO disimpan dengan nomor ${po.no}` : "PO berhasil disimpan");
    }
    simpanKeList(po);
    showForm.value = false;
    if (!editingId.value) {
      peng.value = emptyPeng();
      detailId.value = po.id; // langsung buka rincian, tinggal catat pengiriman nanti
    }
  } catch (e) {
    toast(e.message || "Gagal menyimpan PO");
  } finally {
    saving.value = false;
  }
}

// ---------- rincian & pengiriman ----------
function bukaDetail(p) {
  peng.value = emptyPeng();
  detailId.value = p.id;
}
function tutupDetail() {
  detailId.value = null;
}

async function catatPengiriman() {
  const p = detail.value;
  if (!p) return;
  const f = peng.value;
  if (!f.itemId) return toast("Pilih barang yang dikirim");
  if (!f.tanggal) return toast("Tanggal pengiriman wajib diisi");
  if (!(Number(f.qty) > 0)) return toast("Jumlah dikirim harus lebih dari 0");

  const item = p.items.find((it) => it.id === f.itemId);
  if (item && Number(f.qty) > item.sisa) {
    const ok = confirm(
      `Jumlah ${angka(f.qty)} ${item.satuan || ""} lebih besar dari sisa PO (${angka(item.sisa)} ${item.satuan || ""}). Tetap catat?`
    );
    if (!ok) return;
  }

  pengSaving.value = true;
  try {
    const po = await api.post(`/po/${p.id}/pengiriman`, f);
    simpanKeList(po);
    peng.value = { ...emptyPeng(), itemId: f.itemId };
    toast("Pengiriman dicatat");
  } catch (e) {
    toast(e.message || "Gagal mencatat pengiriman");
  } finally {
    pengSaving.value = false;
  }
}

async function hapusPengiriman(pid) {
  const p = detail.value;
  if (!p || !confirm("Hapus catatan pengiriman ini? Sisa PO akan bertambah lagi.")) return;
  try {
    simpanKeList(await api.delete(`/po/${p.id}/pengiriman/${pid}`));
    toast("Catatan pengiriman dihapus");
  } catch (e) {
    toast(e.message || "Gagal menghapus pengiriman");
  }
}

async function toggleBatal(p) {
  const batal = p.status !== "DIBATALKAN";
  if (!confirm(batal ? `Batalkan PO ${p.no}?` : `Aktifkan lagi PO ${p.no}?`)) return;
  try {
    simpanKeList(await api.patch(`/po/${p.id}/batal`, { batal }));
    toast(batal ? "PO dibatalkan" : "PO diaktifkan lagi");
  } catch (e) {
    toast(e.message || "Gagal mengubah status PO");
  }
}

async function hapusPo(p) {
  if (!confirm(`Hapus PO ${p.no} beserta semua catatan pengirimannya? Tidak bisa dikembalikan.`)) return;
  try {
    await api.delete(`/po/${p.id}`);
    list.value = list.value.filter((x) => x.id !== p.id);
    detailId.value = null;
    toast("PO dihapus");
  } catch (e) {
    toast(e.message || "Gagal menghapus PO");
  }
}

const namaItem = (p, itemId) => p.items.find((it) => it.id === itemId)?.uraian || "-";
const satuanItem = (p, itemId) => p.items.find((it) => it.id === itemId)?.satuan || "";

onMounted(() => {
  load();
  loadCustomers();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Purchase Order (PO)</h1>
      <div class="desc">
        Pesanan dari customer. Stok baru berkurang saat barang dikirim (Surat Jalan), bukan saat PO dibuat.
      </div>
    </div>
    <button class="btn btn-primary" @click="openForm">+ Input PO</button>
  </div>

  <div class="content">
    <div class="po-kpis">
      <button class="po-kpi" :class="{ aktif: filter === 'terbuka' }" style="--c: #c47b12" @click="filter = 'terbuka'">
        <div class="po-kpi-lbl">PO Belum Selesai</div>
        <div class="po-kpi-val">{{ jumlah.terbuka }}</div>
        <div class="po-kpi-sub">{{ jumlah.baru }} belum dikirim • {{ jumlah.sebagian }} sebagian</div>
      </button>
      <button class="po-kpi" :class="{ aktif: filter === 'SELESAI' }" style="--c: #159447" @click="filter = 'SELESAI'">
        <div class="po-kpi-lbl">Selesai</div>
        <div class="po-kpi-val">{{ jumlah.selesai }}</div>
        <div class="po-kpi-sub">semua barang sudah terkirim</div>
      </button>
      <button class="po-kpi" :class="{ aktif: filter === 'DIBATALKAN' }" style="--c: #8a94a6" @click="filter = 'DIBATALKAN'">
        <div class="po-kpi-lbl">Dibatalkan</div>
        <div class="po-kpi-val">{{ jumlah.batal }}</div>
        <div class="po-kpi-sub">tidak ikut pengingat</div>
      </button>
      <button class="po-kpi" :class="{ aktif: filter === 'semua' }" style="--c: #2459a6" @click="filter = 'semua'">
        <div class="po-kpi-lbl">Semua PO</div>
        <div class="po-kpi-val">{{ jumlah.semua }}</div>
        <div class="po-kpi-sub">&nbsp;</div>
      </button>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">📋</div>
      <div>Belum ada PO. Catat PO yang masuk supaya sisa barang yang belum dikirim tidak terlupa.</div>
      <button class="btn btn-primary" style="margin-top: 14px" @click="openForm">+ Input PO</button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        {{ { terbuka: "PO Belum Selesai", semua: "Semua PO", SELESAI: "PO Selesai", DIBATALKAN: "PO Dibatalkan" }[filter] }}
        <span class="tag">{{ tampil.length }} PO</span>
      </div>

      <div class="po-cari">
        <input v-model="cari" placeholder="Cari no. PO, customer, proyek…" />
      </div>

      <div v-if="!tampil.length" class="empty" style="padding: 24px 0">
        <div>Tidak ada PO di kategori ini.</div>
      </div>

      <div v-else style="overflow-x: auto">
        <table>
          <thead>
            <tr>
              <th>No. PO</th>
              <th>Tanggal</th>
              <th>Customer / Proyek</th>
              <th>Status</th>
              <th>Terkirim</th>
              <th>Menunggu</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in tampil" :key="p.id">
              <td class="mono">{{ p.no }}</td>
              <td>{{ fmtTgl(p.tanggal) }}</td>
              <td>
                <div>{{ p.namaCustomerTampil || "-" }}</div>
                <div class="po-sub">{{ p.proyek || "" }}</div>
              </td>
              <td>
                <span :class="statusCls(p.status)">{{ statusLabel(p.status) }}</span>
              </td>
              <td style="min-width: 150px">
                <div class="po-bar"><div class="po-bar-isi" :style="{ width: p.persen + '%' }"></div></div>
                <div class="po-sub">{{ angka(p.totalTerkirim) }} / {{ angka(p.totalQty) }} ({{ p.persen }}%)</div>
              </td>
              <td>
                <template v-if="terbuka(p)">
                  <b :class="{ 'po-lama': p.hariTunggu >= 7 }">{{ p.hariTunggu }} hari</b>
                  <div class="po-sub">{{ p.terakhirKirim ? "sejak kirim terakhir" : "sejak PO dibuat" }}</div>
                </template>
                <span v-else class="po-sub">-</span>
              </td>
              <td style="text-align: right; white-space: nowrap">
                <button class="btn btn-sm btn-primary" style="margin-right: 6px" @click="bukaDetail(p)">Rincian</button>
                <button class="btn btn-sm btn-ghost" @click="openEdit(p)">Edit</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ===== RINCIAN PO & PENGIRIMAN ===== -->
  <div v-if="detail" class="modal-bg" @click.self="tutupDetail">
    <div class="modal" style="max-width: 860px">
      <button class="modal-close" @click="tutupDetail">×</button>
      <h2>
        PO {{ detail.no }}
        <span :class="statusCls(detail.status)" style="margin-left: 8px">{{ statusLabel(detail.status) }}</span>
      </h2>
      <div class="msub">
        {{ detail.namaCustomerTampil }} • {{ fmtTgl(detail.tanggal) }}
        <template v-if="detail.proyek"> • {{ detail.proyek }}</template>
      </div>

      <div class="po-info">
        <div v-if="detail.lokasiProyek"><span>Lokasi</span>{{ detail.lokasiProyek }}</div>
        <div v-if="detail.kepalaProyek"><span>Kepala Proyek</span>{{ detail.kepalaProyek }}</div>
        <div v-if="detail.penerimaBarang"><span>Penerima Barang</span>{{ detail.penerimaBarang }}</div>
        <div v-if="detail.catatan"><span>Catatan</span>{{ detail.catatan }}</div>
      </div>

      <div v-if="terbuka(detail)" class="po-tunggu" :class="{ lama: detail.hariTunggu >= 7 }">
        Menunggu {{ detail.hariTunggu }} hari
        {{ detail.terakhirKirim ? "sejak pengiriman terakhir (" + fmtTgl(detail.terakhirKirim) + ")" : "sejak PO dibuat, belum ada pengiriman" }}
      </div>

      <div style="overflow-x: auto; margin-top: 10px">
        <table>
          <thead>
            <tr>
              <th>Barang</th>
              <th class="num">Dipesan</th>
              <th class="num">Terkirim</th>
              <th class="num">Sisa</th>
              <th class="num">Harga Satuan</th>
              <th class="num">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in detail.items" :key="it.id">
              <td>{{ it.uraian }}</td>
              <td class="num mono">{{ angka(it.qty) }} {{ it.satuan }}</td>
              <td class="num mono">{{ angka(it.terkirim) }}</td>
              <td class="num mono">
                <b :style="it.sisa > 0 ? 'color:#b45309' : 'color:#159447'">{{ angka(it.sisa) }}</b>
                <span v-if="it.lebih > 0" class="po-sub"> (lebih {{ angka(it.lebih) }})</span>
              </td>
              <td class="num mono">{{ rupiah(it.hargaSatuan) }}</td>
              <td class="num mono">{{ rupiah(it.nilai) }}</td>
            </tr>
            <tr v-if="detail.ppnPersen > 0">
              <td colspan="5" style="text-align: right">PPN {{ detail.ppnPersen }}%</td>
              <td class="num mono">{{ rupiah(detail.ppn) }}</td>
            </tr>
            <tr>
              <td colspan="5" style="text-align: right"><b>Total</b></td>
              <td class="num mono"><b>{{ rupiah(detail.total) }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Catat pengiriman manual -->
      <div v-if="detail.status !== 'DIBATALKAN'" class="po-box">
        <div class="po-box-judul">Catat Pengiriman</div>
        <div class="row">
          <div class="field">
            <label>Barang</label>
            <select v-model="peng.itemId">
              <option value="">Pilih barang…</option>
              <option v-for="it in detail.items" :key="it.id" :value="it.id">
                {{ it.uraian }} (sisa {{ angka(it.sisa) }} {{ it.satuan }})
              </option>
            </select>
          </div>
          <div class="field">
            <label>Tanggal Kirim</label>
            <input type="date" v-model="peng.tanggal" />
          </div>
          <div class="field">
            <label>Jumlah Dikirim</label>
            <input type="number" min="0" step="any" v-model="peng.qty" placeholder="0" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>No. Surat Jalan (opsional)</label>
            <input v-model="peng.noSuratJalan" placeholder="Boleh diisi nanti-nanti" />
          </div>
          <div class="field">
            <label>Catatan (opsional)</label>
            <input v-model="peng.catatan" placeholder="Mis. permintaan lapangan, no. polisi" />
          </div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="pengSaving" @click="catatPengiriman">
          {{ pengSaving ? "Menyimpan…" : "+ Catat Pengiriman" }}
        </button>
      </div>

      <div class="po-box-judul" style="margin-top: 14px">Riwayat Pengiriman</div>
      <div v-if="!detail.pengiriman.length" class="msub">Belum ada pengiriman untuk PO ini.</div>
      <div v-else style="overflow-x: auto">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Barang</th>
              <th class="num">Jumlah</th>
              <th>No. Surat Jalan</th>
              <th>Catatan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in detail.pengiriman" :key="x.id">
              <td>{{ fmtTgl(x.tanggal) }}</td>
              <td>{{ namaItem(detail, x.itemId) }}</td>
              <td class="num mono">{{ angka(x.qty) }} {{ satuanItem(detail, x.itemId) }}</td>
              <td class="mono">{{ x.noSuratJalan || "-" }}</td>
              <td>{{ x.catatan || "-" }}</td>
              <td style="text-align: right">
                <button class="btn btn-sm btn-danger" @click="hapusPengiriman(x.id)">Hapus</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="po-aksi">
        <button class="btn btn-sm btn-ghost" @click="openEdit(detail)">Edit PO</button>
        <button class="btn btn-sm btn-ghost" @click="toggleBatal(detail)">
          {{ detail.status === "DIBATALKAN" ? "Aktifkan Lagi" : "Batalkan PO" }}
        </button>
        <button class="btn btn-sm btn-danger" @click="hapusPo(detail)">Hapus PO</button>
      </div>
    </div>
  </div>

  <!-- ===== FORM INPUT / EDIT PO ===== -->
  <div v-if="showForm" class="modal-bg" @click.self="showForm = false">
    <div class="modal" style="max-width: 820px">
      <button class="modal-close" @click="showForm = false">×</button>
      <h2>{{ editingId ? "Edit PO" : "Input PO Manual" }}</h2>
      <div class="msub">Isi sesuai kertas PO dari customer.</div>

      <div class="row">
        <div class="field">
          <label>Nomor PO</label>
          <div v-if="!editingId" class="po-mode">
            <button type="button" :class="{ aktif: modeNo === 'otomatis' }" @click="setMode('otomatis')">Otomatis</button>
            <button type="button" :class="{ aktif: modeNo === 'manual' }" @click="setMode('manual')">Ketik manual</button>
          </div>
          <input v-if="!pakaiOtomatis" v-model="form.no" placeholder="Mis. 04/PJS-RUSUN ROROTAN/X/2026" />
          <input v-else :value="noPreview || 'Memuat…'" readonly />
          <div v-if="pakaiOtomatis" class="po-sub">
            Nomor dibuat otomatis saat disimpan (pola 001/BMS-PO/bulan/tahun). Nomor final bisa sedikit berbeda kalau ada yang menyimpan bersamaan.
          </div>
        </div>
        <div class="field">
          <label>Tanggal PO</label>
          <input type="date" v-model="form.tanggal" />
        </div>
        <div class="field" v-if="auth.isAdmin">
          <label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Customer (dari daftar)</label>
          <select v-model="form.customerId">
            <option value="">— tidak ada di daftar / ketik manual —</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.nama }}</option>
          </select>
        </div>
        <div class="field" v-if="!form.customerId">
          <label>Nama Pemesan (ketik manual)</label>
          <input v-model="form.namaCustomer" placeholder="Mis. CV Pagaria Jaya Sejahtera" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Nama Proyek</label>
          <input v-model="form.proyek" placeholder="Mis. Pemeliharaan Berkala Rusun Kawasan Rorotan" />
        </div>
        <div class="field">
          <label>Lokasi Proyek</label>
          <input v-model="form.lokasiProyek" placeholder="Mis. Rusun Rorotan Jakarta Utara" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Kepala Proyek</label>
          <input v-model="form.kepalaProyek" />
        </div>
        <div class="field">
          <label>Penerima Barang (nama &amp; HP)</label>
          <input v-model="form.penerimaBarang" placeholder="Mis. Richard 0813… / Ocha 0812…" />
        </div>
      </div>

      <div class="po-box-judul" style="margin-top: 6px">Barang yang Dipesan</div>
      <div class="po-item-head">
        <span>Uraian</span><span>Satuan</span><span>Jumlah</span><span>Harga Satuan</span><span></span>
      </div>
      <div v-for="(it, i) in form.items" :key="i" class="po-item-row">
        <input v-model="it.uraian" placeholder="Mis. Pasir Pasang (Colt Diesel)" />
        <input v-model="it.satuan" placeholder="m3" />
        <input type="number" min="0" step="any" v-model="it.qty" placeholder="0" />
        <MoneyInput v-model="it.hargaSatuan" placeholder="0" />
        <button type="button" class="btn btn-sm btn-ghost" @click="hapusBaris(i)" title="Hapus baris">✕</button>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" style="margin: 4px 0 10px" @click="tambahBaris">
        + Tambah Barang
      </button>

      <div class="row">
        <div class="field">
          <label>PPN (%) — isi 0 kalau tanpa PPN</label>
          <input type="number" min="0" max="100" step="any" v-model="form.ppnPersen" />
        </div>
        <div class="field">
          <label>Catatan</label>
          <input v-model="form.catatan" placeholder="Mis. Pengiriman sesuai permintaan lapangan" />
        </div>
      </div>

      <div class="po-total">
        <span>Harga {{ rupiah(subtotalForm) }}</span>
        <span v-if="Number(form.ppnPersen) > 0">PPN {{ rupiah(ppnForm) }}</span>
        <b>Total {{ rupiah(subtotalForm + ppnForm) }}</b>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px">
        <button class="btn btn-ghost" @click="showForm = false">Batal</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          {{ saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Simpan PO" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.po-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.po-kpi {
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: var(--card, #fff);
  border: 1px solid var(--line);
  border-left: 4px solid var(--c, #2459a6);
  border-radius: 12px;
  padding: 12px 14px;
  box-shadow: var(--shadow-sm);
}
.po-kpi.aktif {
  background: var(--bms-blue-soft, #eaf1fb);
  border-color: var(--c, #2459a6);
}
.po-kpi-lbl {
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 600;
}
.po-kpi-val {
  font-size: 24px;
  font-weight: 800;
  margin: 2px 0;
  font-variant-numeric: tabular-nums;
}
.po-kpi-sub {
  font-size: 12px;
  color: var(--ink-soft);
}
.po-mode {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 6px;
}
.po-mode button {
  font: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border: 0;
  background: #fff;
  cursor: pointer;
  color: var(--ink-soft);
}
.po-mode button.aktif {
  background: #2459a6;
  color: #fff;
  font-weight: 700;
}
.po-cari {
  margin-bottom: 10px;
}
.po-cari input {
  width: 100%;
  max-width: 360px;
}
.po-sub {
  font-size: 11px;
  color: var(--ink-soft);
}
.po-lama {
  color: #b91c1c;
}
.po-bar {
  height: 7px;
  background: #e6ebf3;
  border-radius: 99px;
  overflow: hidden;
  margin-bottom: 3px;
}
.po-bar-isi {
  height: 100%;
  background: #159447;
  border-radius: 99px;
}
.po-info {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 4px 16px;
  font-size: 13px;
  margin-top: 10px;
}
.po-info span {
  display: block;
  font-size: 11px;
  color: var(--ink-soft);
  font-weight: 600;
}
.po-tunggu {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 9px;
  background: #fff7e6;
  border-left: 4px solid #c8a04a;
  font-size: 13px;
}
.po-tunggu.lama {
  background: #fdecec;
  border-left-color: #c0392b;
}
.po-box {
  background: #f7f9fc;
  border: 1px dashed var(--line);
  border-radius: 10px;
  padding: 12px;
  margin-top: 14px;
}
.po-box-judul {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}
.po-aksi {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
  flex-wrap: wrap;
}
.po-item-head,
.po-item-row {
  display: grid;
  grid-template-columns: 3fr 0.8fr 1fr 1.4fr 40px;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.po-item-head {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-soft);
}
.po-total {
  display: flex;
  gap: 18px;
  justify-content: flex-end;
  flex-wrap: wrap;
  font-size: 13px;
  padding: 8px 0;
}
@media (max-width: 640px) {
  .po-item-head {
    display: none;
  }
  .po-item-row {
    grid-template-columns: 1fr 1fr;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .po-item-row > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
