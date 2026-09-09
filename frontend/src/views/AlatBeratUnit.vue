<script setup>
// Halaman ini KHUSUS data unit Alat Berat/Excavator + dokumen
// kelengkapannya (Invoice, SIA, SIO, Foto Excavator). Beda dengan
// AlatBerat.vue (menu "Alat Berat" di sidebar) yang isinya rekap
// keuangan (pendapatan/pengeluaran) per unit dari Laporan Divisi.
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import DokumenAsetPanel from "../components/DokumenAsetPanel.vue";

const list = ref([]);
const loading = ref(true);

const showTambah = ref(false);
const tambahForm = ref({ nama: "", jenis: "Excavator", divisi: "Alat Berat" });

async function load() {
  loading.value = true;
  try {
    list.value = await api.get("/alat-berat-unit?all=1");
  } catch (e) {
    toast(e.message || "Gagal memuat data unit alat berat");
  } finally {
    loading.value = false;
  }
}

function bukaTambah() {
  tambahForm.value = { nama: "", jenis: "Excavator", divisi: "Alat Berat" };
  showTambah.value = true;
}

async function simpanTambah() {
  if (!tambahForm.value.nama.trim()) return toast("Nama unit wajib diisi");
  try {
    await api.post("/alat-berat-unit", tambahForm.value);
    toast("Unit berhasil ditambahkan");
    showTambah.value = false;
    await load();
  } catch (e) {
    toast(e.message || "Gagal menambahkan unit");
  }
}

const showDetail = ref(false);
const detail = ref(null);
const detailForm = ref({ nama: "", jenis: "", divisi: "", aktif: true });

function openDetail(u) {
  detail.value = u;
  detailForm.value = { nama: u.nama, jenis: u.jenis || "", divisi: u.divisi, aktif: u.aktif };
  showDetail.value = true;
}
function closeDetail() {
  showDetail.value = false;
  detail.value = null;
}

async function simpanDetail() {
  if (!detailForm.value.nama.trim()) return toast("Nama unit wajib diisi");
  try {
    await api.put(`/alat-berat-unit/${detail.value.id}`, detailForm.value);
    toast("Data unit diperbarui");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan data unit");
  }
}

async function hapusUnit() {
  if (!confirm(`Hapus unit "${detail.value.nama}"? Semua dokumen kelengkapannya juga akan terhapus.`)) return;
  try {
    await api.delete(`/alat-berat-unit/${detail.value.id}`);
    toast("Unit dihapus");
    closeDetail();
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus unit");
  }
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Dokumen Alat Berat</h1>
      <div class="desc">Data unit Excavator/Alat Berat beserta dokumen kelengkapannya</div>
    </div>
    <button class="btn btn-primary" @click="bukaTambah">+ Tambah Unit</button>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🏗️</div>
      <div>Belum ada unit alat berat terdaftar.</div>
      <button class="btn btn-primary" style="margin-top:14px;" @click="bukaTambah">+ Tambah Unit</button>
    </div>

    <div v-else class="armada-grid">
      <div v-for="u in list" :key="u.id" class="card armada-card" @click="openDetail(u)">
        <div class="armada-card-top">
          <div class="armada-nopol mono">{{ u.nama }}</div>
          <span class="tag" v-if="!u.aktif">Nonaktif</span>
        </div>
        <div class="armada-sopir">{{ u.jenis || "-" }}</div>
        <div class="armada-divisi">Divisi {{ u.divisi }}</div>
        <div class="armada-hint">Klik untuk edit &amp; kelola dokumen →</div>
      </div>
    </div>
  </div>

  <!-- Modal Tambah -->
  <div v-if="showTambah" class="modal-bg" @click.self="showTambah = false">
    <div class="modal">
      <button class="modal-close" @click="showTambah = false">×</button>
      <h2>Tambah Unit Alat Berat</h2>
      <div class="msub">Isi data dasar dulu, dokumen kelengkapan bisa diisi belakangan</div>

      <div class="row">
        <div class="field">
          <label>Nama Unit</label>
          <input v-model="tambahForm.nama" placeholder="Contoh: Excavator PC200-01" />
        </div>
        <div class="field">
          <label>Jenis</label>
          <input v-model="tambahForm.jenis" placeholder="Excavator, Bulldozer, dst" />
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
        <button class="btn btn-ghost" @click="showTambah = false">Batal</button>
        <button class="btn btn-primary" @click="simpanTambah">Simpan Unit</button>
      </div>
    </div>
  </div>

  <!-- Modal Detail: edit data + dokumen kelengkapan -->
  <div v-if="showDetail && detail" class="modal-bg" @click.self="closeDetail">
    <div class="modal" style="max-width: 640px;">
      <button class="modal-close" @click="closeDetail">×</button>
      <h2>{{ detail.nama }}</h2>
      <div class="msub">Edit data unit &amp; kelola dokumen kelengkapan</div>

      <div class="row">
        <div class="field">
          <label>Nama Unit</label>
          <input v-model="detailForm.nama" />
        </div>
        <div class="field">
          <label>Jenis</label>
          <input v-model="detailForm.jenis" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Divisi</label>
          <input v-model="detailForm.divisi" />
        </div>
        <div class="field">
          <label>Status</label>
          <select v-model="detailForm.aktif">
            <option :value="true">Aktif</option>
            <option :value="false">Nonaktif</option>
          </select>
        </div>
      </div>
      <div style="display:flex; gap:8px; justify-content:space-between; margin-bottom: 14px;">
        <button class="btn btn-danger btn-sm" @click="hapusUnit">Hapus Unit</button>
        <button class="btn btn-primary btn-sm" @click="simpanDetail">Simpan Perubahan</button>
      </div>

      <div class="section-title" style="margin-top: 4px;">Dokumen Kelengkapan</div>
      <DokumenAsetPanel aset-tipe="ALAT_BERAT" :aset-id="detail.id" />
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
.armada-hint {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 8px;
}
</style>
