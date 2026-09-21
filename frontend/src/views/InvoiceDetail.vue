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
const showAddTensivModal = ref(false);
const savingEdit = ref(false);
const savingAddItem = ref(false);
const belumDitagihRows = ref([]);
const belumDitagihTensivRows = ref([]);
const loadingBelumDitagih = ref(false);
const loadingBelumDitagihTensiv = ref(false);
const savingAddTensivItem = ref(false);
const itemEdits = ref({}); // { [itemId]: { hargaSatuan, qty } }
const biayaEdits = ref({}); // { [itemId]: { belanjaPasir, uangMobil, uangJalan, uangKomisi, uangMakan } }
const unitAlatList = ref([]); // master AlatBeratUnit (buat datalist saran nama unit, samain sama Tensiv)
const openBiayaId = ref(null); // id item yang lagi dibuka rincian biayanya

function toggleBiaya(itemId) {
  openBiayaId.value = openBiayaId.value === itemId ? null : itemId;
}

async function simpanBiaya(item) {
  const b = biayaEdits.value[item.id];
  if (!b) return;
  try {
    invoice.value = await api.put(`/invoices/${route.params.id}/items/${item.id}`, {
      belanjaPasir: b.belanjaPasir === "" ? null : Number(b.belanjaPasir),
      uangMobil: b.uangMobil === "" ? null : Number(b.uangMobil),
      uangJalan: b.uangJalan === "" ? null : Number(b.uangJalan),
      uangKomisi: b.uangKomisi === "" ? null : Number(b.uangKomisi),
      uangMakan: b.uangMakan === "" ? null : Number(b.uangMakan),
    });
    biayaEdits.value = {};
    for (const it of invoice.value.items) {
      biayaEdits.value[it.id] = {
        belanjaPasir: it.belanjaPasir ?? "",
        uangMobil: it.uangMobil ?? "",
        uangJalan: it.uangJalan ?? "",
        uangKomisi: it.uangKomisi ?? "",
        uangMakan: it.uangMakan ?? "",
      };
    }
    toast("Rincian biaya berhasil disimpan");
    openBiayaId.value = null;
  } catch (e) {
    toast(e?.message || "Gagal menyimpan rincian biaya");
  }
}
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
    biayaEdits.value = {};
    for (const it of invoice.value.items) {
      biayaEdits.value[it.id] = {
        belanjaPasir: it.belanjaPasir ?? "",
        uangMobil: it.uangMobil ?? "",
        uangJalan: it.uangJalan ?? "",
        uangKomisi: it.uangKomisi ?? "",
        uangMakan: it.uangMakan ?? "",
      };
    }
    if (!unitAlatList.value.length) {
      try {
        unitAlatList.value = await api.get("/alat-berat-unit");
      } catch {
        // gagal ambil master unit bukan fatal, form manual tetap bisa diisi bebas
      }
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

// --- TAMBAH ITEM DARI TENSIV (Daftar Kerja Harian alat berat) ---
// dipakai baik oleh modal "+ Dari Tensiv" maupun buat kasih hint otomatis
// pas staf ngetik Unit Alat di form manual, supaya kalau ternyata sudah ada
// rekaman Tensiv unit itu yang belum ditagih, staf diarahkan pakai itu
// (bukan input manual lagi) -- ini yang bikin Tensiv & Invoice selalu nyambung.
async function loadBelumDitagihTensiv({ silent = false } = {}) {
  loadingBelumDitagihTensiv.value = true;
  try {
    const list = await api.get(
      `/tensiv/belum-ditagih?customerId=${invoice.value.customerId}`
    );
    belumDitagihTensivRows.value = list.map((ts) => ({
      tensivId: ts.id,
      ts,
      checked: false,
      hargaSatuan: 0,
    }));
  } catch (e) {
    if (!silent) toast(e?.message || "Gagal memuat Tensiv yang belum ditagih");
  } finally {
    loadingBelumDitagihTensiv.value = false;
  }
}

async function openAddTensivModal() {
  showAddTensivModal.value = true;
  await loadBelumDitagihTensiv();
}

async function submitAddTensivItems() {
  const picked = belumDitagihTensivRows.value.filter((r) => r.checked);
  if (!picked.length) {
    return toast("Pilih minimal 1 Tensiv");
  }
  savingAddTensivItem.value = true;
  try {
    for (const r of picked) {
      await api.post(`/invoices/${route.params.id}/items`, {
        tensivId: r.tensivId,
        hargaSatuan: Number(r.hargaSatuan) || 0,
      });
    }
    toast("Item berhasil ditambahkan");
    showAddTensivModal.value = false;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menambahkan item");
  } finally {
    savingAddTensivItem.value = false;
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

// --- TAMBAH ITEM MANUAL (khusus sewa alat berat / item non-Surat Jalan) ---
const showManualItemModal = ref(false);
const savingManualItem = ref(false);
const KATEGORI_ALAT_OPSI = ["Bucket", "Breker", "Longarm", "Diatas Air", "Mobilisasi"];
const manualItem = ref({
  tanggal: new Date().toISOString().slice(0, 10),
  unitAlat: "",
  kategoriAlat: "Bucket",
  qty: 1,
  satuan: "jam",
  hargaSatuan: 0,
  lokasi: "",
});

function resetManualItemForm() {
  manualItem.value = {
    tanggal: new Date().toISOString().slice(0, 10),
    unitAlat: "",
    kategoriAlat: "Bucket",
    qty: 1,
    satuan: "jam",
    hargaSatuan: 0,
    lokasi: "",
  };
}

function openAddManualItemModal() {
  resetManualItemForm();
  showManualItemModal.value = true;
  // muat diam-diam (silent) Tensiv customer ini yang belum ditagih, buat
  // hint "unit ini ada Tensiv-nya" di bawah field Unit Alat -- gak perlu
  // buka modal "+ Dari Tensiv" terpisah dulu buat tahu.
  if (!belumDitagihTensivRows.value.length) {
    loadBelumDitagihTensiv({ silent: true });
  }
}

// Tensiv customer ini yang belum ditagih & unitnya cocok (mengandung/dikandung)
// sama yang lagi diketik staf di field Unit Alat form manual.
const tensivHintUntukUnit = computed(() => {
  const q = (manualItem.value.unitAlat || "").trim().toLowerCase();
  if (!q || manualItem.value.kategoriAlat === "Mobilisasi") return [];
  return belumDitagihTensivRows.value
    .map((r) => r.ts)
    .filter((ts) => {
      const u = (ts.unitAlat || "").trim().toLowerCase();
      return u && (u.includes(q) || q.includes(u));
    });
});

function pakaiTensivDariHint() {
  showManualItemModal.value = false;
  openAddTensivModal();
}

// Susun teks "keterangan" otomatis dari tanggal + unit + kategori, supaya
// staf tidak perlu ngetik manual tapi tetap konsisten formatnya dengan data
// hasil import Excel.
function manualItemKeterangan() {
  const tgl = manualItem.value.tanggal
    ? new Date(manualItem.value.tanggal).toLocaleDateString("id-ID", {
        day: "2-digit", month: "2-digit", year: "numeric",
      })
    : "";
  const bagian = [tgl, manualItem.value.unitAlat, manualItem.value.kategoriAlat].filter(Boolean);
  return bagian.join(" — ") || "Sewa alat";
}

async function submitManualItem() {
  if (manualItem.value.kategoriAlat !== "Mobilisasi" && !manualItem.value.unitAlat) {
    return toast("Isi nama unit alatnya dulu (mis. PC 200, SANY PC-075)");
  }
  if (!manualItem.value.hargaSatuan) {
    return toast("Isi harga satuannya dulu");
  }
  savingManualItem.value = true;
  try {
    invoice.value = await api.post(`/invoices/${route.params.id}/items`, {
      keterangan: manualItemKeterangan(),
      qty: Number(manualItem.value.qty) || 0,
      satuan: manualItem.value.kategoriAlat === "Mobilisasi" ? "ls" : manualItem.value.satuan,
      hargaSatuan: Number(manualItem.value.hargaSatuan) || 0,
      kategoriAlat: manualItem.value.kategoriAlat,
      unitAlat: manualItem.value.unitAlat || null,
      tglPakai: manualItem.value.tanggal || null,
      lokasi: manualItem.value.lokasi || null,
    });
    toast("Item berhasil ditambahkan");
    showManualItemModal.value = false;
    await load();
  } catch (e) {
    toast(e?.message || "Gagal menambahkan item");
  } finally {
    savingManualItem.value = false;
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

            <div style="margin-left:auto; display:flex; gap:6px">
              <button class="btn btn-sm btn-ghost" @click="openAddItemModal">
                + Dari Surat Jalan
              </button>
              <!-- Tambah dari rekaman Tensiv (Daftar Kerja Harian alat berat)
                   yang sudah diisi & belum ditagih -- qty jam/kategori/unit
                   ikut kesalin otomatis, staf tinggal isi harga satuan. -->
              <button class="btn btn-sm btn-ghost" @click="openAddTensivModal">
                + Dari Tensiv
              </button>
              <!-- Tambah baris manual: dipakai untuk sewa alat berat (jam kerja,
                   mobilisasi) atau item lain yang tidak berasal dari Surat Jalan. -->
              <button class="btn btn-sm btn-ghost" @click="openAddManualItemModal">
                + Tambah Manual
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Keterangan</th>
                <th class="num">Qty</th>
                <th class="num">Harga</th>
                <th class="num">Subtotal</th>
                <th class="num">Net <span class="optional">(internal)</span></th>
                <th class="action-col">Aksi</th>
              </tr>
            </thead>

            <tbody>
              <template
                v-for="it in invoice.items"
                :key="it.id"
              >
              <tr>
                <td>
                  {{ it.keterangan }}
                  <div v-if="it.suratJalan" class="item-sj-sub">SJ: {{ it.suratJalan.no }}</div>
                  <div v-if="it.tensiv" class="item-sj-sub">Tensiv: {{ it.tensiv.no }}</div>
                  <!-- Penanda baris sewa alat berat: kategori (Bucket/Breker/
                       Mobilisasi) & unit alatnya. Baris inilah yang dijumlah
                       di menu "Rekap Sewa Alat" dan statistik Dashboard. -->
                  <div v-if="it.kategoriAlat" class="item-sj-sub">
                    <span class="badge">{{ it.kategoriAlat }}</span>
                    <span v-if="it.unitAlat"> {{ it.unitAlat }}</span>
                  </div>
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

                <td class="num mono">
                  {{ rupiah(it.net) }}
                </td>

                <td class="item-actions">
                  <button class="btn btn-sm btn-ghost" @click="updateItemHarga(it)">Update</button>
                  <button class="btn btn-sm btn-ghost" @click="toggleBiaya(it.id)">Biaya</button>
                  <button class="btn btn-sm btn-danger" @click="hapusItem(it)">Hapus</button>
                </td>
              </tr>
              <tr v-if="openBiayaId === it.id" class="biaya-row">
                <td colspan="6">
                  <div class="biaya-panel">
                    <div class="msub" style="margin:0 0 8px;">
                      Rincian biaya baris ini (opsional, internal) — dipotong dari Subtotal untuk hitung Net. Tidak ikut dicetak ke customer.
                    </div>
                    <div class="row row-4">
                      <div class="field">
                        <label>Belanja Pasir</label>
                        <input v-model.number="biayaEdits[it.id].belanjaPasir" type="number" min="0" />
                      </div>
                      <div class="field">
                        <label>Uang Mobil</label>
                        <input v-model.number="biayaEdits[it.id].uangMobil" type="number" min="0" />
                      </div>
                      <div class="field">
                        <label>Uang Jalan</label>
                        <input v-model.number="biayaEdits[it.id].uangJalan" type="number" min="0" />
                      </div>
                      <div class="field">
                        <label>Uang Komisi</label>
                        <input v-model.number="biayaEdits[it.id].uangKomisi" type="number" min="0" />
                      </div>
                    </div>
                    <div class="row" v-if="it.kategoriAlat">
                      <div class="field">
                        <label>Uang Makan (Alat Berat)</label>
                        <input v-model.number="biayaEdits[it.id].uangMakan" type="number" min="0" />
                      </div>
                    </div>
                    <button class="btn btn-sm btn-primary" @click="simpanBiaya(it)">Simpan Biaya</button>
                  </div>
                </td>
              </tr>
              </template>
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
              margin-top:4px;
              font-weight:600;
              color: var(--ink-soft, #8a94a3);
            "
          >
            <span>Total Net <span class="optional">(internal, tidak dicetak)</span></span>
            <span class="mono">
              {{ rupiah(invoice.totalNet) }}
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

    <!-- MODAL TAMBAH ITEM DARI TENSIV (Daftar Kerja Harian alat berat) -->
    <div v-if="showAddTensivModal" class="modal-bg" @click.self="showAddTensivModal = false">
      <div class="modal" style="max-width:760px">
        <button class="modal-close" @click="showAddTensivModal = false">×</button>
        <h2>Tambah Item dari Tensiv</h2>
        <div class="msub">Rekaman Tensiv (jam kerja alat) customer ini yang belum ditagih di invoice manapun.</div>

        <div v-if="loadingBelumDitagihTensiv" class="empty small">Memuat Tensiv…</div>
        <div v-else-if="!belumDitagihTensivRows.length" class="empty small">
          Tidak ada Tensiv yang belum ditagih untuk customer ini.
        </div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>No Tensiv</th>
                <th>Tanggal</th>
                <th>Unit Alat</th>
                <th>Kategori</th>
                <th class="num">Jam Kerja</th>
                <th class="num">Harga / Jam</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in belumDitagihTensivRows" :key="r.tensivId">
                <td><input type="checkbox" v-model="r.checked" /></td>
                <td class="mono">{{ r.ts.no }}</td>
                <td>{{ r.ts.tanggal ? new Date(r.ts.tanggal).toLocaleDateString("id-ID") : "-" }}</td>
                <td>{{ r.ts.unitAlat || "-" }}</td>
                <td>{{ r.ts.kategoriAlat || "-" }}</td>
                <td class="num mono">{{ r.ts.totalJamKerja }}</td>
                <td class="num"><input v-model.number="r.hargaSatuan" type="number" min="0" class="item-harga-input" /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="savingAddTensivItem" @click="showAddTensivModal = false">Batal</button>
          <button class="btn btn-primary" :disabled="savingAddTensivItem" @click="submitAddTensivItems">
            {{ savingAddTensivItem ? "Menyimpan..." : "Tambahkan Item Terpilih" }}
          </button>
        </div>
      </div>
    </div>

    <!-- MODAL TAMBAH ITEM MANUAL (sewa alat berat, dll) -->
    <div v-if="showManualItemModal" class="modal-bg" @click.self="showManualItemModal = false">
      <div class="modal" style="max-width:520px">
        <button class="modal-close" @click="showManualItemModal = false">×</button>
        <h2>Tambah Item Manual</h2>
        <div class="msub">
          Untuk baris sewa alat berat (jam kerja / mobilisasi) atau item lain
          yang bukan dari Surat Jalan.
        </div>

        <div class="row">
          <div class="field">
            <label>Tanggal Pakai</label>
            <input v-model="manualItem.tanggal" type="date" />
          </div>
          <div class="field">
            <label>Kategori Alat</label>
            <select v-model="manualItem.kategoriAlat">
              <option v-for="k in KATEGORI_ALAT_OPSI" :key="k" :value="k">{{ k }}</option>
            </select>
          </div>
        </div>

        <div class="field" v-if="manualItem.kategoriAlat !== 'Mobilisasi'">
          <label>Unit Alat</label>
          <input
            v-model="manualItem.unitAlat"
            list="invoice-manual-unit-list"
            placeholder="mis. PC 200, SANY PC-075"
          />
          <datalist id="invoice-manual-unit-list">
            <option v-for="u in unitAlatList" :key="u.id" :value="u.nama" />
          </datalist>
          <div v-if="tensivHintUntukUnit.length" class="msub tensiv-hint">
            Ada {{ tensivHintUntukUnit.length }} Tensiv (Daftar Kerja Harian) unit ini yang
            belum ditagih customer ini —
            <button type="button" class="link-btn" @click="pakaiTensivDariHint">
              pakai dari Tensiv saja
            </button>
            biar jam kerjanya otomatis kebawa, gak perlu ketik ulang.
          </div>
        </div>
        <div class="field" v-else>
          <label>Keterangan Mobilisasi <span class="optional">(opsional)</span></label>
          <input v-model="manualItem.unitAlat" placeholder="mis. Mobilisasi PC 200 ke lokasi" />
        </div>

        <div class="row row-3" v-if="manualItem.kategoriAlat !== 'Mobilisasi'">
          <div class="field">
            <label>Jam Kerja</label>
            <input v-model.number="manualItem.qty" type="number" min="0" step="0.5" />
          </div>
          <div class="field">
            <label>Harga / Jam</label>
            <input v-model.number="manualItem.hargaSatuan" type="number" min="0" />
          </div>
          <div class="field">
            <label>Subtotal</label>
            <div class="mono" style="padding-top:8px">
              {{ rupiah((Number(manualItem.qty)||0) * (Number(manualItem.hargaSatuan)||0)) }}
            </div>
          </div>
        </div>
        <div class="row" v-else>
          <div class="field">
            <label>Biaya Mobilisasi</label>
            <input v-model.number="manualItem.hargaSatuan" type="number" min="0" />
          </div>
        </div>

        <div class="field">
          <label>Lokasi <span class="optional">(opsional — titiknya otomatis muncul di peta)</span></label>
          <input v-model="manualItem.lokasi" placeholder="mis. Cimanggis 2, Kp. Rambutan" />
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" :disabled="savingManualItem" @click="showManualItemModal = false">
            Batal
          </button>
          <button class="btn btn-primary" :disabled="savingManualItem" @click="submitManualItem">
            {{ savingManualItem ? "Menyimpan..." : "Tambahkan" }}
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
.biaya-row td { padding: 0; border-top: none; }
.biaya-panel { background: #f7f9fc; border: 1px dashed var(--line); border-radius: 9px; padding: 12px; margin: 4px 0 10px; }
.tensiv-hint { margin-top: 4px; padding: 6px 8px; background: #fff8e6; border: 1px dashed #e8c766; border-radius: 6px; }
.link-btn { background: none; border: none; padding: 0; color: var(--brand, #2563eb); text-decoration: underline; cursor: pointer; font: inherit; font-size: inherit; }
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