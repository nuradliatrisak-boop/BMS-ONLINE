<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const showModal = ref(false);
const loading = ref(true);

const emptyForm = () => ({
  nopol: "",
  jenis: "",
  sopir: "",
  divisi: DIVISI[0],
});

const form = ref(emptyForm());

async function load() {
  loading.value = true;

  try {
    list.value = await api.get("/armada");
  } catch (e) {
    toast(e.message || "Gagal memuat data armada");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  form.value = emptyForm();
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nopol || !form.value.jenis) {
    return toast("Nomor polisi dan jenis armada wajib diisi");
  }

  try {
    await api.post("/armada", form.value);

    toast("Armada berhasil ditambahkan");
    showModal.value = false;

    await load();
  } catch (e) {
    toast(e.message || "Gagal menambahkan armada");
  }
}

async function remove(id) {
  if (!confirm("Hapus armada ini?")) return;

  try {
    await api.delete(`/armada/${id}`);
    toast("Armada berhasil dihapus");

    await load();
  } catch (e) {
    toast(e.message || "Gagal menghapus armada");
  }
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Armada</h1>
      <div class="desc">
        Kendaraan dan alat operasional perusahaan
      </div>
    </div>

    <button class="btn btn-primary" @click="openModal">
      + Tambah Armada
    </button>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">
      Memuat data…
    </div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🚚</div>
      <div>Belum ada armada terdaftar.</div>

      <button
        class="btn btn-primary"
        style="margin-top:14px;"
        @click="openModal"
      >
        + Tambah Armada
      </button>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Armada
        <span class="tag">{{ list.length }} Armada</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>No. Polisi</th>
            <th>Jenis Armada</th>
            <th>Sopir</th>
            <th>Divisi</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="a in list" :key="a.id">
            <td class="mono">
              {{ a.nopol }}
            </td>

            <td>
              {{ a.jenis }}
            </td>

            <td>
              {{ a.sopir || "-" }}
            </td>

            <td>
              {{ a.divisi }}
            </td>

            <td style="text-align:right;">
              <button
                class="btn btn-sm btn-danger"
                @click="remove(a.id)"
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

      <h2>Tambah Armada</h2>

      <div class="msub">
        Isi data kendaraan atau alat operasional baru
      </div>

      <div class="row">
        <div class="field">
          <label>Nomor Polisi</label>
          <input
            v-model="form.nopol"
            placeholder="Contoh: B 1234 XYZ"
          />
        </div>

        <div class="field">
          <label>Jenis Armada</label>
          <input
            v-model="form.jenis"
            placeholder="Truk, Dump Truck, Excavator, dll"
          />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Sopir / Operator</label>
          <input
            v-model="form.sopir"
            placeholder="Nama sopir / operator"
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

      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
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
          Simpan Armada
        </button>
      </div>
    </div>
  </div>
</template>