<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";
import MoneyInput from "../components/MoneyInput.vue";
import Material from "./Material.vue";
import { exportStokExcel } from "../utils/stokExport.js";

// Menu STOK (pengganti menu Material).
//   Tab "Kartu Stok"      : stok per barang (mis. Kubus Masif 11.000) + riwayat keluar/masuk + upah kuli
//   Tab "Daftar Material" : daftar material & harga lama (isi menu Material sebelumnya, tidak berubah)
const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const KATEGORI = ["Material", "Kubus", "Alat", "Lainnya"];

const route = useRoute();
const auth = useAuthStore();
const tab = ref(route.query.tab === "material" ? "material" : "kartu");
watch(() => route.query.tab, (t) => { tab.value = t === "material" ? "material" : "kartu"; });

const hariIni = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
const angka = (n) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString("id-ID");
const rupiah = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
function fmtTgl(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "-";
}

const list = ref([]);
const loading = ref(true);
const cari = ref("");
const customerNama = ref([]);

const tampil = computed(() => {
  const q = cari.value.trim().toLowerCase();
  if (!q) return list.value;
  return list.value.filter((s) => [s.nama, s.kategori, s.namaCustomer, s.proyek, s.divisi].some((x) => String(x || "").toLowerCase().includes(q)));
});

async function load() {
  loading.value = true;
  try {
    list.value = await api.get("/stok");
  } catch (e) {
    toast(e.message || "Gagal memuat stok");
  } finally {
    loading.value = false;
  }
}

// ---- Tambah / edit barang ----
const showForm = ref(false);
const editingId = ref(null);
const saving = ref(false);
const emptyForm = () => ({ nama: "", kategori: "Material", satuan: "", divisi: auth.user?.divisi || "Kontraktor", namaCustomer: "", proyek: "", qtyAwal: "", catatan: "" });
const form = ref(emptyForm());

function bukaBaru() {
  editingId.value = null;
  form.value = emptyForm();
  showForm.value = true;
}
function bukaEdit(s) {
  editingId.value = s.id;
  form.value = { nama: s.nama, kategori: s.kategori || "Material", satuan: s.satuan || "", divisi: s.divisi, namaCustomer: s.namaCustomer || "", proyek: s.proyek || "", qtyAwal: s.qtyAwal, catatan: s.catatan || "" };
  showForm.value = true;
}
async function simpanBarang() {
  if (!form.value.nama.trim()) return toast("Nama barang wajib diisi");
  saving.value = true;
  try {
    const body = { ...form.value, qtyAwal: Number(form.value.qtyAwal) || 0 };
    if (editingId.value) {
      const r = await api.put(`/stok/${editingId.value}`, body);
      if (detail.value?.id === r.id) detail.value = r;
      toast("Stok diperbarui");
    } else {
      await api.post("/stok", body);
      toast("Stok baru ditambahkan");
    }
    showForm.value = false;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan stok");
  } finally {
    saving.value = false;
  }
}
async function hapusBarang(s) {
  if (!confirm(`Hapus stok "${s.nama}" beserta seluruh riwayatnya? Upah kuli di Laporan Divisi ikut terhapus.`)) return;
  try {
    await api.delete(`/stok/${s.id}`);
    toast("Stok dihapus");
    detail.value = null;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus stok");
  }
}

// ---- Detail kartu stok ----
const detail = ref(null);
const emptyPeng = () => ({ tipe: "KELUAR", tanggal: hariIni(), qty: "", noSurat: "", catatan: "", upahKuli: "" });
const peng = ref(emptyPeng());
const pengSaving = ref(false);

async function bukaDetail(s) {
  try {
    detail.value = await api.get(`/stok/${s.id}`);
    peng.value = emptyPeng();
  } catch (e) {
    toast(e.message || "Gagal membuka stok");
  }
}
function tutupDetail() { detail.value = null; }

async function catat() {
  const d = detail.value;
  if (!(Number(peng.value.qty) > 0)) return toast("Jumlah harus lebih dari 0");
  if (!peng.value.tanggal) return toast("Tanggal wajib diisi");
  pengSaving.value = true;
  try {
    detail.value = await api.post(`/stok/${d.id}/mutasi`, { ...peng.value, qty: Number(peng.value.qty), upahKuli: peng.value.upahKuli === "" ? null : peng.value.upahKuli });
    peng.value = { ...emptyPeng(), tipe: peng.value.tipe, tanggal: peng.value.tanggal };
    toast("Tercatat");
    await load();
  } catch (e) {
    toast(e.message || "Gagal mencatat");
  } finally {
    pengSaving.value = false;
  }
}

const upahSaving = ref("");
async function ubahUpah(m) {
  const isi = prompt(`Upah kuli untuk baris ${fmtTgl(m.tanggal)}${m.noSurat ? " (SJ " + m.noSurat + ")" : ""} (Rp, kosongkan/0 untuk menghapus):`, m.upahKuli || "");
  if (isi === null) return;
  const bersih = Number(String(isi).replace(/[^\d]/g, ""));
  if (isi.trim() !== "" && !(bersih >= 0)) return toast("Upah kuli harus berupa angka");
  upahSaving.value = m.id;
  try {
    detail.value = await api.put(`/stok/${detail.value.id}/mutasi/${m.id}`, { upahKuli: isi.trim() === "" ? 0 : bersih });
    toast("Upah kuli disimpan");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan upah kuli");
  } finally {
    upahSaving.value = "";
  }
}
async function hapusMutasi(m) {
  if (!confirm("Hapus baris ini?")) return;
  try {
    detail.value = await api.delete(`/stok/${detail.value.id}/mutasi/${m.id}`);
    toast("Baris dihapus");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus");
  }
}

function excel() { exportStokExcel(detail.value); }

onMounted(async () => {
  load();
  try { customerNama.value = (await api.get("/customers")).map((c) => c.nama); } catch { /* saran nama customer opsional */ }
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Stok</h1>
      <div class="desc">Kartu stok barang (total, keluar, sisa, upah kuli) dan daftar material</div>
    </div>
    <button v-if="tab === 'kartu'" class="btn btn-primary" @click="bukaBaru">+ Tambah Stok</button>
  </div>

  <div class="content" :style="tab === 'material' ? 'padding-bottom: 0' : ''">
    <div class="stok-tab">
      <button :class="{ aktif: tab === 'kartu' }" @click="tab = 'kartu'">Kartu Stok</button>
      <button :class="{ aktif: tab === 'material' }" @click="tab = 'material'">Daftar Material</button>
    </div>

    <template v-if="tab === 'kartu'">
      <div v-if="loading" class="empty">Memuat data…</div>
      <div v-else-if="!list.length" class="empty">
        <div class="big">📦</div>
        <div>Belum ada stok. Klik “+ Tambah Stok” untuk mulai (mis. Kubus Masif, total 11000).</div>
      </div>
      <div v-else class="card">
        <div class="section-title">
          Kartu Stok
          <span class="tag">{{ tampil.length }} barang</span>
        </div>
        <input v-model="cari" class="stok-cari" placeholder="Cari barang, customer, proyek…" />
        <div style="overflow-x: auto">
          <table>
            <thead>
              <tr>
                <th>Barang</th>
                <th>Customer / Proyek</th>
                <th>Divisi</th>
                <th class="num">Total</th>
                <th class="num">Keluar</th>
                <th class="num">Sisa</th>
                <th class="num">Upah Kuli</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in tampil" :key="s.id">
                <td><b>{{ s.nama }}</b> <span class="tag">{{ s.kategori }}</span></td>
                <td>{{ [s.namaCustomer, s.proyek].filter(Boolean).join(" • ") || "-" }}</td>
                <td>{{ s.divisi }}</td>
                <td class="num mono">{{ angka(s.qtyAwal + s.masuk) }} {{ s.satuan }}</td>
                <td class="num mono">{{ angka(s.keluar) }}</td>
                <td class="num mono"><b>{{ angka(s.sisa) }}</b></td>
                <td class="num mono">{{ s.totalUpahKuli ? rupiah(s.totalUpahKuli) : "-" }}</td>
                <td style="text-align: right; white-space: nowrap">
                  <button class="btn btn-sm btn-primary" @click="bukaDetail(s)">Buka</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>

  <Material v-if="tab === 'material'" />

  <!-- Detail kartu stok -->
  <div v-if="detail" class="modal-bg" @click.self="tutupDetail">
    <div class="modal" style="max-width: 900px">
      <button class="modal-close" @click="tutupDetail">×</button>
      <h2>{{ detail.nama }}</h2>
      <div class="msub">
        {{ [detail.namaCustomer, detail.proyek, detail.divisi].filter(Boolean).join(" • ") }}
      </div>

      <div class="stok-kpi">
        <div><span>Total stok</span><b>{{ angka(detail.qtyAwal + detail.masuk) }} {{ detail.satuan }}</b></div>
        <div><span>Keluar</span><b>{{ angka(detail.keluar) }}</b></div>
        <div><span>Sisa</span><b>{{ angka(detail.sisa) }}</b></div>
        <div><span>Total upah kuli</span><b>{{ rupiah(detail.totalUpahKuli) }}</b></div>
      </div>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0">
        <button class="btn btn-sm" @click="excel">⬇ Kartu Stok Excel</button>
        <button class="btn btn-sm btn-ghost" @click="bukaEdit(detail)">Edit Barang</button>
        <button class="btn btn-sm btn-danger" @click="hapusBarang(detail)">Hapus Barang</button>
      </div>

      <div class="stok-box">
        <div class="stok-judul">Catat Keluar / Masuk</div>
        <div class="row">
          <div class="field">
            <label>Jenis</label>
            <select v-model="peng.tipe">
              <option value="KELUAR">Keluar (dikirim / dipakai)</option>
              <option value="MASUK">Masuk (tambah stok)</option>
            </select>
          </div>
          <div class="field">
            <label>Tanggal</label>
            <input type="date" v-model="peng.tanggal" />
          </div>
          <div class="field">
            <label>Jumlah</label>
            <input type="number" min="0" step="any" v-model="peng.qty" placeholder="0" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>No. Surat (opsional)</label>
            <input v-model="peng.noSurat" placeholder="No. surat jalan" />
          </div>
          <div class="field">
            <label>Catatan (opsional)</label>
            <input v-model="peng.catatan" placeholder="Mis. no. polisi, sopir" />
          </div>
          <div class="field">
            <label>Upah Kuli (Rp, opsional)</label>
            <MoneyInput v-model="peng.upahKuli" placeholder="0" />
          </div>
        </div>
        <button class="btn btn-primary btn-sm" :disabled="pengSaving" @click="catat">
          {{ pengSaving ? "Menyimpan…" : "+ Catat" }}
        </button>
      </div>

      <div class="stok-judul" style="margin-top: 14px">Riwayat</div>
      <div v-if="!detail.mutasi.length" class="msub">Belum ada pengeluaran / penambahan.</div>
      <div v-else style="overflow-x: auto">
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Tanggal</th>
              <th>No. Surat</th>
              <th class="num">Qty</th>
              <th class="num">Sisa</th>
              <th class="num">Upah Kuli</th>
              <th>Catatan</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in detail.mutasi" :key="m.id">
              <td>{{ m.no }}</td>
              <td>{{ fmtTgl(m.tanggal) }}</td>
              <td class="mono">{{ m.noSurat || "-" }}</td>
              <td class="num mono">{{ m.tipe === "MASUK" ? "+" : "-" }}{{ angka(m.qty) }}</td>
              <td class="num mono">{{ angka(m.sisa) }}</td>
              <td class="num mono">
                <a href="#" title="Klik untuk isi / ubah upah kuli" @click.prevent="ubahUpah(m)">{{ m.upahKuli ? rupiah(m.upahKuli) : "+ isi" }}</a>
              </td>
              <td>{{ m.catatan || "-" }}</td>
              <td style="text-align: right"><button class="btn btn-sm btn-danger" @click="hapusMutasi(m)">Hapus</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Form tambah / edit barang -->
  <div v-if="showForm" class="modal-bg" @click.self="showForm = false">
    <div class="modal">
      <button class="modal-close" @click="showForm = false">×</button>
      <h2>{{ editingId ? "Edit Stok" : "Tambah Stok" }}</h2>
      <div class="msub">Isi barang dan total stoknya. Pengeluaran dicatat setelah ini lewat tombol “Buka”.</div>

      <div class="row">
        <div class="field">
          <label>Nama Barang</label>
          <input v-model="form.nama" placeholder="Contoh: Kubus Masif" />
        </div>
        <div class="field">
          <label>Kategori</label>
          <input v-model="form.kategori" list="stok-kategori" placeholder="Material" />
          <datalist id="stok-kategori"><option v-for="k in KATEGORI" :key="k" :value="k" /></datalist>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Total Stok</label>
          <input type="number" min="0" step="any" v-model="form.qtyAwal" placeholder="Contoh: 11000" />
        </div>
        <div class="field">
          <label>Satuan</label>
          <input v-model="form.satuan" placeholder="BH, m3, sak, pcs" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Customer (opsional)</label>
          <input v-model="form.namaCustomer" list="stok-customer" placeholder="Contoh: PT. Trans Cilegon" />
          <datalist id="stok-customer"><option v-for="n in customerNama" :key="n" :value="n" /></datalist>
        </div>
        <div class="field">
          <label>Proyek (opsional)</label>
          <input v-model="form.proyek" placeholder="Contoh: Tanggul Dermaga" />
        </div>
      </div>
      <div class="row">
        <div class="field" v-if="auth.isAdmin">
          <label>Divisi</label>
          <select v-model="form.divisi"><option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option></select>
        </div>
        <div class="field">
          <label>Catatan (opsional)</label>
          <input v-model="form.catatan" />
        </div>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px">
        <button class="btn btn-ghost" @click="showForm = false">Batal</button>
        <button class="btn btn-primary" :disabled="saving" @click="simpanBarang">{{ saving ? "Menyimpan…" : editingId ? "Simpan Perubahan" : "Simpan Stok" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stok-tab {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
}
.stok-tab button {
  font: inherit;
  font-size: 13px;
  padding: 6px 16px;
  border: 0;
  background: #fff;
  cursor: pointer;
  color: var(--ink-soft);
}
.stok-tab button.aktif {
  background: #2459a6;
  color: #fff;
  font-weight: 700;
}
.stok-cari { width: 100%; max-width: 340px; margin-bottom: 10px; }
.stok-kpi {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 10px 0;
}
.stok-kpi > div {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px;
}
.stok-kpi span { display: block; font-size: 12px; color: var(--ink-soft); font-weight: 600; }
.stok-kpi b { font-size: 18px; font-variant-numeric: tabular-nums; }
.stok-box {
  background: #f7f9fc;
  border: 1px dashed var(--line);
  border-radius: 10px;
  padding: 12px;
  margin-top: 10px;
}
.stok-judul { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
</style>
