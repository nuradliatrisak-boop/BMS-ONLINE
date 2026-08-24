<script setup>
import { ref, onMounted, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const customers = ref([]);
const stockMasterList = ref([]);
const showModal = ref(false);
const showPriceModal = ref(false);
const showRecipientModal = ref(false);
const loading = ref(true);
const saving = ref(false);
const search = ref("");
const filterDivisi = ref("Semua");
const showInactive = ref(false);
const selectedCustomer = ref(null);
const editingCustomerId = ref(null);
const editingRecipientId = ref(null);

// Kode stock baru (quick add di dalam modal harga)
const showNewStock = ref(false);
const newStock = ref({ kode: "", nama: "" });
const showStockManager = ref(false);

const emptyForm = () => ({
  kode: "",
  nama: "",
  alamat: "",
  telepon: "",
  npwp: "",
  divisi: DIVISI[0],
});

const priceForm = ref({
  destinationCode: "",
  stockCode: "",
  stockName: "",
  hargaM3: 0,
  sewaTruk: 0,
  hppTruk: 0,
  destination: "",
});

const emptyRecipientForm = () => ({ nama: "", alamat: "", telepon: "" });
const recipientForm = ref(emptyRecipientForm());

const form = ref(emptyForm());

const filteredCustomers = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  return customers.value.filter((c) => {
    const matchAktif = showInactive.value || c.aktif !== false;
    const matchDivisi = filterDivisi.value === "Semua" || c.divisi === filterDivisi.value;
    const matchSearch = !keyword ||
      c.kode?.toLowerCase().includes(keyword) ||
      c.nama?.toLowerCase().includes(keyword) ||
      c.telepon?.toLowerCase().includes(keyword) ||
      c.alamat?.toLowerCase().includes(keyword);
    return matchAktif && matchDivisi && matchSearch;
  });
});

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

async function load() {
  loading.value = true;
  try {
    customers.value = await api.get("/customers");
  } catch (e) {
    console.error(e);
    toast("Gagal memuat data customer");
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

async function openModal() {
  editingCustomerId.value = null;
  form.value = emptyForm();
  showModal.value = true;
  // Kode digenerate otomatis, tidak perlu diketik manual (biar tidak dobel/typo)
  try {
    const res = await api.get("/customers/next-kode");
    form.value.kode = res.kode;
  } catch (e) {
    toast("Gagal menyiapkan kode otomatis, coba lagi");
  }
}

// Kolom Edit di daftar customer: buka modal yang sama, sudah terisi data
// lama, supaya nama/alamat/telepon/NPWP bisa diubah bebas kalau ada yang
// keliru atau berubah.
function openEditCustomer(c) {
  editingCustomerId.value = c.id;
  form.value = {
    kode: c.kode,
    nama: c.nama,
    alamat: c.alamat || "",
    telepon: c.telepon || "",
    npwp: c.npwp || "",
    divisi: c.divisi,
  };
  showModal.value = true;
}

function closeModal() {
  if (!saving.value) showModal.value = false;
}

async function submit() {
  if (!form.value.nama.trim()) return toast("Nama customer wajib diisi");

  saving.value = true;
  try {
    if (editingCustomerId.value) {
      await api.put(`/customers/${editingCustomerId.value}`, {
        ...form.value,
        kode: form.value.kode.trim().toUpperCase(),
        nama: form.value.nama.trim(),
      });
      toast("Customer berhasil diperbarui");
    } else {
      await api.post("/customers", {
        ...form.value,
        kode: form.value.kode.trim().toUpperCase(),
        nama: form.value.nama.trim(),
      });
      toast("Customer berhasil ditambahkan");
    }
    closeModal();
    await load();
  } catch (e) {
    // Kalau kode ternyata sudah kepakai (misal ada yang nambah bersamaan), generate ulang.
    if (!editingCustomerId.value && e?.message?.includes("Kode customer")) {
      try {
        const res = await api.get("/customers/next-kode");
        form.value.kode = res.kode;
      } catch {}
    }
    toast(e?.message || "Gagal menyimpan customer");
  } finally {
    saving.value = false;
  }
}

async function toggleAktif(customer) {
  const aksi = customer.aktif === false ? "aktifkan" : "nonaktifkan";
  if (!confirm(`Yakin mau ${aksi} customer ${customer.nama}?`)) return;
  try {
    await api.patch(`/customers/${customer.id}/nonaktifkan`);
    toast(`Customer berhasil di-${aksi}`);
    await load();
  } catch (e) {
    toast(e?.message || `Gagal ${aksi} customer`);
  }
}

function openPriceModal(customer) {
  selectedCustomer.value = customer;
  priceForm.value = {
    destinationCode: "",
    stockCode: "",
    stockName: "",
    hargaM3: 0,
    sewaTruk: 0,
    hppTruk: 0,
    destination: "",
  };
  showNewStock.value = false;
  showStockManager.value = false;
  showPriceModal.value = true;
}

// Waktu kode stock dipilih dari dropdown, otomatis isi nama stock-nya juga
function onStockCodeChange() {
  const found = stockMasterList.value.find((s) => s.kode === priceForm.value.stockCode);
  priceForm.value.stockName = found ? found.nama : "";
}

async function saveNewStock() {
  if (!newStock.value.kode.trim() || !newStock.value.nama.trim()) {
    return toast("Kode dan nama stock wajib diisi");
  }
  try {
    const created = await api.post("/stock-master", newStock.value);
    toast("Kode stock baru berhasil ditambahkan");
    await loadStockMaster();
    priceForm.value.stockCode = created.kode;
    priceForm.value.stockName = created.nama;
    newStock.value = { kode: "", nama: "" };
    showNewStock.value = false;
  } catch (e) {
    toast(e?.message || "Gagal menambahkan kode stock");
  }
}

async function updateStock(item) {
  try {
    await api.put(`/stock-master/${item.id}`, { kode: item.kode, nama: item.nama });
    toast("Kode stock berhasil diperbarui");
    await loadStockMaster();
  } catch (e) {
    toast(e?.message || "Gagal memperbarui kode stock");
  }
}

async function deleteStock(item) {
  if (!confirm(`Hapus kode stock ${item.kode} - ${item.nama} dari daftar?`)) return;
  try {
    await api.delete(`/stock-master/${item.id}`);
    toast("Kode stock berhasil dihapus");
    await loadStockMaster();
  } catch (e) {
    toast(e?.message || "Gagal menghapus kode stock");
  }
}

function closePriceModal() {
  if (!saving.value) showPriceModal.value = false;
}

async function addPrice() {
  if (!priceForm.value.destinationCode || !priceForm.value.stockCode || !priceForm.value.stockName) {
    return toast("Kode tujuan, kode stock, dan nama stock wajib diisi");
  }

  saving.value = true;
  try {
    await api.post(`/customers/${selectedCustomer.value.id}/prices`, priceForm.value);
    toast("Harga customer berhasil ditambahkan");
    await load();
    selectedCustomer.value = customers.value.find((c) => c.id === selectedCustomer.value.id);
    priceForm.value = {
      destinationCode: "",
      stockCode: "",
      stockName: "",
      hargaM3: 0,
      sewaTruk: 0,
      hppTruk: 0,
      destination: "",
    };
  } catch (e) {
    toast(e?.message || "Gagal menambahkan harga");
  } finally {
    saving.value = false;
  }
}

async function removePrice(price) {
  if (!confirm(`Hapus harga ${price.stockName} untuk ${price.destinationCode}?`)) return;
  try {
    await api.delete(`/customers/${selectedCustomer.value.id}/prices/${price.id}`);
    await load();
    selectedCustomer.value = customers.value.find((c) => c.id === selectedCustomer.value.id);
    toast("Harga berhasil dihapus");
  } catch (e) {
    toast(e?.message || "Gagal menghapus harga");
  }
}

// ============================================================
// PENERIMA & TUJUAN — daftar penerima pengiriman milik customer ini
// (dipakai sebagai dropdown "Penerima" & "Tujuan" saat Buat Surat
// Jalan). Bisa ditambah, diedit langsung, dan dihapus di sini.
// ============================================================
function openRecipientModal(customer) {
  selectedCustomer.value = customer;
  editingRecipientId.value = null;
  recipientForm.value = emptyRecipientForm();
  showRecipientModal.value = true;
}

function closeRecipientModal() {
  if (!saving.value) showRecipientModal.value = false;
}

function startEditRecipient(r) {
  editingRecipientId.value = r.id;
  recipientForm.value = { nama: r.nama, alamat: r.alamat, telepon: r.telepon || "" };
}

function cancelEditRecipient() {
  editingRecipientId.value = null;
  recipientForm.value = emptyRecipientForm();
}

async function refreshSelectedCustomer() {
  await load();
  selectedCustomer.value = customers.value.find((c) => c.id === selectedCustomer.value.id);
}

async function saveRecipient() {
  if (!recipientForm.value.nama.trim() || !recipientForm.value.alamat.trim()) {
    return toast("Nama penerima dan alamat tujuan wajib diisi");
  }

  saving.value = true;
  try {
    if (editingRecipientId.value) {
      await api.put(
        `/customers/${selectedCustomer.value.id}/recipients/${editingRecipientId.value}`,
        recipientForm.value
      );
      toast("Penerima berhasil diperbarui");
    } else {
      await api.post(`/customers/${selectedCustomer.value.id}/recipients`, recipientForm.value);
      toast("Penerima berhasil ditambahkan");
    }
    await refreshSelectedCustomer();
    editingRecipientId.value = null;
    recipientForm.value = emptyRecipientForm();
  } catch (e) {
    toast(e?.message || "Gagal menyimpan penerima");
  } finally {
    saving.value = false;
  }
}

async function removeRecipient(r) {
  if (!confirm(`Hapus penerima "${r.nama}" dari daftar?`)) return;
  try {
    await api.delete(`/customers/${selectedCustomer.value.id}/recipients/${r.id}`);
    toast("Penerima berhasil dihapus");
    await refreshSelectedCustomer();
    if (editingRecipientId.value === r.id) cancelEditRecipient();
  } catch (e) {
    toast(e?.message || "Gagal menghapus penerima");
  }
}

async function remove(id) {
  if (!confirm("Hapus customer ini? Data harga customer juga akan ikut terhapus.")) return;
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

onMounted(() => {
  load();
  loadStockMaster();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Customer</h1>
      <div class="desc">Master pelanggan, kode tujuan, stock, dan harga khusus customer</div>
    </div>
    <button class="btn btn-primary" @click="openModal">＋ Tambah Customer</button>
  </div>

  <div class="content">
    <div class="grid g4 customer-stats">
      <div class="stat">
        <div class="lbl">Total Customer</div>
        <div class="val">{{ customers.length }}</div>
        <div class="note">Master pelanggan</div>
      </div>
      <div class="stat">
        <div class="lbl">Master Harga</div>
        <div class="val">{{ customers.reduce((n, c) => n + (c.prices?.length || 0), 0) }}</div>
        <div class="note">Harga per tujuan / stock</div>
      </div>
      <div v-for="divisi in DIVISI" :key="divisi" class="stat">
        <div class="lbl">{{ divisi }}</div>
        <div class="val">{{ customers.filter((c) => c.divisi === divisi).length }}</div>
        <div class="note">Customer divisi</div>
      </div>
    </div>

    <div class="card customer-toolbar">
      <div class="customer-search">
        <label>Cari Customer</label>
        <div class="search-wrap">
          <span class="search-icon">⌕</span>
          <input v-model="search" type="search" placeholder="Cari kode, nama, telepon, atau alamat..." />
          <button v-if="search" class="search-clear" type="button" @click="search = ''">×</button>
        </div>
      </div>
      <div class="customer-filter">
        <label>Divisi</label>
        <select v-model="filterDivisi">
          <option value="Semua">Semua Divisi</option>
          <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <button v-if="search || filterDivisi !== 'Semua'" class="btn btn-ghost filter-reset" @click="resetFilter">Reset</button>
      <label class="show-inactive"><input type="checkbox" v-model="showInactive" /> Tampilkan yang nonaktif</label>
    </div>

    <div v-if="loading" class="empty"><div class="big">◌</div>Memuat data customer...</div>

    <div v-else-if="!filteredCustomers.length" class="empty customer-empty">
      <div class="big">📇</div>
      <strong>{{ customers.length ? "Customer tidak ditemukan" : "Belum ada customer" }}</strong>
      <div class="empty-desc">{{ customers.length ? "Coba gunakan kata kunci atau filter yang berbeda." : "Tambahkan customer pertama untuk mulai mengelola master pelanggan." }}</div>
      <button class="btn btn-primary" style="margin-top:16px" @click="customers.length ? resetFilter() : openModal()">{{ customers.length ? "Reset Filter" : "＋ Tambah Customer" }}</button>
    </div>

    <div v-else class="card customer-table-card">
      <div class="table-header">
        <div>
          <div class="section-title" style="margin-bottom:2px">Daftar Customer</div>
          <div class="table-subtitle">Menampilkan {{ filteredCustomers.length }} dari {{ customers.length }} customer</div>
        </div>
      </div>

      <div class="table-scroll">
        <table class="customer-table">
          <thead>
            <tr>
              <th>Kode</th>
              <th>Customer</th>
              <th>Divisi</th>
              <th>Harga</th>
              <th>Penerima</th>
              <th>Telepon</th>
              <th>Alamat</th>
              <th class="action-head">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in filteredCustomers" :key="c.id" :class="{ 'row-inactive': c.aktif === false }">
              <td><span class="customer-code mono">{{ c.kode }}</span></td>
              <td>
                <div class="customer-name">{{ c.nama }}</div>
                <span v-if="c.aktif === false" class="inactive-badge">Nonaktif</span>
              </td>
              <td><span class="division-badge">{{ c.divisi }}</span></td>
              <td><button class="price-count" @click="openPriceModal(c)">{{ c.prices?.length || 0 }} harga</button></td>
              <td><button class="price-count" @click="openRecipientModal(c)">{{ c.recipients?.length || 0 }} penerima</button></td>
              <td><span class="contact-text">{{ c.telepon || "-" }}</span></td>
              <td><div class="address-text">{{ c.alamat || "-" }}</div></td>
              <td class="action-cell">
                <button class="btn btn-sm btn-ghost" @click="openEditCustomer(c)">Edit</button>
                <button class="btn btn-sm btn-ghost" @click="openRecipientModal(c)">Penerima</button>
                <button class="btn btn-sm btn-ghost" @click="openPriceModal(c)">Harga</button>
                <button class="btn btn-sm btn-ghost" @click="toggleAktif(c)">{{ c.aktif === false ? "Aktifkan" : "Nonaktifkan" }}</button>
                <button class="btn btn-sm btn-danger" @click="remove(c.id)">Hapus</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal customer-modal">
      <button class="modal-close" type="button" @click="closeModal">×</button>
      <div class="modal-heading">
        <div class="modal-icon">{{ editingCustomerId ? "✎" : "＋" }}</div>
        <div><h2>{{ editingCustomerId ? "Edit Customer" : "Tambah Customer" }}</h2><div class="msub">{{ editingCustomerId ? "Ubah data master customer ini." : "Kode customer digenerate otomatis, tidak perlu diketik manual." }}</div></div>
      </div>

      <div class="form-section-title">Informasi Master</div>
      <div class="row">
        <div class="field">
          <label>Kode Customer</label>
          <input v-model="form.kode" :readonly="!editingCustomerId" :class="{ 'input-readonly': !editingCustomerId }" title="Digenerate otomatis" />
        </div>
        <div class="field">
          <label>Nama Customer <span class="required">*</span></label>
          <input v-model="form.nama" placeholder="Contoh: TB. ALAM JAYA" @keyup.enter="submit" />
        </div>
      </div>
      <div class="field">
        <label>Divisi</label>
        <select v-model="form.divisi"><option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option></select>
      </div>

      <div class="form-section-title">Informasi Kontak</div>
      <div class="row">
        <div class="field"><label>Telepon</label><input v-model="form.telepon" type="tel" placeholder="Nomor telepon" /></div>
        <div class="field"><label>NPWP</label><input v-model="form.npwp" placeholder="Nomor NPWP" /></div>
      </div>
      <div class="field"><label>Alamat</label><textarea v-model="form.alamat" rows="3" placeholder="Alamat lengkap customer"></textarea></div>

      <div class="modal-actions">
        <button class="btn btn-ghost" type="button" :disabled="saving" @click="closeModal">Batal</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">{{ saving ? "Menyimpan..." : editingCustomerId ? "Simpan Perubahan" : "Simpan Customer" }}</button>
      </div>
    </div>
  </div>

  <div v-if="showPriceModal && selectedCustomer" class="modal-bg" @click.self="closePriceModal">
    <div class="modal customer-price-modal">
      <button class="modal-close" type="button" @click="closePriceModal">×</button>
      <h2>Master Harga Customer</h2>
      <div class="msub"><strong>{{ selectedCustomer.kode }}</strong> — {{ selectedCustomer.nama }}</div>

      <div class="price-list" v-if="selectedCustomer.prices?.length">
        <div v-for="p in selectedCustomer.prices" :key="p.id" class="price-card">
          <div class="price-main">
            <div class="price-title"><span class="code-chip">{{ p.destinationCode }}</span> <span class="code-chip dark">{{ p.stockCode }}</span> {{ p.stockName }}</div>
            <div class="price-meta">{{ p.destination || "-" }}</div>
          </div>
          <div class="price-values">
            <span>Harga <strong>{{ rupiah(p.hargaM3) }}</strong></span>
            <span v-if="p.sewaTruk">Sewa <strong>{{ rupiah(p.sewaTruk) }}</strong></span>
          </div>
          <button class="btn btn-sm btn-danger" @click="removePrice(p)">Hapus</button>
        </div>
      </div>
      <div v-else class="empty price-empty">Belum ada master harga untuk customer ini.</div>

      <div class="form-section-title" style="margin-top:18px">Tambah Harga</div>
      <div class="row">
        <div class="field"><label>Kode Tujuan</label><input v-model="priceForm.destinationCode" placeholder="A01 / B01" /></div>
        <div class="field">
          <label>Kode Stock</label>
          <select v-model="priceForm.stockCode" @change="onStockCodeChange">
            <option value="" disabled>Pilih kode stock...</option>
            <option v-for="s in stockMasterList.filter(x => x.aktif !== false)" :key="s.id" :value="s.kode">{{ s.kode }} — {{ s.nama }}</option>
          </select>
          <div class="stock-actions">
            <button type="button" class="link-btn" @click="showNewStock = !showNewStock">+ Kode stock belum ada di daftar?</button>
            <button type="button" class="link-btn" @click="showStockManager = !showStockManager">Kelola kode stock</button>
          </div>
        </div>
      </div>

      <div v-if="showNewStock" class="inline-add-box">
        <div class="row">
          <div class="field"><label>Kode Baru</label><input v-model="newStock.kode" placeholder="Contoh: XY" style="text-transform:uppercase" /></div>
          <div class="field"><label>Nama Stock</label><input v-model="newStock.nama" placeholder="Contoh: PASIR MERAH" /></div>
        </div>
        <button type="button" class="btn btn-sm btn-primary" @click="saveNewStock">Simpan Kode Stock</button>
      </div>

      <div v-if="showStockManager" class="inline-add-box stock-manager">
        <div class="msub" style="margin-bottom:8px">Edit nama atau hapus kode stock yang sudah ada.</div>
        <div class="stock-manage-row" v-for="s in stockMasterList" :key="s.id">
          <input v-model="s.kode" class="stock-kode-input" style="text-transform:uppercase" />
          <input v-model="s.nama" class="stock-nama-input" />
          <button type="button" class="btn btn-sm btn-ghost" @click="updateStock(s)">Simpan</button>
          <button type="button" class="btn btn-sm btn-danger" @click="deleteStock(s)">Hapus</button>
        </div>
      </div>

      <div class="field"><label>Nama Stock / Jenis</label><input v-model="priceForm.stockName" placeholder="Terisi otomatis dari kode stock, atau isi manual" /></div>
      <div class="row">
        <div class="field"><label>Harga</label><input v-model.number="priceForm.hargaM3" type="number" min="0" /></div>
        <div class="field"><label>Sewa Truck</label><input v-model.number="priceForm.sewaTruk" type="number" min="0" /></div>
      </div>
      <div class="field"><label>Keterangan / Destination</label><input v-model="priceForm.destination" placeholder="Contoh: HRG COLT/M3 SPLIT JKT" /></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" :disabled="saving" @click="closePriceModal">Tutup</button>
        <button class="btn btn-primary" :disabled="saving" @click="addPrice">{{ saving ? "Menyimpan..." : "+ Tambah Harga" }}</button>
      </div>
    </div>
  </div>

  <!-- PENERIMA & TUJUAN -->
  <div v-if="showRecipientModal && selectedCustomer" class="modal-bg" @click.self="closeRecipientModal">
    <div class="modal customer-price-modal">
      <button class="modal-close" type="button" @click="closeRecipientModal">×</button>
      <h2>Penerima &amp; Tujuan</h2>
      <div class="msub"><strong>{{ selectedCustomer.kode }}</strong> — {{ selectedCustomer.nama }}</div>
      <div class="msub" style="margin-top:4px">
        Dipakai sebagai pilihan "Penerima" &amp; "Tujuan" saat Buat Surat Jalan. Kolom nama & alamat bisa diedit langsung, tidak perlu kaku sesuai isian awal.
      </div>

      <div class="price-list" v-if="selectedCustomer.recipients?.length" style="margin-top:16px">
        <div v-for="r in selectedCustomer.recipients" :key="r.id" class="recipient-card">
          <template v-if="editingRecipientId === r.id">
            <div class="row">
              <div class="field"><label>Nama Penerima</label><input v-model="recipientForm.nama" placeholder="Contoh: PT. Pitaco Mitra Perkasa" /></div>
              <div class="field"><label>Telepon <span class="optional">(opsional)</span></label><input v-model="recipientForm.telepon" /></div>
            </div>
            <div class="field"><label>Alamat / Tujuan</label><textarea v-model="recipientForm.alamat" rows="2"></textarea></div>
            <div class="recipient-edit-actions">
              <button type="button" class="btn btn-sm btn-ghost" :disabled="saving" @click="cancelEditRecipient">Batal</button>
              <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="saveRecipient">{{ saving ? "Menyimpan..." : "Simpan" }}</button>
            </div>
          </template>
          <template v-else>
            <div class="price-main">
              <div class="price-title">{{ r.nama }}</div>
              <div class="price-meta">{{ r.alamat }}<span v-if="r.telepon"> · {{ r.telepon }}</span></div>
            </div>
            <div class="recipient-row-actions">
              <button type="button" class="btn btn-sm btn-ghost" @click="startEditRecipient(r)">Edit</button>
              <button type="button" class="btn btn-sm btn-danger" @click="removeRecipient(r)">Hapus</button>
            </div>
          </template>
        </div>
      </div>
      <div v-else class="empty price-empty">Belum ada penerima untuk customer ini. Customer ini akan dianggap penerima tunggal (nama & alamat customer sendiri) saat Buat Surat Jalan.</div>

      <div class="form-section-title" style="margin-top:18px">{{ editingRecipientId ? "Edit Penerima" : "Tambah Penerima" }}</div>
      <template v-if="editingRecipientId === null">
        <div class="row">
          <div class="field"><label>Nama Penerima</label><input v-model="recipientForm.nama" placeholder="Contoh: PT. Pitaco Mitra Perkasa" /></div>
          <div class="field"><label>Telepon <span class="optional">(opsional)</span></label><input v-model="recipientForm.telepon" /></div>
        </div>
        <div class="field"><label>Alamat / Tujuan</label><textarea v-model="recipientForm.alamat" rows="2" placeholder="Alamat lengkap tujuan pengiriman"></textarea></div>
      </template>

      <div class="modal-actions">
        <button class="btn btn-ghost" :disabled="saving" @click="closeRecipientModal">Tutup</button>
        <button v-if="editingRecipientId === null" class="btn btn-primary" :disabled="saving" @click="saveRecipient">{{ saving ? "Menyimpan..." : "+ Tambah Penerima" }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.customer-stats { margin-bottom: 18px; }
.customer-toolbar { display:flex; align-items:flex-end; gap:14px; margin-bottom:18px; padding:16px; }
.customer-search { flex:1; min-width:240px; }
.customer-filter { width:210px; }
.search-wrap { position:relative; }
.search-wrap input { padding-left:36px; padding-right:34px; }
.search-icon { position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--ink-soft); font-size:20px; z-index:1; }
.search-clear { position:absolute; right:9px; top:50%; transform:translateY(-50%); border:none; background:transparent; color:var(--ink-soft); cursor:pointer; font-size:20px; }
.filter-reset { white-space:nowrap; height:38px; }
.customer-table-card { padding:0; overflow:hidden; }
.table-header { padding:18px 20px 14px; border-bottom:1px solid var(--line); }
.table-subtitle { color:var(--ink-soft); font-size:11.5px; }
.table-scroll { width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }
.customer-table { min-width:980px; }
.customer-name { font-weight:650; color:var(--ink); }
.customer-code { display:inline-flex; padding:5px 8px; border-radius:7px; background:var(--bms-blue-soft); color:var(--bms-blue-dark); font-weight:800; font-size:11px; }
.division-badge { display:inline-flex; align-items:center; padding:4px 9px; border-radius:20px; background:var(--bms-blue-soft); color:var(--bms-blue-dark); font-size:11px; font-weight:650; white-space:nowrap; }
.contact-text { white-space:nowrap; }
.address-text { max-width:260px; color:var(--ink-soft); line-height:1.4; }
.action-head,.action-cell { text-align:right; white-space:nowrap; }
.price-count { border:none; background:var(--bms-blue-soft); color:var(--bms-blue-dark); border-radius:999px; padding:5px 9px; font-size:11px; font-weight:700; cursor:pointer; }
.customer-empty { padding:55px 20px; }
.empty-desc { margin-top:5px; color:var(--ink-soft); font-size:12px; }
.customer-modal,.customer-price-modal { max-width:700px; }
.customer-price-modal { max-height:88vh; overflow:auto; }
.modal-heading { display:flex; align-items:center; gap:13px; margin-bottom:22px; }
.modal-icon { width:42px; height:42px; border-radius:11px; background:var(--bms-blue-soft); color:var(--bms-blue-dark); display:flex; align-items:center; justify-content:center; font-size:22px; font-weight:600; flex-shrink:0; }
.form-section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--bms-blue-dark); padding-bottom:7px; margin:3px 0 13px; border-bottom:1px solid var(--line); }
.required { color:var(--stamp); }
.modal-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:18px; padding-top:16px; border-top:1px solid var(--line); }
.price-list { display:flex; flex-direction:column; gap:8px; margin-top:16px; }
.price-card { display:grid; grid-template-columns:1fr auto auto; gap:12px; align-items:center; padding:11px 12px; border:1px solid var(--line); border-radius:9px; background:#fafcff; }
.price-title { font-size:12px; font-weight:700; }
.price-meta { margin-top:4px; color:var(--ink-soft); font-size:10px; }
.code-chip { display:inline-flex; padding:3px 6px; border-radius:5px; background:var(--bms-blue-soft); color:var(--bms-blue-dark); font-family:"JetBrains Mono",monospace; font-size:9px; margin-right:2px; }
.code-chip.dark { background:#e9edf3; color:var(--ink); }
.price-values { display:flex; flex-direction:column; align-items:flex-end; gap:3px; font-size:10px; color:var(--ink-soft); white-space:nowrap; }
.price-values strong { color:var(--ink); font-family:"JetBrains Mono",monospace; }
.price-empty { padding:20px; }
.recipient-card { display:flex; flex-direction:column; gap:8px; padding:11px 12px; border:1px solid var(--line); border-radius:9px; background:#fafcff; margin-bottom:8px; }
.recipient-row-actions { display:flex; gap:6px; justify-content:flex-end; }
.recipient-edit-actions { display:flex; gap:6px; justify-content:flex-end; margin-top:2px; }
.show-inactive { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink-soft); white-space:nowrap; margin-left:auto; }
.row-inactive { opacity:.55; }
.inactive-badge { display:inline-block; margin-top:3px; padding:2px 7px; border-radius:20px; background:#fde3e3; color:#b23b3b; font-size:9.5px; font-weight:700; }
.input-readonly { background:#f0f2f5; color:var(--ink-soft); font-weight:700; }
.stock-actions { display:flex; gap:12px; margin-top:5px; }
.link-btn { background:none; border:none; padding:0; color:var(--bms-blue-dark); font-size:11px; font-weight:600; cursor:pointer; text-decoration:underline; }
.inline-add-box { background:#f7f9fc; border:1px dashed var(--line); border-radius:9px; padding:12px; margin:8px 0 14px; }
.stock-manager { max-height:220px; overflow:auto; }
.stock-manage-row { display:flex; gap:6px; align-items:center; margin-bottom:6px; }
.stock-kode-input { width:60px; flex-shrink:0; }
.stock-nama-input { flex:1; }
@media (max-width:700px) {
  .customer-toolbar { flex-direction:column; align-items:stretch; }
  .customer-search,.customer-filter { width:100%; min-width:0; }
  .filter-reset { width:100%; justify-content:center; }
  .customer-stats { grid-template-columns:repeat(2,1fr); }
  .customer-modal,.customer-price-modal { padding:22px 18px; }
  .modal-actions { flex-direction:column-reverse; }
  .modal-actions .btn { width:100%; justify-content:center; }
  .price-card { grid-template-columns:1fr; }
  .price-values { align-items:flex-start; }
}
</style>