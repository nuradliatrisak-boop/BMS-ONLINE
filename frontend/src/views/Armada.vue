<script setup>
import { ref, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const list = ref([]);
const showModal = ref(false);
const loading = ref(true);
const form = ref({ nopol: "", jenis: "", sopir: "", divisi: DIVISI[0] });

async function load() {
  loading.value = true;
  list.value = await api.get("/armada");
  loading.value = false;
}

function openModal() {
  form.value = { nopol: "", jenis: "", sopir: "", divisi: DIVISI[0] };
  showModal.value = true;
}

async function submit() {
  if (!form.value.nopol || !form.value.jenis) return toast("Nopol dan jenis wajib diisi");
  await api.post("/armada", form.value);
  toast("Armada ditambahkan");
  showModal.value = false;
  await load();
}

async function remove(id) {
  if (!confirm("Hapus armada ini?")) return;
  await api.delete(`/armada/${id}`);
  toast("Armada dihapus");
  await load();
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Armada</h1>
      <div class="desc">Kendaraan dan alat operasional</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Tambah Armada</button>
  </div>
  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>
    <div v-else-if="!list.length" class="empty">
      <div class="big">🚚</div>
      Belum ada armada terdaftar.
    </div>
    <div v-else class="card">
      <table>
        <thead>
          <tr><th>Nopol</th><th>Jenis</th><th>Sopir</th><th>Divisi</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="a in list" :key="a.id">
            <td class="mono">{{ a.nopol }}</td>
            <td>{{ a.jenis }}</td>
            <td>{{ a.sopir || "-" }}</td>
            <td>{{ a.divisi }}</td>
            <td><button class="btn btn-sm btn-danger" @click="remove(a.id)">Hapus</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="showModal = false">
    <div class="modal">
      <button class="modal-close" @click="showModal = false">×</button>
      <h2>Tambah Armada</h2>
      <div class="row">
        <div class="field"><label>Nomor Polisi</label><input v-model="form.nopol" /></div>
        <div class="field"><label>Jenis</label><input v-model="form.jenis" placeholder="Truk, Dump Truck, dll" /></div>
      </div>
      <div class="row">
        <div class="field"><label>Sopir</label><input v-model="form.sopir" /></div>
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
