<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const stockMasterList = ref([]); // daftar kode master (sama yang dipakai di Surat Jalan)
const showModal = ref(false);
const loading = ref(true);
const editingId = ref(null);

// Tambah/kelola kode di dalam form Material, sama seperti pola "Kode Stock"
// di menu Customers (dropdown -> "+ kode belum ada" -> "kelola kode")
const showNewStock = ref(false);
const newStock = ref({ kode: "", nama: "" });
const showStockManager = ref(false);

const emptyForm = () => ({
  kode: "",
  nama: "",
  satuan: "",
  hargaSatuan: 0,
  divisi: DIVISI[0],
});

const form = ref(emptyForm());

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

async function load() {
  loading.value = true;

  try {
    list.value = await api.get("/material");
  } catch (e) {
    toast(e.message || "Gagal memuat data material");
  } finally {
    loading.value = false;
  }
}

async function loadStockMaster() {
  try {
    stockMasterList.value = await api.get("/stock-master?all=1");
  } catch (e) {
    console.error(e);
  }
}

// Waktu kode dipilih dari dropdown, otomatis isi Nama Material kalau
// nama-nya masih kosong (biar tidak menimpa nama yang sudah diketik user)
function onKodeChange() {
  if (form.value.nama) return;
  const found = stockMasterList.value.find((s) => s.kode === form.value.kode);
  if (found) form.value.nama = found.nama;
}

async function saveNewStock() {
  if (!newStock.value.kode.trim() || !newStock.value.nama.trim()) {
    return toast("Kode dan nama wajib diisi");
  }
  try {
    const created = await api.post("/stock-master", newStock.value);
    toast("Kode baru berhasil ditambahkan");
    await loadStockMaster();
    form.value.kode = created.kode;
    if (!form.value.nama) form.value.nama = created.nama;
    newStock.value = { kode: "", nama: "" };
    showNewStock.value = false;
  } catch (e) {
    toast(e?.message || "Gagal menambahkan kode");
  }
}

async function updateStock(item) {
  try {
    await api.put(`/stock-master/${item.id}`, { kode: item.kode, nama: item.nama });
    toast("Kode berhasil diperbarui");
    await loadStockMaster();
  } catch (e) {
    toast(e?.message || "Gagal memperbarui kode");
  }
}

async function deleteStock(item) {
  if (!confirm(`Hapus kode ${item.kode} - ${item.nama} dari daftar?`)) return;
  try {
    await api.delete(`/stock-master/${item.id}`);
    toast("Kode berhasil dihapus");
    await loadStockMaster();
  } catch (e) {
    toast(e?.message || "Gagal menghapus kode");
  }
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  showNewStock.value = false;
  showStockManager.value = false;
  showModal.value = true;
}

function openEdit(m) {
  editingId.value = m.id;
  form.value = {
    kode: m.kode || "",
    nama: m.nama,
    satuan: m.satuan,
    hargaSatuan: m.hargaSatuan,
    divisi: m.divisi,
  };
  showNewStock.value = false;
  showStockManager.value = false;
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nama || !form.value.satuan) {
    return toast("Nama dan satuan wajib diisi");
  }

  const payload = { ...form.value, kode: form.value.kode?.trim() || null };

  try {
    if (editingId.value) {
      await api.put(`/material/${editingId.value}`, payload);
      toast("Material berhasil diperbarui");
    } else {
      await api.post("/material", payload);
      toast("Material berhasil ditambahkan");
    }

    showModal.value = false;

    await load();
  } catch (e) {
    toast(e.message || "Gagal menyimpan material");
  }
}

async function remove(id) {
  if (!confirm("Hapus material ini?")) return;

  try {
    await api.delete(`/material/${id}`);

    toast("Material berhasil dihapus");
    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus material");
  }
}

onMounted(() => {
  load();
  loadStockMaster();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Material</h1>
      <div class="desc">
        Daftar barang dan material operasional per divisi
      </div>
    </div>

    <button class="btn btn-primary" @click="openModal">
      + Tambah Material
    </button>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">
      Memuat data…
    </div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">📦</div>
      <div>Belum ada material terdaftar.</div>

      <button
        class="btn btn-primary"
        style="margin-top:14px;"
        @click="openModal"
      >
        + Tambah Material
      </button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Material
        <span class="tag">{{ list.length }} Material</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Kode</th>
            <th>Nama Material</th>
            <th>Satuan</th>
            <th class="num">Harga Satuan</th>
            <th>Divisi</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="m in list" :key="m.id">
            <td class="mono">
              {{ m.kode || "-" }}
            </td>
            <td>
              {{ m.nama }}
            </td>

            <td>
              {{ m.satuan }}
            </td>

            <td class="num mono">
              {{ rupiah(m.hargaSatuan) }}
            </td>

            <td>
              {{ m.divisi }}
            </td>

            <td style="text-align:right;">
              <button
                class="btn btn-sm btn-ghost"
                style="margin-right:6px;"
                @click="openEdit(m)"
              >
                Edit
              </button>

              <button
                class="btn btn-sm btn-danger"
                @click="remove(m.id)"
              >
                Hapus
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div
    v-if="showModal"
    class="modal-bg"
    @click.self="closeModal"
  >
    <div class="modal">
      <button
        class="modal-close"
        @click="closeModal"
      >
        ×
      </button>

      <h2>{{ editingId ? "Edit Material" : "Tambah Material" }}</h2>

      <div class="msub">
        {{ editingId ? "Perbarui data barang atau material" : "Isi data barang atau material baru" }}
      </div>

      <div class="row">
        <div class="field">
          <label>Kode Material (opsional)</label>

          <select v-model="form.kode" @change="onKodeChange">
            <option value="">Tanpa kode</option>
            <option
              v-for="s in stockMasterList.filter((x) => x.aktif !== false)"
              :key="s.id"
              :value="s.kode"
            >
              {{ s.kode }} — {{ s.nama }}
            </option>
          </select>
          <div class="stock-actions">
            <button type="button" class="link-btn" @click="showNewStock = !showNewStock">+ Kode belum ada di daftar?</button>
            <button type="button" class="link-btn" @click="showStockManager = !showStockManager">Kelola kode</button>
          </div>

          <div v-if="showNewStock" class="inline-add-box">
            <div class="row">
              <div class="field"><label>Kode Baru</label><input v-model="newStock.kode" placeholder="Contoh: BS" style="text-transform: uppercase" /></div>
              <div class="field"><label>Nama</label><input v-model="newStock.nama" placeholder="Contoh: Batu Split" /></div>
            </div>
            <button type="button" class="btn btn-sm btn-primary" @click="saveNewStock">Simpan Kode</button>
          </div>

          <div v-if="showStockManager" class="inline-add-box stock-manager">
            <div class="msub" style="margin-bottom: 8px">Edit nama atau hapus kode yang sudah ada.</div>
            <div class="stock-manage-row" v-for="s in stockMasterList" :key="s.id">
              <input v-model="s.kode" class="stock-kode-input" style="text-transform: uppercase" />
              <input v-model="s.nama" class="stock-nama-input" />
              <button type="button" class="btn btn-sm btn-ghost" @click="updateStock(s)">Simpan</button>
              <button type="button" class="btn btn-sm btn-danger" @click="deleteStock(s)">Hapus</button>
            </div>
          </div>
        </div>

        <div class="field">
          <label>Nama Material</label>

          <input
            v-model="form.nama"
            placeholder="Contoh: Batu Split"
          />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Satuan</label>

          <input
            v-model="form.satuan"
            placeholder="m3, ton, unit"
          />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Harga Satuan</label>

          <input
            v-model.number="form.hargaSatuan"
            type="number"
            min="0"
            placeholder="0"
          />
        </div>

        <div class="field">
          <label>Divisi</label>

          <select v-model="form.divisi">
            <option
              v-for="d in DIVISI"
              :key="d"
              :value="d"
            >
              {{ d }}
            </option>
          </select>
        </div>
      </div>

      <div
        style="
          display:flex;
          gap:8px;
          justify-content:flex-end;
          margin-top:8px;
        "
      >
        <button
          class="btn btn-ghost"
          @click="closeModal"
        >
          Batal
        </button>

        <button
          class="btn btn-primary"
          @click="submit"
        >
          {{ editingId ? "Simpan Perubahan" : "Simpan Material" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stock-actions { display: flex; gap: 12px; margin-top: 5px; }
.link-btn { background: none; border: none; padding: 0; color: var(--bms-blue-dark, #1d4ed8); font-size: 11px; font-weight: 600; cursor: pointer; text-decoration: underline; }
.inline-add-box { background: #f7f9fc; border: 1px dashed var(--line); border-radius: 9px; padding: 12px; margin: 8px 0 4px; }
.stock-manager { max-height: 220px; overflow-y: auto; }
.stock-manage-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.stock-kode-input { width: 60px; flex-shrink: 0; }
.stock-nama-input { flex: 1; }
</style>