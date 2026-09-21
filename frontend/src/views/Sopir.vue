<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

// Tronton = komisi biasanya flat, tapi tetap bisa situasional per SJ.
// Cold Diesel = komisi diinput manual tiap kali (kadang diambil per hari),
// jadi tidak ada nilai flat yang masuk akal buat dijadikan default.
const TIPE_OPTIONS = [
  { value: "TRONTON", label: "Tronton" },
  { value: "COLD_DIESEL", label: "Cold Diesel" },
];
function labelTipe(t) {
  return TIPE_OPTIONS.find((o) => o.value === t)?.label || t;
}

const list = ref([]);
const loading = ref(true);
const showModal = ref(false);
const editingId = ref(null);
const search = ref("");
const filterTipe = ref("Semua");
const filterAktif = ref("Semua"); // Semua / Aktif / Nonaktif

const filteredList = computed(() => {
  const q = search.value.trim().toLowerCase();
  return list.value.filter((s) => {
    if (filterTipe.value !== "Semua" && s.tipe !== filterTipe.value) return false;
    if (filterAktif.value === "Aktif" && !s.aktif) return false;
    if (filterAktif.value === "Nonaktif" && s.aktif) return false;
    if (!q) return true;
    return (s.nama || "").toLowerCase().includes(q) || (s.noHp || "").toLowerCase().includes(q);
  });
});

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

const emptyForm = () => ({
  nama: "",
  tipe: "TRONTON",
  noHp: "",
  komisiDefault: 50000,
  aktif: true,
  keterangan: "",
});
const form = ref(emptyForm());

// Waktu ganti tipe di form Tambah (bukan Edit), isi ulang komisi default
// sesuai tipe -- Tronton 50rb, Cold Diesel 0 (manual tiap kali).
function onTipeChange() {
  if (editingId.value) return;
  form.value.komisiDefault = form.value.tipe === "TRONTON" ? 50000 : 0;
}

async function load() {
  loading.value = true;
  try {
    list.value = await api.get("/sopir?all=1");
  } catch (e) {
    toast(e?.message || "Gagal memuat data sopir");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  showModal.value = true;
}

function openEdit(s) {
  editingId.value = s.id;
  form.value = {
    nama: s.nama,
    tipe: s.tipe,
    noHp: s.noHp || "",
    komisiDefault: s.komisiDefault ?? 0,
    aktif: s.aktif,
    keterangan: s.keterangan || "",
  };
  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nama.trim()) {
    return toast("Nama sopir wajib diisi");
  }
  try {
    if (editingId.value) {
      await api.put(`/sopir/${editingId.value}`, form.value);
      toast("Data sopir berhasil diperbarui");
    } else {
      await api.post("/sopir", form.value);
      toast("Sopir berhasil ditambahkan");
    }
    showModal.value = false;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menyimpan data sopir");
  }
}

async function remove(id) {
  if (!confirm("Hapus sopir ini? Armada/Surat Jalan yang sudah pernah memakai sopir ini TIDAK ikut terhapus, namanya tetap tersimpan sebagai catatan lama.")) return;
  try {
    await api.delete(`/sopir/${id}`);
    toast("Sopir berhasil dihapus");
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menghapus sopir");
  }
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Sopir</h1>
      <div class="desc">Master data sopir &amp; komisi — terpisah dari data kendaraan (Armada)</div>
    </div>
    <button class="btn btn-primary" @click="openModal">+ Tambah Sopir</button>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
      <div class="field" style="margin:0; flex:1; min-width:200px;">
        <label>Cari (Nama / No HP)</label>
        <input v-model="search" placeholder="Ketik nama sopir..." />
      </div>
      <div class="field" style="margin:0;">
        <label>Tipe</label>
        <select v-model="filterTipe">
          <option value="Semua">Semua Tipe</option>
          <option v-for="t in TIPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
      <div class="field" style="margin:0;">
        <label>Status</label>
        <select v-model="filterAktif">
          <option>Semua</option>
          <option>Aktif</option>
          <option>Nonaktif</option>
        </select>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!list.length" class="empty">
      <div class="big">🧑‍✈️</div>
      <div>Belum ada sopir terdaftar.</div>
      <button class="btn btn-primary" style="margin-top:14px;" @click="openModal">+ Tambah Sopir</button>
    </div>

    <div v-else-if="!filteredList.length" class="empty">
      <div class="big">🔎</div>
      <div>Tidak ada sopir yang cocok dengan pencarian/filter.</div>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Daftar Sopir
        <span class="tag">{{ filteredList.length }} Sopir</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Tipe</th>
            <th>No HP</th>
            <th class="num">Komisi Default</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filteredList" :key="s.id" :style="{ opacity: s.aktif ? 1 : 0.55 }">
            <td>{{ s.nama }}</td>
            <td><span class="tag">{{ labelTipe(s.tipe) }}</span></td>
            <td>{{ s.noHp || "-" }}</td>
            <td class="num mono">
              {{ s.tipe === "COLD_DIESEL" && !s.komisiDefault ? "Manual tiap kali" : rupiah(s.komisiDefault) }}
            </td>
            <td>{{ s.aktif ? "Aktif" : "Nonaktif" }}</td>
            <td style="text-align:right; white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" style="margin-right:6px;" @click="openEdit(s)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="remove(s.id)">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="msub" style="margin-top:14px;">
      Komisi default di sini cuma acuan/auto-isi saat bikin Surat Jalan baru — tetap bisa diubah manual
      per pengiriman kalau situasinya beda (mis. rute lebih jauh, dst).
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal">
      <button class="modal-close" @click="closeModal">×</button>
      <h2>{{ editingId ? "Edit Sopir" : "Tambah Sopir" }}</h2>
      <div class="msub">Isi data sopir dan komisi defaultnya</div>

      <div class="row">
        <div class="field">
          <label>Nama Sopir</label>
          <input v-model="form.nama" placeholder="Nama lengkap sopir" />
        </div>
        <div class="field">
          <label>Tipe</label>
          <select v-model="form.tipe" @change="onTipeChange">
            <option v-for="t in TIPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>No HP <span class="optional">(opsional)</span></label>
          <input v-model="form.noHp" placeholder="08xx..." />
        </div>
        <div class="field">
          <label>Komisi Default</label>
          <input v-model.number="form.komisiDefault" type="number" min="0" />
          <div class="field-hint" v-if="form.tipe === 'COLD_DIESEL'">
            Cold Diesel biasanya komisinya manual tiap kali (kadang diambil per hari) — boleh dibiarkan 0
            kalau memang tidak ada nilai flat, nanti diisi langsung saat bikin Surat Jalan.
          </div>
          <div class="field-hint" v-else>
            Tronton biasanya flat 50.000, tapi tetap bisa diubah per Surat Jalan kalau situasional.
          </div>
        </div>
      </div>

      <div class="field">
        <label>Catatan <span class="optional">(opsional)</span></label>
        <input v-model="form.keterangan" placeholder="Catatan bebas" />
      </div>

      <label class="draft-check">
        <input v-model="form.aktif" type="checkbox" />
        <div>
          <div>Sopir aktif</div>
          <div class="draft-check-sub">Nonaktifkan kalau sopir sudah tidak bekerja lagi — datanya tetap tersimpan, tapi tidak muncul di dropdown pilihan baru.</div>
        </div>
      </label>

      <div style="display:flex; gap:8px; justify-content:space-between; margin-top:8px;">
        <button v-if="editingId" class="btn btn-danger" @click="remove(editingId); closeModal()">Hapus Sopir</button>
        <div style="display:flex; gap:8px; margin-left:auto;">
          <button class="btn btn-ghost" @click="closeModal">Batal</button>
          <button class="btn btn-primary" @click="submit">Simpan Sopir</button>
        </div>
      </div>
    </div>
  </div>
</template>
