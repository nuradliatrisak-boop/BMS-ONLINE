<script setup>
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { printInvoice } from "../services/print.js";

const route = useRoute();
const router = useRouter();

const invoice = ref(null);
const loading = ref(true);
const showModal = ref(false);
const showEditModal = ref(false);
const showAddItemModal = ref(false);
const savingEdit = ref(false);
const savingAddItem = ref(false);
const belumDitagihRows = ref([]);
const loadingBelumDitagih = ref(false);
const itemEdits = ref({}); // { [itemId]: { hargaSatuan, qty } }
const customerPrices = computed(() => invoice.value?.customer?.prices || []);
function vehicleTypeForSJ(sj) { return `${sj?.armada?.jenis || ""}`.toUpperCase().includes("TRONTON") ? "TRONTON" : "CD"; }
function suggestedPrice(sj) {
  const stock = `${sj?.jenisBarang || ""}`.trim().toUpperCase();
  const vehicle = vehicleTypeForSJ(sj);
  const p = customerPrices.value.find(x => x.vehicleType === vehicle && `${x.stockName || ""}`.trim().toUpperCase() === stock) || customerPrices.value.find(x => `${x.stockName || ""}`.trim().toUpperCase() === stock);
  return Number(p?.hargaM3 || 0);
}

const form = ref({
  tanggal: new Date().toISOString().slice(0, 10),
  nominal: 0,
  metode: "",
  catatan: "",
});

const editForm = ref({
  tanggal: "",
  jatuhTempo: "",
  halaman: 1,
  catatan: "",
});

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
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
    month: "long",
    year: "numeric",
  });
}

const terbilang = computed(() => {
  if (!invoice.value) return "";

  const angka = Math.round(invoice.value.total || 0);

  if (angka === 0) return "Nol Rupiah";

  const satuan = [
    "",
    "Satu",
    "Dua",
    "Tiga",
    "Empat",
    "Lima",
    "Enam",
    "Tujuh",
    "Delapan",
    "Sembilan",
    "Sepuluh",
    "Sebelas",
  ];

  function angkaKeKata(n) {
    if (n < 12) return satuan[n];

    if (n < 20) {
      return angkaKeKata(n - 10) + " Belas";
    }

    if (n < 100) {
      return (
        angkaKeKata(Math.floor(n / 10)) +
        " Puluh " +
        angkaKeKata(n % 10)
      ).trim();
    }

    if (n < 200) {
      return ("Seratus " + angkaKeKata(n - 100)).trim();
    }

    if (n < 1000) {
      return (
        angkaKeKata(Math.floor(n / 100)) +
        " Ratus " +
        angkaKeKata(n % 100)
      ).trim();
    }

    if (n < 2000) {
      return ("Seribu " + angkaKeKata(n - 1000)).trim();
    }

    if (n < 1000000) {
      return (
        angkaKeKata(Math.floor(n / 1000)) +
        " Ribu " +
        angkaKeKata(n % 1000)
      ).trim();
    }

    if (n < 1000000000) {
      return (
        angkaKeKata(Math.floor(n / 1000000)) +
        " Juta " +
        angkaKeKata(n % 1000000)
      ).trim();
    }

    if (n < 1000000000000) {
      return (
        angkaKeKata(Math.floor(n / 1000000000)) +
        " Miliar " +
        angkaKeKata(n % 1000000000)
      ).trim();
    }

    return (
      angkaKeKata(Math.floor(n / 1000000000000)) +
      " Triliun " +
      angkaKeKata(n % 1000000000000)
    ).trim();
  }

  return `${angkaKeKata(angka)} Rupiah`;
});

async function load() {
  try {
    loading.value = true;
    invoice.value = await api.get(`/invoices/${route.params.id}`);
    itemEdits.value = {};
    for (const it of invoice.value.items) {
      itemEdits.value[it.id] = { hargaSatuan: it.hargaSatuan, qty: it.qty };
    }
  } catch (e) {
    toast(e?.message || "Gagal memuat invoice");
  } finally {
    loading.value = false;
  }
}

function cetakInvoice() {
  if (!invoice.value) return;
  printInvoice(invoice.value);
}

const exportingXlsx = ref(false);

async function exportInvoiceXlsx() {
  if (!invoice.value) return;
  exportingXlsx.value = true;
  try {
    await api.download(
      `/invoices/${invoice.value.id}/export-xlsx`,
      `Invoice-${invoice.value.no}.xlsx`
    );
  } catch (e) {
    toast(e?.message || "Gagal mengunduh Excel invoice");
  } finally {
    exportingXlsx.value = false;
  }
}

function openEditModal() {
  if (!invoice.value) return;
  editForm.value = {
    tanggal: invoice.value.tanggal ? new Date(invoice.value.tanggal).toISOString().slice(0, 10) : "",
    jatuhTempo: invoice.value.jatuhTempo
      ? new Date(invoice.value.jatuhTempo).toISOString().slice(0, 10)
      : "",
    halaman: invoice.value.halaman || 1,
    catatan: invoice.value.catatan || "",
  };
  showEditModal.value = true;
}

async function submitEditInvoice() {
  savingEdit.value = true;
  try {
    invoice.value = await api.put(`/invoices/${route.params.id}`, {
      customerId: invoice.value.customerId,
      tanggal: editForm.value.tanggal,
      jatuhTempo: editForm.value.jatuhTempo || null,
      halaman: Number(editForm.value.halaman) || 1,
      catatan: editForm.value.catatan || null,
    });
    toast("Invoice berhasil diperbarui");
    showEditModal.value = false;
  } catch (e) {
    toast(e?.message || "Gagal memperbarui invoice");
  } finally {
    savingEdit.value = false;
  }
}

async function hapusInvoice() {
  if (!invoice.value) return;
  if (!confirm(`Hapus invoice ${invoice.value.no}? Surat jalan yang dipakai akan kembali berstatus belum ditagih.`)) return;
  try {
    await api.delete(`/invoices/${route.params.id}`);
    toast("Invoice berhasil dihapus");
    router.push({ name: "invoices" });
  } catch (e) {
    toast(e?.message || "Gagal menghapus invoice");
  }
}

async function openAddItemModal() {
  showAddItemModal.value = true;
  loadingBelumDitagih.value = true;
  try {
    const list = await api.get(
      `/surat-jalan/belum-ditagih?customerId=${invoice.value.customerId}`
    );
    belumDitagihRows.value = list.map((sj) => ({
      suratJalanId: sj.id,
      sj,
      checked: false,
      hargaSatuan: suggestedPrice(sj),
    }));
  } catch (e) {
    toast(e?.message || "Gagal memuat surat jalan yang belum ditagih");
  } finally {
    loadingBelumDitagih.value = false;
  }
}

async function submitAddItems() {
  const picked = belumDitagihRows.value.filter((r) => r.checked);
  if (!picked.length) {
    return toast("Pilih minimal 1 surat jalan");
  }
  savingAddItem.value = true;
  try {
    for (const r of picked) {
      await api.post(`/invoices/${route.params.id}/items`, {
        suratJalanId: r.suratJalanId,
        hargaSatuan: Number(r.hargaSatuan) || 0,
      });
    }
    toast("Item berhasil ditambahkan");
    showAddItemModal.value = false;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menambahkan item");
  } finally {
    savingAddItem.value = false;
  }
}

async function updateItemHarga(item) {
  const edit = itemEdits.value[item.id];
  if (!edit) return;
  try {
    invoice.value = await api.put(`/invoices/${route.params.id}/items/${item.id}`, {
      hargaSatuan: Number(edit.hargaSatuan) || 0,
      qty: Number(edit.qty) || 0,
    });
    itemEdits.value[item.id] = { hargaSatuan: edit.hargaSatuan, qty: edit.qty };
    toast("Harga item diperbarui");
  } catch (e) {
    toast(e?.message || "Gagal memperbarui harga item");
  }
}

async function hapusItem(item) {
  if (!confirm("Hapus baris item ini dari invoice?")) return;
  try {
    invoice.value = await api.delete(`/invoices/${route.params.id}/items/${item.id}`);
    toast("Item dihapus");
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menghapus item");
  }
}

async function submitPembayaran() {
  if (!form.value.nominal) {
    return toast("Nominal wajib diisi");
  }

  if (Number(form.value.nominal) <= 0) {
    return toast("Nominal pembayaran harus lebih dari 0");
  }

  if (Number(form.value.nominal) > Number(invoice.value.sisaTagihan)) {
    return toast("Nominal pembayaran melebihi sisa tagihan");
  }

  try {
    await api.post(
      `/invoices/${route.params.id}/pembayaran`,
      form.value
    );

    toast("Pembayaran dicatat");

    showModal.value = false;

    form.value = {
      tanggal: new Date().toISOString().slice(0, 10),
      nominal: 0,
      metode: "",
      catatan: "",
    };

    await load();
  } catch (e) {
    toast(e?.message || "Gagal mencatat pembayaran");
  }
}

onMounted(load);
</script>

<template>
  <!-- AREA APLIKASI -->
  <div class="screen-only">
    <div class="topbar">
      <div>
        <h1 v-if="invoice">Invoice {{ invoice.no }}</h1>
        <div class="desc">
          Detail tagihan &amp; riwayat pembayaran
        </div>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button
          class="btn btn-gold"
          @click="cetakInvoice"
          :disabled="!invoice"
        >
          🖨 Cetak Invoice
        </button>

        <button
          class="btn btn-ghost"
          @click="exportInvoiceXlsx"
          :disabled="!invoice || exportingXlsx"
        >
          {{ exportingXlsx ? "Menyiapkan..." : "📊 Export ke Excel" }}
        </button>

        <button
          class="btn btn-ghost"
          @click="openEditModal"
          :disabled="!invoice"
        >
          Edit
        </button>

        <button
          class="btn btn-danger"
          @click="hapusInvoice"
          :disabled="!invoice"
        >
          Hapus
        </button>

        <button
          class="btn btn-ghost"
          @click="router.push({ name: 'invoices' })"
        >
          ← Kembali
        </button>
      </div>
    </div>

    <div class="content">
      <div v-if="loading" class="empty">
        Memuat data…
      </div>

      <div v-else class="grid g2">
        <div class="card">
          <div class="section-title">
            Rincian Item

            <span
              class="badge"
              :class="badgeClass(invoice.status)"
            >
              {{ invoice.status }}
            </span>

            <button
              class="btn btn-sm btn-ghost"
              style="margin-left:auto"
              @click="openAddItemModal"
            >
              + Tambah Item
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Keterangan</th>
                <th class="num">Qty</th>
                <th class="num">Harga</th>
                <th class="num">Subtotal</th>
                <th class="action-col">Aksi</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="it in invoice.items"
                :key="it.id"
              >
                <td>
                  {{ it.keterangan }}
                  <div v-if="it.suratJalan" class="item-sj-sub">SJ: {{ it.suratJalan.no }}</div>
                </td>

                <td class="num mono">
                  {{ it.qty }} {{ it.satuan }}
                </td>

                <td class="num">
                  <input
                    v-if="itemEdits[it.id]"
                    v-model.number="itemEdits[it.id].hargaSatuan"
                    type="number"
                    min="0"
                    class="item-harga-input"
                  />
                </td>

                <td class="num mono">
                  {{ rupiah(it.qty * it.hargaSatuan) }}
                </td>

                <td class="item-actions">
                  <button class="btn btn-sm btn-ghost" @click="updateItemHarga(it)">Update</button>
                  <button class="btn btn-sm btn-danger" @click="hapusItem(it)">Hapus</button>
                </td>
              </tr>
            </tbody>
          </table>

          <div
            style="
              display:flex;
              justify-content:space-between;
              margin-top:14px;
              font-weight:700;
            "
          >
            <span>Total</span>
            <span class="mono">
              {{ rupiah(invoice.total) }}
            </span>
          </div>

          <div
            style="
              display:flex;
              justify-content:space-between;
              color:var(--ink-soft);
              font-size:13px;
            "
          >
            <span>Sudah Dibayar</span>
            <span class="mono">
              {{ rupiah(invoice.dibayar) }}
            </span>
          </div>

          <div
            style="
              display:flex;
              justify-content:space-between;
              color:var(--stamp);
              font-weight:600;
            "
          >
            <span>Sisa Tagihan</span>
            <span class="mono">
              {{ rupiah(invoice.sisaTagihan) }}
            </span>
          </div>
        </div>

        <div class="card">
          <div class="section-title">
            Riwayat Pembayaran
          </div>

          <div
            v-if="!invoice.pembayaran.length"
            class="empty"
          >
            Belum ada pembayaran.
          </div>

          <table v-else>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th class="num">Nominal</th>
                <th>Metode</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="p in invoice.pembayaran"
                :key="p.id"
              >
                <td>
                  {{ formatTanggal(p.tanggal) }}
                </td>

                <td class="num mono">
                  {{ rupiah(p.nominal) }}
                </td>

                <td>
                  {{ p.metode || "-" }}
                </td>
              </tr>
            </tbody>
          </table>

          <button
            class="btn btn-gold"
            style="margin-top:14px;"
            @click="showModal = true"
            :disabled="invoice.status === 'LUNAS'"
          >
            + Catat Pembayaran
          </button>
        </div>
      </div>
    </div>

    <!-- MODAL EDIT INVOICE -->
    <div v-if="showEditModal" class="modal-bg" @click.self="showEditModal = false">
      <div class="modal">
        <button class="modal-close" @click="showEditModal = false">×</button>
        <h2>Edit Invoice {{ invoice?.no }}</h2>

        <div class="row">
          <div class="field">
            <label>Tanggal</label>
            <input v-model="editForm.tanggal" type="date" />
          </div>
          <div class="field">
            <label>Jatuh Tempo</label>
            <input v-model="editForm.jatuhTempo" type="date" />
          </div>
        </div>
        <div class="field">
          <label>Halaman</label>
          <input v-model.number="editForm.halaman" type="number" min="1" />
        </div>
        <div class="field">
          <label>Catatan</label>
          <textarea v-model="editForm.catatan" rows="3"></textarea>
        </div>

        <button class="btn btn-primary" :disabled="savingEdit" @click="submitEditInvoice">
          {{ savingEdit ? "Menyimpan..." : "Simpan Perubahan" }}
        </button>
      </div>
    </div>

    <!-- MODAL TAMBAH ITEM DARI SURAT JALAN -->
    <div v-if="showAddItemModal" class="modal-bg" @click.self="showAddItemModal = false">
      <div class="modal" style="max-width:720px">
        <button class="modal-close" @click="showAddItemModal = false">×</button>
        <h2>Tambah Item dari Surat Jalan</h2>
        <div class="msub">Surat jalan customer ini yang belum ditagih di invoice manapun.</div>

        <div v-if="loadingBelumDitagih" class="empty small">Memuat surat jalan…</div>
        <div v-else-if="!belumDitagihRows.length" class="empty small">
          Tidak ada surat jalan yang belum ditagih untuk customer ini.
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>No SJ</th>
                <th>Jenis Barang</th>
                <th class="num">M3</th>
                <th class="num">Harga / M3</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in belumDitagihRows" :key="r.suratJalanId">
                <td><input type="checkbox" v-model="r.checked" /></td>
                <td class="mono">{{ r.sj.no }}</td>
                <td>{{ r.sj.jenisBarang || "-" }}</td>
                <td class="num mono">{{ Number(r.sj.m3 || 0).toFixed(3) }}</td>
                <td class="num"><input v-model.number="r.hargaSatuan" type="number" min="0" class="item-harga-input" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="savingAddItem" @click="showAddItemModal = false">Batal</button>
          <button class="btn btn-primary" :disabled="savingAddItem" @click="submitAddItems">
            {{ savingAddItem ? "Menyimpan..." : "Tambahkan Item Terpilih" }}
          </button>
        </div>
      </div>
    </div>

    <!-- MODAL PEMBAYARAN -->
    <div
      v-if="showModal"
      class="modal-bg"
      @click.self="showModal = false"
    >
      <div class="modal">
        <button
          class="modal-close"
          @click="showModal = false"
        >
          ×
        </button>

        <h2>Catat Pembayaran</h2>

        <div class="row">
          <div class="field">
            <label>Tanggal</label>
            <input
              v-model="form.tanggal"
              type="date"
            />
          </div>

          <div class="field">
            <label>Nominal</label>
            <input
              v-model.number="form.nominal"
              type="number"
              min="1"
            />
          </div>
        </div>

        <div class="field">
          <label>Metode</label>
          <input
            v-model="form.metode"
            placeholder="Transfer, Tunai, dll"
          />
        </div>

        <div class="field">
          <label>Catatan</label>
          <textarea
            v-model="form.catatan"
            rows="2"
          ></textarea>
        </div>

        <button
          class="btn btn-primary"
          @click="submitPembayaran"
        >
          Simpan
        </button>
      </div>
    </div>
  </div>

  <!-- ========================= -->
  <!-- DOKUMEN YANG AKAN DICETAK -->
  <!-- ========================= -->
  <div
    v-if="invoice"
    class="invoice-print"
  >
    <div class="invoice-paper">

      <!-- HEADER PERUSAHAAN -->
      <div class="invoice-header">
        <div class="company">
          <div class="company-name">
            PT BINTANG MUARA SEJATI
          </div>

          <div class="company-line">
            {{ invoice.divisi }}
          </div>

          <div class="company-address">
            Alamat perusahaan<br />
            Telp. / Email perusahaan
          </div>
        </div>

        <div class="invoice-title">
          <div class="invoice-label">
            INVOICE
          </div>

          <div class="invoice-number">
            {{ invoice.no }}
          </div>
        </div>
      </div>

      <div class="invoice-divider"></div>

      <!-- CUSTOMER -->
      <div class="invoice-meta">
        <div class="bill-to">
          <div class="meta-label">
            KEPADA YTH.
          </div>

          <div class="customer-name">
            {{ invoice.customer?.nama || "-" }}
          </div>

          <div v-if="invoice.customer?.alamat">
            {{ invoice.customer.alamat }}
          </div>

          <div v-if="invoice.customer?.telepon">
            Telp: {{ invoice.customer.telepon }}
          </div>

          <div v-if="invoice.customer?.npwp">
            NPWP: {{ invoice.customer.npwp }}
          </div>
        </div>

        <div class="invoice-info">
          <div class="info-row">
            <span>Tanggal</span>
            <strong>
              {{ formatTanggal(invoice.tanggal) }}
            </strong>
          </div>

          <div class="info-row">
            <span>Jatuh Tempo</span>
            <strong>
              {{ formatTanggal(invoice.jatuhTempo) }}
            </strong>
          </div>

          <div class="info-row">
            <span>Status</span>
            <strong>
              {{ invoice.status }}
            </strong>
          </div>
        </div>
      </div>

      <!-- ITEM -->
      <table class="invoice-table">
        <thead>
          <tr>
            <th style="width:45px;">No</th>
            <th>Keterangan</th>
            <th style="width:80px;">Qty</th>
            <th style="width:100px;">Satuan</th>
            <th style="width:145px;">Harga Satuan</th>
            <th style="width:155px;">Jumlah</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="(it, index) in invoice.items"
            :key="it.id"
          >
            <td class="center">
              {{ index + 1 }}
            </td>

            <td>
              {{ it.keterangan }}
            </td>

            <td class="center">
              {{ it.qty }}
            </td>

            <td class="center">
              {{ it.satuan || "-" }}
            </td>

            <td class="right">
              {{ rupiah(it.hargaSatuan) }}
            </td>

            <td class="right">
              {{ rupiah(it.qty * it.hargaSatuan) }}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- TOTAL -->
      <div class="invoice-bottom">
        <div class="terbilang">
          <div class="meta-label">
            TERBILANG
          </div>

          <div class="terbilang-text">
            # {{ terbilang }} #
          </div>

          <div
            v-if="invoice.catatan"
            class="print-note"
          >
            <strong>Catatan:</strong>
            {{ invoice.catatan }}
          </div>
        </div>

        <div class="totals">
          <div class="total-row">
            <span>TOTAL</span>
            <strong>
              {{ rupiah(invoice.total) }}
            </strong>
          </div>

          <div class="total-row">
            <span>DIBAYAR</span>
            <strong>
              {{ rupiah(invoice.dibayar) }}
            </strong>
          </div>

          <div class="total-row grand">
            <span>SISA TAGIHAN</span>
            <strong>
              {{ rupiah(invoice.sisaTagihan) }}
            </strong>
          </div>
        </div>
      </div>

      <!-- PEMBAYARAN -->
      <div
        v-if="invoice.pembayaran?.length"
        class="payment-history"
      >
        <div class="meta-label">
          RIWAYAT PEMBAYARAN
        </div>

        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Metode</th>
              <th class="right">Nominal</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="p in invoice.pembayaran"
              :key="p.id"
            >
              <td>
                {{ formatTanggal(p.tanggal) }}
              </td>

              <td>
                {{ p.metode || "-" }}
              </td>

              <td class="right">
                {{ rupiah(p.nominal) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- TANDA TANGAN -->
      <div class="signature-area">
        <div class="signature-box">
          <div>
            Hormat kami,
          </div>

          <div class="signature-space"></div>

          <strong>
            PT BINTANG MUARA SEJATI
          </strong>
        </div>

        <div class="signature-box">
          <div>
            Customer,
          </div>

          <div class="signature-space"></div>

          <strong>
            ______________________
          </strong>
        </div>
      </div>

      <div class="invoice-footer">
        Dokumen ini dibuat secara elektronik dan merupakan dokumen resmi
        PT Bintang Muara Sejati.
      </div>
    </div>
  </div>
</template>

<style scoped>
.item-sj-sub { font-size: 10.5px; color: var(--ink-soft); }
.item-harga-input { width: 110px; text-align: right; }
.item-actions { display: flex; gap: 6px; white-space: nowrap; }
.empty.small { padding: 18px; font-size: 12px; }
</style>

<style>
/* ==============================
   PRINT INVOICE
   ============================== */

.invoice-print {
  display: none;
}

@media print {
  @page {
    size: A4;
    margin: 12mm;
  }

  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    background: white !important;
  }

  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .screen-only {
    display: none !important;
  }

  .invoice-print {
    display: block !important;
    width: 100%;
  }

  .invoice-paper {
    width: 100%;
    min-height: 260mm;
    box-sizing: border-box;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    color: #111;
  }

  .invoice-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .company-name {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: .5px;
  }

  .company-line {
    margin-top: 3px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .company-address {
    margin-top: 7px;
    line-height: 1.5;
    color: #444;
  }

  .invoice-title {
    text-align: right;
  }

  .invoice-label {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: 2px;
  }

  .invoice-number {
    margin-top: 5px;
    font-size: 14px;
    font-weight: 700;
  }

  .invoice-divider {
    border-bottom: 2px solid #111;
    margin: 14px 0 18px;
  }

  .invoice-meta {
    display: flex;
    justify-content: space-between;
    margin-bottom: 20px;
  }

  .bill-to {
    width: 55%;
    line-height: 1.55;
  }

  .meta-label {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 1px;
    margin-bottom: 4px;
    color: #555;
  }

  .customer-name {
    font-size: 14px;
    font-weight: 700;
  }

  .invoice-info {
    width: 35%;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px solid #ddd;
    padding: 5px 0;
  }

  .info-row span {
    color: #555;
  }

  .invoice-table {
    width: 100%;
    border-collapse: collapse;
  }

  .invoice-table th {
    background: #eee;
    border: 1px solid #999;
    padding: 8px 6px;
    font-size: 10px;
    text-transform: uppercase;
  }

  .invoice-table td {
    border: 1px solid #bbb;
    padding: 8px 6px;
    vertical-align: top;
  }

  .center {
    text-align: center;
  }

  .right {
    text-align: right;
  }

  .invoice-bottom {
    display: flex;
    justify-content: space-between;
    margin-top: 18px;
    gap: 25px;
  }

  .terbilang {
    flex: 1;
  }

  .terbilang-text {
    font-style: italic;
    font-weight: 600;
    line-height: 1.5;
  }

  .print-note {
    margin-top: 20px;
    line-height: 1.5;
  }

  .totals {
    width: 300px;
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 8px;
    border-bottom: 1px solid #ddd;
  }

  .total-row.grand {
    margin-top: 3px;
    border: 1px solid #111;
    font-size: 14px;
    font-weight: 800;
  }

  .payment-history {
    margin-top: 25px;
    width: 65%;
  }

  .payment-history table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 7px;
  }

  .payment-history th,
  .payment-history td {
    border: 1px solid #bbb;
    padding: 6px;
  }

  .payment-history th {
    background: #eee;
    text-align: left;
  }

  .signature-area {
    display: flex;
    justify-content: space-between;
    margin-top: 45px;
  }

  .signature-box {
    width: 220px;
    text-align: center;
    line-height: 1.5;
  }

  .signature-space {
    height: 65px;
  }

  .invoice-footer {
    border-top: 1px solid #bbb;
    margin-top: 35px;
    padding-top: 8px;
    text-align: center;
    color: #666;
    font-size: 9px;
  }
}
</style>