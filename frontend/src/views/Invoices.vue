<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const DIVISI = [
  "Supplier",
  "Armada",
  "Alat Berat",
  "Kontraktor",
  "Kapal",
];

const router = useRouter();

const invoices = ref([]);
const customers = ref([]);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);

const emptyForm = () => ({
  divisi: DIVISI[0],
  customerId: "",
  tanggal: new Date().toISOString().slice(0, 10),
  jatuhTempo: "",
  catatan: "",
  items: [
    {
      keterangan: "",
      qty: 1,
      satuan: "",
      hargaSatuan: 0,
    },
  ],
});

const form = ref(emptyForm());

function rupiah(n) {
  return (
    "Rp " +
    Math.round(Number(n) || 0).toLocaleString("id-ID")
  );
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

function hitungSubtotal(item) {
  return (
    Number(item.qty || 0) *
    Number(item.hargaSatuan || 0)
  );
}

function hitungFormTotal() {
  return form.value.items.reduce(
    (total, item) => total + hitungSubtotal(item),
    0
  );
}

async function load() {
  loading.value = true;

  try {
    const [invoiceData, customerData] =
      await Promise.all([
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

function openModal() {
  form.value = emptyForm();
  showModal.value = true;
}

function closeModal() {
  if (saving.value) return;

  showModal.value = false;
}

function addItem() {
  form.value.items.push({
    keterangan: "",
    qty: 1,
    satuan: "",
    hargaSatuan: 0,
  });
}

function removeItem(idx) {
  if (form.value.items.length === 1) {
    return;
  }

  form.value.items.splice(idx, 1);
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

  if (!form.value.items.length) {
    toast("Minimal harus ada 1 item");
    return false;
  }

  for (const item of form.value.items) {
    if (!item.keterangan?.trim()) {
      toast("Keterangan item wajib diisi");
      return false;
    }

    if (Number(item.qty) <= 0) {
      toast("Qty harus lebih dari 0");
      return false;
    }

    if (Number(item.hargaSatuan) < 0) {
      toast("Harga satuan tidak boleh negatif");
      return false;
    }
  }

  return true;
}

async function submit() {
  if (!validateForm()) return;

  saving.value = true;

  try {
    /*
     * Nomor invoice TIDAK dikirim dari frontend.
     * Backend yang akan membuat nomor otomatis:
     *
     * BMS-INV-YYYYMM-0001
     */

    const payload = {
      divisi: form.value.divisi,
      customerId: form.value.customerId,
      tanggal: form.value.tanggal,
      jatuhTempo: form.value.jatuhTempo || null,
      catatan: form.value.catatan || null,

      items: form.value.items.map((item) => ({
        keterangan: item.keterangan.trim(),
        qty: Number(item.qty),
        satuan: item.satuan?.trim() || null,
        hargaSatuan: Number(item.hargaSatuan),
      })),
    };

    const created = await api.post(
      "/invoices",
      payload
    );

    toast(
      `Invoice ${created.no} berhasil dibuat`
    );

    showModal.value = false;

    await load();
  } catch (error) {
    console.error(error);

    toast(
      error?.message ||
        "Gagal membuat invoice"
    );
  } finally {
    saving.value = false;
  }
}

function goDetail(id) {
  router.push({
    name: "invoice-detail",
    params: { id },
  });
}

onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Invoice</h1>
      <div class="desc">
        Tagihan ke customer
      </div>
    </div>

    <button
      class="btn btn-primary"
      @click="openModal"
    >
      + Buat Invoice
    </button>
  </div>

  <div class="content">
    <!-- LOADING -->
    <div
      v-if="loading"
      class="empty"
    >
      Memuat data…
    </div>

    <!-- EMPTY -->
    <div
      v-else-if="!invoices.length"
      class="empty"
    >
      <div class="big">🧾</div>

      <div>
        Belum ada invoice.
      </div>

      <button
        class="btn btn-primary"
        style="margin-top: 14px"
        @click="openModal"
      >
        + Buat Invoice Pertama
      </button>
    </div>

    <!-- DATA -->
    <div
      v-else
      class="card invoice-table-card"
    >
      <div class="section-title">
        Daftar Invoice

        <span class="tag">
          {{ invoices.length }} Invoice
        </span>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No Invoice</th>
              <th>Customer</th>
              <th>Divisi</th>
              <th>Tanggal</th>
              <th class="num">
                Total
              </th>
              <th class="num">
                Sisa
              </th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="i in invoices"
              :key="i.id"
              class="clickable-row"
              @click="goDetail(i.id)"
            >
              <td>
                <span class="invoice-number mono">
                  {{ i.no }}
                </span>
              </td>

              <td>
                <strong>
                  {{ i.customer?.nama || "-" }}
                </strong>
              </td>

              <td>
                {{ i.divisi }}
              </td>

              <td>
                {{ formatTanggal(i.tanggal) }}
              </td>

              <td class="num mono">
                {{ rupiah(i.total) }}
              </td>

              <td class="num mono">
                {{ rupiah(i.sisaTagihan) }}
              </td>

              <td>
                <span
                  class="badge"
                  :class="badgeClass(i.status)"
                >
                  {{ i.status }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="invoice-hint">
        Klik baris invoice untuk melihat detail dan pembayaran.
      </div>
    </div>
  </div>

  <!-- MODAL BUAT INVOICE -->
  <div
    v-if="showModal"
    class="modal-bg"
    @click.self="closeModal"
  >
    <div
      class="modal invoice-modal"
      style="max-width: 760px"
    >
      <button
        class="modal-close"
        @click="closeModal"
      >
        ×
      </button>

      <h2>Buat Invoice Baru</h2>

      <div class="msub">
        Isi data tagihan dan rincian barang/jasa.
        Nomor invoice akan dibuat otomatis oleh sistem.
      </div>

      <!-- NOMOR OTOMATIS -->
      <div class="auto-number-box">
        <div class="auto-number-icon">
          🧾
        </div>

        <div>
          <div class="auto-number-label">
            NOMOR INVOICE
          </div>

          <div class="auto-number-value mono">
            Dibuat otomatis
          </div>

          <div class="auto-number-note">
            Format: BMS-INV-YYYYMM-XXXX
          </div>
        </div>
      </div>

      <!-- DIVISI + CUSTOMER -->
      <div class="row">
        <div class="field">
          <label>
            Divisi
          </label>

          <select
            v-model="form.divisi"
          >
            <option
              v-for="d in DIVISI"
              :key="d"
              :value="d"
            >
              {{ d }}
            </option>
          </select>
        </div>

        <div class="field">
          <label>
            Customer
          </label>

          <select
            v-model="form.customerId"
          >
            <option
              value=""
              disabled
            >
              Pilih customer
            </option>

            <option
              v-for="c in customers"
              :key="c.id"
              :value="c.id"
            >
              {{ c.nama }}
            </option>
          </select>
        </div>
      </div>

      <!-- TANGGAL -->
      <div class="row">
        <div class="field">
          <label>
            Tanggal
          </label>

          <input
            v-model="form.tanggal"
            type="date"
          />
        </div>

        <div class="field">
          <label>
            Jatuh Tempo
            <span class="optional">
              (opsional)
            </span>
          </label>

          <input
            v-model="form.jatuhTempo"
            type="date"
          />
        </div>
      </div>

      <!-- ITEM -->
      <div
        class="section-title"
        style="margin-top: 8px"
      >
        Rincian Item
      </div>

      <div
        v-for="(it, idx) in form.items"
        :key="idx"
        class="invoice-item"
      >
        <div class="field item-description">
          <label>
            Keterangan
          </label>

          <input
            v-model="it.keterangan"
            placeholder="Nama barang / jasa"
          />
        </div>

        <div class="field item-qty">
          <label>
            Qty
          </label>

          <input
            v-model.number="it.qty"
            type="number"
            min="0.01"
            step="any"
          />
        </div>

        <div class="field item-unit">
          <label>
            Satuan
          </label>

          <input
            v-model="it.satuan"
            placeholder="pcs"
          />
        </div>

        <div class="field item-price">
          <label>
            Harga Satuan
          </label>

          <input
            v-model.number="it.hargaSatuan"
            type="number"
            min="0"
            step="any"
          />
        </div>

        <button
          class="btn btn-sm btn-danger item-delete"
          :disabled="
            form.items.length === 1
          "
          @click="removeItem(idx)"
        >
          Hapus
        </button>
      </div>

      <button
        class="btn btn-ghost btn-sm"
        @click="addItem"
      >
        + Tambah Item
      </button>

      <!-- TOTAL PREVIEW -->
      <div class="invoice-total-preview">
        <span>
          Perkiraan Total
        </span>

        <strong class="mono">
          {{ rupiah(hitungFormTotal()) }}
        </strong>
      </div>

      <!-- CATATAN -->
      <div
        class="field"
        style="margin-top: 16px"
      >
        <label>
          Catatan
        </label>

        <textarea
          v-model="form.catatan"
          rows="3"
          placeholder="Catatan tambahan (opsional)"
        ></textarea>
      </div>

      <!-- ACTION -->
      <div class="modal-actions">
        <button
          class="btn btn-ghost"
          :disabled="saving"
          @click="closeModal"
        >
          Batal
        </button>

        <button
          class="btn btn-primary"
          :disabled="saving"
          @click="submit"
        >
          <span v-if="saving">
            Menyimpan…
          </span>

          <span v-else>
            Simpan Invoice
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.clickable-row {
  cursor: pointer;
}

.clickable-row:hover td {
  background: #f5f8fb;
}

.invoice-number {
  font-weight: 700;
  color: var(--navy);
  white-space: nowrap;
}

.invoice-hint {
  margin-top: 12px;
  color: var(--ink-soft);
  font-size: 11px;
}

.auto-number-box {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 15px;
  margin-bottom: 18px;
  background: linear-gradient(
    135deg,
    #f4f8ff,
    #eef4fb
  );
  border: 1px solid #d7e2ef;
  border-radius: 10px;
}

.auto-number-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: var(--navy);
  font-size: 18px;
}

.auto-number-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-soft);
}

.auto-number-value {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 700;
  color: var(--navy);
}

.auto-number-note {
  margin-top: 2px;
  font-size: 10px;
  color: var(--ink-soft);
}

.optional {
  font-size: 10px;
  font-weight: 400;
}

.invoice-item {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 4px;
}

.invoice-item .field {
  margin-bottom: 13px;
}

.item-description {
  flex: 2;
}

.item-qty {
  flex: 0 0 80px;
}

.item-unit {
  flex: 0 0 100px;
}

.item-price {
  flex: 1.2;
}

.item-delete {
  flex: 0 0 auto;
  margin-bottom: 13px;
}

.invoice-total-preview {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 9px;
  background: #f5f7f9;
  border: 1px solid var(--line);
}

.invoice-total-preview span {
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 600;
}

.invoice-total-preview strong {
  font-size: 18px;
  color: var(--navy);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

@media (max-width: 700px) {
  .invoice-modal {
    padding: 20px 16px;
  }

  .invoice-item {
    display: grid;
    grid-template-columns: 1fr 80px;
    gap: 4px 10px;
  }

  .item-description {
    grid-column: 1 / -1;
  }

  .item-qty {
    grid-column: 1;
  }

  .item-unit {
    grid-column: 2;
  }

  .item-price {
    grid-column: 1 / -1;
  }

  .item-delete {
    grid-column: 1 / -1;
    margin-bottom: 13px;
  }

  .modal-actions {
    flex-direction: column-reverse;
  }

  .modal-actions .btn {
    width: 100%;
    justify-content: center;
  }

  .invoice-total-preview strong {
    font-size: 15px;
  }
}

@media (max-width: 520px) {
  .auto-number-box {
    padding: 11px;
  }

  .auto-number-value {
    font-size: 12px;
  }
}
</style>