<script setup>
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const customers = ref([]);
const showModal = ref(false);
const loading = ref(true);
const search = ref("");
const filterDivisi = ref("Semua");

const form = ref({
  nama: "",
  alamat: "",
  telepon: "",
  npwp: "",
  divisi: DIVISI[0],
});

const filteredCustomers = computed(() => {
  const keyword = search.value.trim().toLowerCase();

  return customers.value.filter((c) => {
    const matchDivisi =
      filterDivisi.value === "Semua" || c.divisi === filterDivisi.value;

    const matchSearch =
      !keyword ||
      c.nama?.toLowerCase().includes(keyword) ||
      c.telepon?.toLowerCase().includes(keyword) ||
      c.alamat?.toLowerCase().includes(keyword) ||
      c.npwp?.toLowerCase().includes(keyword);

    return matchDivisi && matchSearch;
  });
});

async function load() {
  loading.value = true;

  try {
    customers.value = await api.get("/customers");
  } catch (e) {
    toast("Gagal memuat data customer");
  } finally {
    loading.value = false;
  }
}

function openModal() {
  form.value = {
    nama: "",
    alamat: "",
    telepon: "",
    npwp: "",
    divisi: DIVISI[0],
  };

  showModal.value = true;
}

function closeModal() {
  showModal.value = false;
}

async function submit() {
  if (!form.value.nama.trim()) {
    return toast("Nama customer wajib diisi");
  }

  try {
    await api.post("/customers", {
      ...form.value,
      nama: form.value.nama.trim(),
    });

    toast("Customer berhasil ditambahkan");
    closeModal();
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menambahkan customer");
  }
}

async function remove(id) {
  if (!confirm("Hapus customer ini?")) return;

  try {
    await api.delete(`/customers/${id}`);
    toast("Customer berhasil dihapus");
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menghapus customer");
  }
}

function resetFilter() {
  search.value = "";
  filterDivisi.value = "Semua";
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Customer</h1>
      <div class="desc">
        Kelola data pelanggan dan informasi kontak perusahaan
      </div>
    </div>

    <button class="btn btn-primary" @click="openModal">
      <span>＋</span>
      <span>Tambah Customer</span>
    </button>
  </div>

  <div class="content">

    <!-- SUMMARY -->
    <div class="grid g4 customer-stats">
      <div class="stat">
        <div class="lbl">Total Customer</div>
        <div class="val">{{ customers.length }}</div>
        <div class="note">Seluruh data pelanggan</div>
      </div>

      <div
        v-for="divisi in DIVISI"
        :key="divisi"
        class="stat"
      >
        <div class="lbl">{{ divisi }}</div>
        <div class="val">
          {{ customers.filter((c) => c.divisi === divisi).length }}
        </div>
        <div class="note">Customer divisi</div>
      </div>
    </div>

    <!-- TOOLBAR -->
    <div class="card customer-toolbar">
      <div class="customer-search">
        <label>Cari Customer</label>

        <div class="search-wrap">
          <span class="search-icon">⌕</span>

          <input
            v-model="search"
            type="search"
            placeholder="Cari nama, telepon, alamat, atau NPWP..."
          />

          <button
            v-if="search"
            class="search-clear"
            type="button"
            @click="search = ''"
          >
            ×
          </button>
        </div>
      </div>

      <div class="customer-filter">
        <label>Divisi</label>

        <select v-model="filterDivisi">
          <option value="Semua">Semua Divisi</option>

          <option
            v-for="d in DIVISI"
            :key="d"
            :value="d"
          >
            {{ d }}
          </option>
        </select>
      </div>

      <button
        v-if="search || filterDivisi !== 'Semua'"
        class="btn btn-ghost filter-reset"
        @click="resetFilter"
      >
        Reset
      </button>
    </div>

    <!-- LOADING -->
    <div v-if="loading" class="empty">
      <div class="big">◌</div>
      Memuat data customer...
    </div>

    <!-- EMPTY -->
    <div
      v-else-if="!customers.length"
      class="empty customer-empty"
    >
      <div class="big">📇</div>

      <strong>Belum ada customer</strong>

      <div class="empty-desc">
        Tambahkan customer pertama untuk mulai mengelola data pelanggan.
      </div>

      <button
        class="btn btn-primary"
        style="margin-top: 16px"
        @click="openModal"
      >
        ＋ Tambah Customer
      </button>
    </div>

    <!-- NO SEARCH RESULT -->
    <div
      v-else-if="!filteredCustomers.length"
      class="empty customer-empty"
    >
      <div class="big">⌕</div>

      <strong>Customer tidak ditemukan</strong>

      <div class="empty-desc">
        Coba gunakan kata kunci atau filter divisi yang berbeda.
      </div>

      <button
        class="btn btn-ghost"
        style="margin-top: 16px"
        @click="resetFilter"
      >
        Reset Filter
      </button>
    </div>

    <!-- TABLE -->
    <div v-else class="card customer-table-card">
      <div class="table-header">
        <div>
          <div class="section-title" style="margin-bottom: 2px;">
            Daftar Customer
          </div>

          <div class="table-subtitle">
            Menampilkan {{ filteredCustomers.length }} dari
            {{ customers.length }} customer
          </div>
        </div>
      </div>

      <div class="table-scroll">
        <table class="customer-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Divisi</th>
              <th>Telepon</th>
              <th>NPWP</th>
              <th>Alamat</th>
              <th class="action-head">Aksi</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="c in filteredCustomers"
              :key="c.id"
            >
              <td>
                <div class="customer-name">
                  {{ c.nama }}
                </div>
              </td>

              <td>
                <span class="division-badge">
                  {{ c.divisi }}
                </span>
              </td>

              <td>
                <span class="contact-text">
                  {{ c.telepon || "-" }}
                </span>
              </td>

              <td>
                <span class="mono">
                  {{ c.npwp || "-" }}
                </span>
              </td>

              <td>
                <div class="address-text">
                  {{ c.alamat || "-" }}
                </div>
              </td>

              <td class="action-cell">
                <button
                  class="btn btn-sm btn-danger"
                  @click="remove(c.id)"
                >
                  Hapus
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- MODAL -->
  <div
    v-if="showModal"
    class="modal-bg"
    @click.self="closeModal"
  >
    <div class="modal customer-modal">

      <button
        class="modal-close"
        type="button"
        @click="closeModal"
      >
        ×
      </button>

      <div class="modal-heading">
        <div class="modal-icon">＋</div>

        <div>
          <h2>Tambah Customer</h2>

          <div class="msub">
            Masukkan informasi pelanggan baru
          </div>
        </div>
      </div>

      <div class="form-section-title">
        Informasi Perusahaan
      </div>

      <div class="field">
        <label>
          Nama Customer
          <span class="required">*</span>
        </label>

        <input
          v-model="form.nama"
          placeholder="Contoh: PT Bintang Jaya"
          @keyup.enter="submit"
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

      <div class="form-section-title">
        Informasi Kontak
      </div>

      <div class="row">
        <div class="field">
          <label>Telepon</label>

          <input
            v-model="form.telepon"
            type="tel"
            placeholder="08xxxxxxxxxx"
          />
        </div>

        <div class="field">
          <label>NPWP</label>

          <input
            v-model="form.npwp"
            placeholder="Nomor NPWP"
          />
        </div>
      </div>

      <div class="field">
        <label>Alamat</label>

        <textarea
          v-model="form.alamat"
          rows="3"
          placeholder="Alamat lengkap customer"
        ></textarea>
      </div>

      <div class="modal-actions">
        <button
          class="btn btn-ghost"
          type="button"
          @click="closeModal"
        >
          Batal
        </button>

        <button
          class="btn btn-primary"
          type="button"
          @click="submit"
        >
          Simpan Customer
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
.customer-stats {
  margin-bottom: 18px;
}

.customer-toolbar {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-bottom: 18px;
  padding: 16px;
}

.customer-search {
  flex: 1;
  min-width: 240px;
}

.customer-filter {
  width: 210px;
}

.search-wrap {
  position: relative;
}

.search-wrap input {
  padding-left: 36px;
  padding-right: 34px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-soft);
  font-size: 20px;
  z-index: 1;
}

.search-clear {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
}

.filter-reset {
  white-space: nowrap;
  height: 38px;
}

.customer-table-card {
  padding: 0;
  overflow: hidden;
}

.table-header {
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--line);
}

.table-subtitle {
  color: var(--ink-soft);
  font-size: 11.5px;
}

.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.customer-table {
  min-width: 760px;
}

.customer-name {
  font-weight: 650;
  color: var(--ink);
}

.division-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  border-radius: 20px;
  background: var(--gold-soft);
  color: var(--gold);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.contact-text {
  white-space: nowrap;
}

.address-text {
  max-width: 260px;
  color: var(--ink-soft);
  line-height: 1.4;
}

.action-head,
.action-cell {
  text-align: right;
}

.customer-empty {
  padding: 55px 20px;
}

.empty-desc {
  margin-top: 5px;
  color: var(--ink-soft);
  font-size: 12px;
}

.customer-modal {
  max-width: 620px;
}

.modal-heading {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 22px;
}

.modal-icon {
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: var(--gold-soft);
  color: var(--gold);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 600;
  flex-shrink: 0;
}

.form-section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--gold);
  padding-bottom: 7px;
  margin: 3px 0 13px;
  border-bottom: 1px solid var(--line);
}

.required {
  color: var(--stamp);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

@media (max-width: 700px) {
  .customer-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .customer-search,
  .customer-filter {
    width: 100%;
    min-width: 0;
  }

  .filter-reset {
    width: 100%;
    justify-content: center;
  }

  .customer-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .customer-modal {
    padding: 22px 18px;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-actions .btn {
    width: 100%;
    justify-content: center;
  }
}

@media (max-width: 430px) {
  .customer-stats {
    grid-template-columns: 1fr 1fr;
    gap: 9px;
  }

  .customer-stats .stat {
    padding: 13px;
  }

  .customer-stats .stat .val {
    font-size: 18px;
  }

  .customer-stats .stat .note {
    font-size: 9px;
  }
}
</style>