<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const showModal = ref(false);
const loading = ref(true);
const emptyForm = () => ({ username: "", password: "", nama: "", role: "STAFF", divisi: DIVISI[0] });
const form = ref(emptyForm());

async function load() {
  loading.value = true;
  list.value = await api.get("/users");
  loading.value = false;
}

function openModal() {
  form.value = emptyForm();
  showModal.value = true;
}

async function submit() {
  if (!form.value.username || !form.value.password || !form.value.nama) {
    return toast("Username, password, dan nama wajib diisi");
  }
  await api.post("/users", form.value);
  toast("Staf ditambahkan");
  showModal.value = false;
  await load();
}

async function nonaktifkan(id) {
  if (!confirm("Nonaktifkan akun ini?")) return;
  await api.patch(`/users/${id}/nonaktifkan`, {});
  toast("Akun dinonaktifkan");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Kelola Staf</h1>
      <div class="desc">Akun yang bisa login ke sistem (khusus admin)</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Tambah Staf</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else class="card">
      <table>
        <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Divisi</th><th>Status</th><th></th></tr></thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td>{{ u.nama }}</td>
            <td class="mono">{{ u.username }}</td>
            <td>{{ u.role }}</td>
            <td>{{ u.divisi || "Semua" }}</td>
            <td><span class="badge" :class="u.aktif ? 'b-lunas' : 'b-belum'">{{ u.aktif ? "Aktif" : "Nonaktif" }}</span></td>
            <td>
              <button v-if="u.aktif" class="btn btn-sm btn-danger" @click="nonaktifkan(u.id)">Nonaktifkan</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Tambah Staf</h2>
      <div class="row">
        <div class="field"><label>Nama</label><input v-model="form.nama" /></div>
        <div class="field"><label>Username</label><input v-model="form.username" /></div>
      </div>
      <div class="field"><label>Password Awal</label><input v-model="form.password" type="password" /></div>
      <div class="row">
        <div class="field"><label>Role</label>
          <select v-model="form.role">
            <option value="STAFF">Staf Divisi</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <div class="field" v-if="form.role === 'STAFF'"><label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" @click="submit">Simpan</button>
    </div>
  </div>
</template>
