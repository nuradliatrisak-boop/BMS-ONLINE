<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const showModal = ref(false);
const loading = ref(true);
const editingId = ref(null);

const emptyForm = () => ({
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

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(m) {
  editingId.value = m.id;
  form.value = {
    nama: m.nama,
    satuan: m.satuan,
    hargaSatuan: m.hargaSatuan,
    divisi: m.divisi,
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nama || !form.value.satuan) {
    return toast("Nama dan satuan wajib diisi");
  }

  try {
    if (editingId.value) {
      await api.put(`/material/${editingId.value}`, form.value);
      toast("Material berhasil diperbarui");
    } else {
      await api.post("/material", form.value);
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

onMounted(load);
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
            <th>Nama Material</th>
            <th>Satuan</th>
            <th class="num">Harga Satuan</th>
            <th>Divisi</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="m in list" :key="m.id">
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
          <label>Nama Material</label>

          <input
            v-model="form.nama"
            placeholder="Contoh: Batu Split"
          />
        </div>

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