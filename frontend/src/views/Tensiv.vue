<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

// Sama daftar kategori yang dipakai di form Invoice (InvoiceDetail.vue) &
// master rate Uang Makan Alat (Settings.vue) -- disengaja disamakan supaya
// "Kategori Alat" yang dipilih di sini otomatis ketemu rate uang makannya
// pas baris ini ditarik jadi item invoice.
const KATEGORI_ALAT_OPSI = ["Bucket", "Breker", "Longarm", "Diatas Air", "Mobilisasi"];

const list = ref([]);
const customers = ref([]);
const unitList = ref([]); // master AlatBeratUnit (buat datalist saran nama unit)
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);
const editingId = ref(null);

const searchQuery = ref("");
let searchDebounce = null;
function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => reloadList(), 350);
}

function rupiahJam(n) {
  const v = Number(n || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtTgl(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function baris() {
  return { mulai: "", sampai: "", totalJam: 0, keterangan: "" };
}

const emptyForm = () => ({
  customerId: "",
  unitAlat: "",
  typeAlat: "",
  kategoriAlat: "Bucket",
  pengawas: "",
  lokasi: "",
  tanggal: new Date().toISOString().slice(0, 10),
  waktuKerja: [baris()],
  waktuTidakKerja: [],
  keteranganLokasi: "",
  namaPengawasTTD: "",
  namaOperatorTTD: "",
  isDraft: false,
});
const form = ref(emptyForm());

const totalJamKerja = computed(() =>
  form.value.waktuKerja.reduce((s, r) => s + (Number(r.totalJam) || 0), 0)
);
const totalJamTidakKerja = computed(() =>
  form.value.waktuTidakKerja.reduce((s, r) => s + (Number(r.totalJam) || 0), 0)
);

function tambahBarisKerja() {
  form.value.waktuKerja.push(baris());
}
function hapusBarisKerja(i) {
  form.value.waktuKerja.splice(i, 1);
}
function tambahBarisIdle() {
  form.value.waktuTidakKerja.push(baris());
}
function hapusBarisIdle(i) {
  form.value.waktuTidakKerja.splice(i, 1);
}

async function reloadList() {
  loading.value = true;
  try {
    const q = searchQuery.value.trim();
    list.value = await api.get(`/tensiv${q ? `?search=${encodeURIComponent(q)}` : ""}`);
  } catch (e) {
    toast(e?.message || "Gagal memuat data Tensiv");
  } finally {
    loading.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const [tensivData, customerData, unitData] = await Promise.all([
      api.get("/tensiv"),
      api.get("/customers"),
      api.get("/alat-berat-unit"),
    ]);
    list.value = tensivData;
    customers.value = customerData;
    unitList.value = unitData;
  } catch (e) {
    toast(e?.message || "Gagal memuat data Tensiv");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(ts) {
  editingId.value = ts.id;
  form.value = {
    customerId: ts.customerId || "",
    unitAlat: ts.unitAlat || "",
    typeAlat: ts.typeAlat || "",
    kategoriAlat: ts.kategoriAlat || "Bucket",
    pengawas: ts.pengawas || "",
    lokasi: ts.lokasi || "",
    tanggal: ts.tanggal ? new Date(ts.tanggal).toISOString().slice(0, 10) : "",
    waktuKerja: Array.isArray(ts.waktuKerja) && ts.waktuKerja.length ? ts.waktuKerja.map((r) => ({ ...r })) : [baris()],
    waktuTidakKerja: Array.isArray(ts.waktuTidakKerja) ? ts.waktuTidakKerja.map((r) => ({ ...r })) : [],
    keteranganLokasi: ts.keteranganLokasi || "",
    namaPengawasTTD: ts.namaPengawasTTD || "",
    namaOperatorTTD: ts.namaOperatorTTD || "",
    isDraft: ts.isDraft,
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.tanggal) return toast("Tanggal wajib diisi");
  if (!form.value.unitAlat.trim()) return toast("Nama alat wajib diisi");

  saving.value = true;
  try {
    if (editingId.value) {
      await api.put(`/tensiv/${editingId.value}`, form.value);
      toast("Tensiv berhasil diperbarui");
    } else {
      await api.post("/tensiv", form.value);
      toast("Tensiv berhasil disimpan");
    }
    showModal.value = false;
    await reloadList();
  } catch (e) {
    toast(e?.message || "Gagal menyimpan Tensiv");
  } finally {
    saving.value = false;
  }
}

async function tandaiLengkap(ts) {
  try {
    await api.patch(`/tensiv/${ts.id}/ttd`, {});
    toast("Ditandai sudah lengkap ditandatangani");
    await reloadList();
  } catch (e) {
    toast(e?.message || "Gagal menandai");
  }
}

async function remove(id) {
  if (!confirm("Hapus Tensiv ini? Tidak bisa dihapus kalau sudah dipakai di sebuah Invoice.")) return;
  try {
    await api.delete(`/tensiv/${id}`);
    toast("Tensiv berhasil dihapus");
    await reloadList();
  } catch (e) {
    toast(e?.message || "Gagal menghapus Tensiv");
  }
}

function sudahDitagih(ts) {
  return !!ts.invoiceItemId || ts._count?.invoiceItems > 0;
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Tensiv (Daftar Kerja Harian)</h1>
      <div class="desc">
        Rekaman jam kerja alat berat per hari — versi digital dari kertas "Daftar Kerja Harian" yang
        ditandatangani Pengawas &amp; Operator. Nanti tinggal ditarik jadi baris invoice sewa alat berat
        di menu Invoice, tidak perlu diketik ulang.
      </div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Tambah Tensiv</button>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="margin:0; flex:1; min-width:220px;">
        <label>Cari (No / Unit / Kategori / Pengawas / Lokasi / Customer)</label>
        <input v-model="searchQuery" placeholder="Ketik kata kunci..." @input="onSearchInput" />
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🗒️</div>
      <div>Belum ada Tensiv tersimpan.</div>
      <button class="btn btn-primary" style="margin-top:14px;" @click="openModal">+ Tambah Tensiv</button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Tensiv
        <span class="tag">{{ list.length }} rekaman</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>No</th>
            <th>Tanggal</th>
            <th>Unit Alat</th>
            <th>Kategori</th>
            <th>Customer</th>
            <th class="num">Jam Kerja</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ts in list" :key="ts.id">
            <td class="mono">{{ ts.no || "-" }}</td>
            <td>{{ fmtTgl(ts.tanggal) }}</td>
            <td>{{ ts.unitAlat || "-" }}<span v-if="ts.typeAlat"> ({{ ts.typeAlat }})</span></td>
            <td>{{ ts.kategoriAlat || "-" }}</td>
            <td>{{ ts.customer?.nama || "-" }}</td>
            <td class="num mono">{{ rupiahJam(ts.totalJamKerja) }} jam</td>
            <td>
              <span v-if="ts.isDraft" class="tag">Draft</span>
              <span v-else-if="ts.statusTTD === 'LENGKAP'" class="tag">TTD Lengkap</span>
              <span v-else class="tag" style="font-weight:600;">Belum TTD</span>
            </td>
            <td style="text-align:right; white-space:nowrap;">
              <button
                v-if="ts.statusTTD !== 'LENGKAP'"
                class="btn btn-sm btn-gold"
                style="margin-right:6px;"
                @click="tandaiLengkap(ts)"
              >
                Tandai lengkap
              </button>
              <button class="btn btn-sm btn-ghost" style="margin-right:6px;" @click="openEdit(ts)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="remove(ts.id)">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="msub" style="margin-top:14px;">
      Tensiv yang belum ditandai "Draft" dan belum dipakai di invoice manapun akan otomatis muncul sebagai
      pilihan "Belum ditagih" saat menambah baris sewa alat berat di halaman Invoice.
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal" style="max-width:760px; width:96%;">
      <button class="modal-close" @click="closeModal">×</button>
      <h2>{{ editingId ? "Edit Tensiv" : "Tambah Tensiv" }}</h2>
      <div class="msub">Isi persis seperti kertas "Daftar Kerja Harian" fisiknya.</div>

      <div class="row">
        <div class="field">
          <label>Nama Alat</label>
          <input v-model="form.unitAlat" list="tensiv-unit-list" placeholder="mis. PC 200, Longarm" />
          <datalist id="tensiv-unit-list">
            <option v-for="u in unitList" :key="u.id" :value="u.nama" />
          </datalist>
        </div>
        <div class="field">
          <label>Type <span class="optional">(opsional)</span></label>
          <input v-model="form.typeAlat" placeholder="mis. 75" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Kategori Pemakaian</label>
          <select v-model="form.kategoriAlat">
            <option v-for="k in KATEGORI_ALAT_OPSI" :key="k" :value="k">{{ k }}</option>
          </select>
          <div class="field-hint">Dipakai buat cari otomatis rate uang makan operator saat ditarik ke invoice.</div>
        </div>
        <div class="field">
          <label>Tanggal</label>
          <input v-model="form.tanggal" type="date" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Pengawas</label>
          <input v-model="form.pengawas" placeholder="Nama pengawas" />
        </div>
        <div class="field">
          <label>Lokasi</label>
          <input v-model="form.lokasi" placeholder="mis. Waduk Cirocus" />
        </div>
      </div>

      <div class="field">
        <label>Customer <span class="optional">(opsional)</span></label>
        <select v-model="form.customerId">
          <option value="">— Belum ditentukan —</option>
          <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option>
        </select>
        <div class="field-hint">Isi kalau sudah tahu penagihannya ke customer mana, supaya muncul di daftar "belum ditagih" invoice customer tsb.</div>
      </div>

      <div class="section-title" style="margin-top:18px;">Waktu Kerja</div>
      <div v-for="(r, i) in form.waktuKerja" :key="'wk' + i" class="row row-3" style="align-items:flex-end;">
        <div class="field">
          <label>Mulai</label>
          <input v-model="r.mulai" type="time" />
        </div>
        <div class="field">
          <label>Sampai</label>
          <input v-model="r.sampai" type="time" />
        </div>
        <div class="field">
          <label>Total Jam</label>
          <input v-model.number="r.totalJam" type="number" min="0" step="0.5" />
        </div>
        <div class="field" style="flex:2; min-width:180px;">
          <label>Keterangan Untuk Alat <span class="optional">(opsional)</span></label>
          <input v-model="r.keterangan" placeholder="mis. Lembur buang tanah" />
        </div>
        <button class="btn btn-sm btn-danger" style="margin-bottom:14px;" @click="hapusBarisKerja(i)" :disabled="form.waktuKerja.length <= 1">×</button>
      </div>
      <button class="btn btn-sm btn-ghost" @click="tambahBarisKerja">+ Baris waktu kerja</button>
      <div class="msub" style="margin-top:6px;">Total jam kerja: <b>{{ rupiahJam(totalJamKerja) }} jam</b></div>

      <div class="section-title" style="margin-top:18px;">Waktu Tidak Kerja <span class="optional">(opsional)</span></div>
      <div v-for="(r, i) in form.waktuTidakKerja" :key="'wtk' + i" class="row row-3" style="align-items:flex-end;">
        <div class="field">
          <label>Mulai</label>
          <input v-model="r.mulai" type="time" />
        </div>
        <div class="field">
          <label>Sampai</label>
          <input v-model="r.sampai" type="time" />
        </div>
        <div class="field">
          <label>Total Jam</label>
          <input v-model.number="r.totalJam" type="number" min="0" step="0.5" />
        </div>
        <button class="btn btn-sm btn-danger" style="margin-bottom:14px;" @click="hapusBarisIdle(i)">×</button>
      </div>
      <button class="btn btn-sm btn-ghost" @click="tambahBarisIdle">+ Baris waktu tidak kerja</button>
      <div class="msub" style="margin-top:6px;" v-if="form.waktuTidakKerja.length">
        Total jam tidak kerja: <b>{{ rupiahJam(totalJamTidakKerja) }} jam</b>
      </div>

      <div class="field" style="margin-top:18px;">
        <label>Keterangan Lokasi <span class="optional">(opsional)</span></label>
        <input v-model="form.keteranganLokasi" placeholder="Catatan bebas kolom keterangan lokasi" />
      </div>

      <div class="row">
        <div class="field">
          <label>Nama Pengawas (TTD) <span class="optional">(opsional)</span></label>
          <input v-model="form.namaPengawasTTD" placeholder="Nama yang menandatangani" />
        </div>
        <div class="field">
          <label>Nama Operator/Supir (TTD) <span class="optional">(opsional)</span></label>
          <input v-model="form.namaOperatorTTD" placeholder="Nama yang menandatangani" />
        </div>
      </div>

      <label class="draft-check">
        <input v-model="form.isDraft" type="checkbox" />
        <div>
          <div>Simpan sebagai draft</div>
          <div class="draft-check-sub">
            Draft belum dianggap final (mis. kertasnya belum ditandatangani/dikumpulkan) — tidak akan
            muncul di daftar "belum ditagih" saat bikin invoice sampai draft-nya dilepas.
          </div>
        </div>
      </label>

      <div style="display:flex; gap:8px; justify-content:space-between; margin-top:8px;">
        <button v-if="editingId" class="btn btn-danger" @click="remove(editingId); closeModal()">Hapus Tensiv</button>
        <div style="display:flex; gap:8px; margin-left:auto;">
          <button class="btn btn-ghost" @click="closeModal">Batal</button>
          <button class="btn btn-primary" :disabled="saving" @click="submit">Simpan Tensiv</button>
        </div>
      </div>
    </div>
  </div>
</template>
