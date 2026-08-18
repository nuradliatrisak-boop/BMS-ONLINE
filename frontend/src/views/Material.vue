<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const showModal = ref(false);
const loading = ref(true);
const form = ref({ nama: "", satuan: "", hargaSatuan: 0, divisi: DIVISI[0] });

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

async function load() {
  loading.value = true;
  list.value = await api.get("/material");
  loading.value = false;
}

function openModal() {
  form.value = { nama: "", satuan: "", hargaSatuan: 0, divisi: DIVISI[0] };
  showModal.value = true;
}

async function submit() {
  if (!form.value.nama || !form.value.satuan) return toast("Nama dan satuan wajib diisi");
  await api.post("/material", form.value);
  toast("Material ditambahkan");
  showModal.value = false;
  await load();
}

async function remove(id) {
  if (!confirm("Hapus material ini?")) return;
  await api.delete(`/material/${id}`);
  toast("Material dihapus");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Material</h1>
      <div class="desc">Daftar barang / material per divisi</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Tambah Material</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!list.length" class="empty">
      <div class="big">📦</div>
      Belum ada material terdaftar.
    </div>
    <div v-else class="card">
      <table>
        <thead>
          <tr><th>Nama</th><th>Satuan</th><th class="num">Harga Satuan</th><th>Divisi</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="m in list" :key="m.id">
            <td>{{ m.nama }}</td>
            <td>{{ m.satuan }}</td>
            <td class="num mono">{{ rupiah(m.hargaSatuan) }}</td>
            <td>{{ m.divisi }}</td>
            <td><button class="btn btn-sm btn-danger" @click="remove(m.id)">Hapus</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Tambah Material</h2>
      <div class="row">
        <div class="field"><label>Nama</label><input v-model="form.nama" /></div>
        <div class="field"><label>Satuan</label><input v-model="form.satuan" placeholder="m3, ton, unit" /></div>
      </div>
      <div class="row">
        <div class="field"><label>Harga Satuan</label><input v-model.number="form.hargaSatuan" type="number" /></div>
        <div class="field"><label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" @click="submit">Simpan</button>
    </div>
  </div>
</template>
