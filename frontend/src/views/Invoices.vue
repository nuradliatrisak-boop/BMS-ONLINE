<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const router = useRouter();

const invoices = ref([]);
const customers = ref([]);
const belumDitagih = ref([]);
const loadingBelumDitagih = ref(false);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);
const editingId = ref(null);

const emptyForm = () => ({
  divisi: DIVISI[0],
  customerId: "",
  tanggal: new Date().toISOString().slice(0, 10),
  jatuhTempo: "",
  halaman: 1,
  catatan: "",
});

const form = ref(emptyForm());
// baris terpilih: { suratJalanId, checked, hargaSatuan }
const rows = ref([]);

function vehicleTypeForSJ(sj) {
  const jenis = `${sj.armada?.jenis || ""} ${sj.noPolisi || ""}`.toUpperCase();
  return jenis.includes("TRONTON") ? "TRONTON" : "CD";
}
function suggestedPrice(sj) {
  const customer = customers.value.find(c => c.id === form.value.customerId);
  if (!customer) return 0;
  const stock = `${sj.jenisBarang || ""}`.trim().toUpperCase();
  const vehicle = vehicleTypeForSJ(sj);
  const price = (customer.prices || []).find(p => p.vehicleType === vehicle && (p.stockName || "").trim().toUpperCase() === stock)
    || (customer.prices || []).find(p => (p.stockName || "").trim().toUpperCase() === stock);
  return Number(price?.hargaM3 || 0);
}

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

function badgeClass(status) {
  if (status === "LUNAS") return "b-lunas";
  if (status === "SEBAGIAN") return "b-sebagian";
  return "b-belum";
}

function formatTanggal(tanggal) {
  if (!tanggal) return "-";
  return new Date(tanggal).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const selectedRows = computed(() => rows.value.filter((r) => r.checked));
const formTotal = computed(() =>
  selectedRows.value.reduce((sum, r) => sum + Number(r.hargaSatuan || 0) * Number(r.qty || 0), 0)
);

async function load() {
  loading.value = true;
  try {
    const [invoiceData, customerData] = await Promise.all([
      api.get("/invoices"),
      api.get("/customers"),
    ]);
    invoices.value = invoiceData;
    customers.value = customerData;
  } catch (error) {
    console.error(error);
    toast("Gagal memuat data invoice");
  } finally {
    loading.value = false;
  }
}

async function loadBelumDitagih() {
  rows.value = [];
  if (!form.value.customerId) return;
  loadingBelumDitagih.value = true;
  try {
    const list = await api.get(
      `/surat-jalan/belum-ditagih?customerId=${form.value.customerId}`
    );
    belumDitagih.value = list;
    rows.value = list.map((sj) => ({
      suratJalanId: sj.id,
      sj,
      checked: true,
      qty: sj.m3,
      hargaSatuan: suggestedPrice(sj),
    }));
  } catch (error) {
    toast(error?.message || "Gagal memuat surat jalan yang belum ditagih");
  } finally {
    loadingBelumDitagih.value = false;
  }
}

watch(() => form.value.customerId, () => {
  if (!editingId.value) loadBelumDitagih();
});

function openModal() {
  editingId.value = null;
  form.value = emptyForm();
  rows.value = [];
  showModal.value = true;
}

function closeModal() {
  if (saving.value) return;
  showModal.value = false;
}

function applyHargaToAll(idx) {
  const harga = rows.value[idx]?.hargaSatuan;
  if (harga === undefined) return;
  rows.value.forEach((r) => (r.hargaSatuan = harga));
}

function validateForm() {
  if (!form.value.divisi) {
    toast("Divisi wajib dipilih");
    return false;
  }
  if (!form.value.customerId) {
    toast("Customer wajib dipilih");
    return false;
  }
  if (!form.value.tanggal) {
    toast("Tanggal invoice wajib diisi");
    return false;
  }
  if (!selectedRows.value.length) {
    toast("Pilih minimal 1 surat jalan yang mau ditagihkan");
    return false;
  }
  return true;
}

async function submit() {
  if (!validateForm()) return;

  saving.value = true;
  try {
    const payload = {
      divisi: form.value.divisi,
      customerId: form.value.customerId,
      tanggal: form.value.tanggal,
      jatuhTempo: form.value.jatuhTempo || null,
      halaman: Number(form.value.halaman) || 1,
      catatan: form.value.catatan || null,
      items: selectedRows.value.map((r) => ({
        suratJalanId: r.suratJalanId,
        hargaSatuan: Number(r.hargaSatuan) || 0,
      })),
    };

    const created = await api.post("/invoices", payload);
    toast(`Invoice ${created.no} berhasil dibuat`);
    showModal.value = false;
    await load();
  } catch (error) {
    console.error(error);
    toast(error?.message || "Gagal membuat invoice");
  } finally {
    saving.value = false;
  }
}

async function removeInvoice(inv) {
  if (!confirm(`Hapus invoice ${inv.no}? Surat jalan yang dipakai akan kembali berstatus belum ditagih.`)) return;
  try {
    await api.delete(`/invoices/${inv.id}`);
    toast("Invoice berhasil dihapus");
    await load();
  } catch (error) {
    toast(error?.message || "Gagal menghapus invoice");
  }
}

function goDetail(id) {
  router.push({ name: "invoice-detail", params: { id } });
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Invoice</h1>
      <div class="desc">Tagihan ke customer</div>
    </div>

    <button class="btn btn-primary" @click="openModal">+ Buat Invoice</button>
  </div>

  <div class="content">
    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!invoices.length" class="empty">
      <div class="big">🧾</div>
      <div>Belum ada invoice.</div>
      <button class="btn btn-primary" style="margin-top: 14px" @click="openModal">
        + Buat Invoice Pertama
      </button>
    </div>

    <div v-else class="card invoice-table-card">
      <div class="section-title">
        Daftar Invoice
        <span class="tag">{{ invoices.length }} Invoice</span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No Invoice</th>
              <th>Customer</th>
              <th>Divisi</th>
              <th>Tanggal</th>
              <th class="num">Total</th>
              <th class="num">Sisa</th>
              <th>Status</th>
              <th class="action-col">Aksi</th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="i in invoices" :key="i.id" class="clickable-row" @click="goDetail(i.id)">
              <td><span class="invoice-number mono">{{ i.no }}</span></td>
              <td><strong>{{ i.customer?.nama || "-" }}</strong></td>
              <td>{{ i.divisi }}</td>
              <td>{{ formatTanggal(i.tanggal) }}</td>
              <td class="num mono">{{ rupiah(i.total) }}</td>
              <td class="num mono">{{ rupiah(i.sisaTagihan) }}</td>
              <td><span class="badge" :class="badgeClass(i.status)">{{ i.status }}</span></td>
              <td @click.stop>
                <button class="btn btn-sm btn-danger" @click="removeInvoice(i)">Hapus</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="invoice-hint">Klik baris invoice untuk melihat detail, edit item, dan pembayaran.</div>
    </div>
  </div>

  <!-- MODAL BUAT INVOICE -->
  <div v-if="showModal" class="modal-bg" @click.self="closeModal">
    <div class="modal invoice-modal" style="max-width: 860px">
      <button class="modal-close" @click="closeModal">×</button>

      <h2>Buat Invoice Baru</h2>
      <div class="msub">
        Pilih surat jalan customer yang belum ditagih. Nomor invoice dibuat otomatis.
      </div>

      <div class="auto-number-box">
        <div class="auto-number-icon">🧾</div>
        <div>
          <div class="auto-number-label">NOMOR INVOICE</div>
          <div class="auto-number-value mono">Dibuat otomatis</div>
          <div class="auto-number-note">Format: BMS-INV-YYYYMM-XXXX</div>
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>Divisi</label>
          <select v-model="form.divisi">
            <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <div class="field">
          <label>Customer</label>
          <select v-model="form.customerId">
            <option value="" disabled>Pilih customer</option>
            <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.kode }} — {{ c.nama }}</option>
          </select>
        </div>
      </div>

      <div class="row row-3">
        <div class="field">
          <label>Tanggal</label>
          <input v-model="form.tanggal" type="date" />
        </div>
        <div class="field">
          <label>Jatuh Tempo <span class="optional">(opsional)</span></label>
          <input v-model="form.jatuhTempo" type="date" />
        </div>
        <div class="field">
          <label>Halaman</label>
          <input v-model.number="form.halaman" type="number" min="1" />
        </div>
      </div>

      <div class="section-title" style="margin-top: 8px">
        Surat Jalan Belum Ditagih
        <span class="tag">{{ selectedRows.length }} / {{ rows.length }} dipilih</span>
      </div>

      <div v-if="!form.customerId" class="empty small">Pilih customer dulu untuk melihat surat jalannya.</div>
      <div v-else-if="loadingBelumDitagih" class="empty small">Memuat surat jalan…</div>
      <div v-else-if="!rows.length" class="empty small">
        Tidak ada surat jalan yang belum ditagih untuk customer ini.
      </div>
      <div v-else class="table-wrap">
        <table class="sj-pick-table">
          <thead>
            <tr>
              <th></th>
              <th>No SJ</th>
              <th>Tgl</th>
              <th>Jenis Barang</th>
              <th>No Pol</th>
              <th class="num">M3</th>
              <th class="num">Harga / M3</th>
              <th class="num">Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, idx) in rows" :key="r.suratJalanId">
              <td><input type="checkbox" v-model="r.checked" /></td>
              <td class="mono">{{ r.sj.no }}</td>
              <td>{{ formatTanggal(r.sj.tanggal) }}</td>
              <td>{{ r.sj.jenisBarang || "-" }}</td>
              <td class="mono">{{ r.sj.noPolisi || "-" }}</td>
              <td class="num mono">{{ Number(r.qty || 0).toFixed(3) }}</td>
              <td class="num">
                <input
                  v-model.number="r.hargaSatuan"
                  type="number"
                  min="0"
                  class="price-input"
                  @change="applyHargaToAll(idx)"
                />
              </td>
              <td class="num mono">{{ rupiah(Number(r.hargaSatuan || 0) * Number(r.qty || 0)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="price-hint">Isi harga di satu baris untuk menyalin ke semua baris terpilih, atau ubah manual per baris.</div>

      <div class="invoice-total-preview">
        <span>Perkiraan Total</span>
        <strong class="mono">{{ rupiah(formTotal) }}</strong>
      </div>

      <div class="field" style="margin-top: 16px">
        <label>Catatan</label>
        <textarea v-model="form.catatan" rows="3" placeholder="Catatan tambahan (opsional)"></textarea>
      </div>

      <div class="modal-actions">
        <button class="btn btn-ghost" :disabled="saving" @click="closeModal">Batal</button>
        <button class="btn btn-primary" :disabled="saving" @click="submit">
          <span v-if="saving">Menyimpan…</span>
          <span v-else>Simpan Invoice</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.clickable-row { cursor: pointer; }
.clickable-row:hover td { background: #f5f8fb; }
.invoice-number { font-weight: 700; color: var(--navy); white-space: nowrap; }
.invoice-hint { margin-top: 12px; color: var(--ink-soft); font-size: 11px; }
.auto-number-box { display: flex; align-items: center; gap: 12px; padding: 13px 15px; margin-bottom: 18px; background: linear-gradient(135deg, #f4f8ff, #eef4fb); border: 1px solid #d7e2ef; border-radius: 10px; }
.auto-number-icon { width: 38px; height: 38px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--navy); font-size: 18px; }
.auto-number-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--ink-soft); }
.auto-number-value { margin-top: 2px; font-size: 14px; font-weight: 700; color: var(--navy); }
.auto-number-note { margin-top: 2px; font-size: 10px; color: var(--ink-soft); }
.optional { font-size: 10px; font-weight: 400; }
.row-3 { grid-template-columns: 1fr 1fr 100px; }
.sj-pick-table { min-width: 720px; }
.sj-pick-table th, .sj-pick-table td { white-space: nowrap; }
.price-input { width: 110px; text-align: right; }
.price-hint { font-size: 10.5px; color: var(--ink-soft); margin: 6px 0 4px; }
.empty.small { padding: 18px; font-size: 12px; }
.invoice-total-preview { display: flex; justify-content: space-between; align-items: center; margin-top: 18px; padding: 14px 16px; border-radius: 9px; background: #f5f7f9; border: 1px solid var(--line); }
.invoice-total-preview span { font-size: 12px; color: var(--ink-soft); font-weight: 600; }
.invoice-total-preview strong { font-size: 18px; color: var(--navy); }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); }

@media (max-width: 700px) {
  .invoice-modal { padding: 20px 16px; }
  .row-3 { grid-template-columns: 1fr; }
  .modal-actions { flex-direction: column-reverse; }
  .modal-actions .btn { width: 100%; justify-content: center; }
  .invoice-total-preview strong { font-size: 15px; }
}
</style>
