<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const customers = ref([]);
const showModal = ref(false);
const loading = ref(true);
const form = ref({ nama: "", alamat: "", telepon: "", npwp: "", divisi: DIVISI[0] });

async function load() {
  loading.value = true;
  customers.value = await api.get("/customers");
  loading.value = false;
}

function openModal() {
  form.value = { nama: "", alamat: "", telepon: "", npwp: "", divisi: DIVISI[0] };
  showModal.value = true;
}

async function submit() {
  if (!form.value.nama) return toast("Nama wajib diisi");
  await api.post("/customers", form.value);
  toast("Customer ditambahkan");
  showModal.value = false;
  await load();
}

async function remove(id) {
  if (!confirm("Hapus customer ini?")) return;
  await api.delete(`/customers/${id}`);
  toast("Customer dihapus");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Customer</h1>
      <div class="desc">Daftar pelanggan per divisi</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Tambah Customer</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!customers.length" class="empty">
      <div class="big">📇</div>
      Belum ada customer. Klik "Tambah Customer" untuk mulai.
    </div>
    <div v-else class="card">
      <table>
        <thead>
          <tr><th>Nama</th><th>Divisi</th><th>Telepon</th><th>Alamat</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="c in customers" :key="c.id">
            <td>{{ c.nama }}</td>
            <td>{{ c.divisi }}</td>
            <td>{{ c.telepon || "-" }}</td>
            <td>{{ c.alamat || "-" }}</td>
            <td><button class="btn btn-sm btn-danger" @click="remove(c.id)">Hapus</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Tambah Customer</h2>
      <div class="msub">Isi data pelanggan baru</div>

      <div class="field"><label>Nama</label><input v-model="form.nama" /></div>
      <div class="field"><label>Divisi</label>
        <select v-model="form.divisi">
          <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div class="row">
        <div class="field"><label>Telepon</label><input v-model="form.telepon" /></div>
        <div class="field"><label>NPWP</label><input v-model="form.npwp" /></div>
      </div>
      <div class="field"><label>Alamat</label><textarea v-model="form.alamat" rows="2"></textarea></div>

      <button class="btn btn-primary" @click="submit">Simpan</button>
    </div>
  </div>
</template>
