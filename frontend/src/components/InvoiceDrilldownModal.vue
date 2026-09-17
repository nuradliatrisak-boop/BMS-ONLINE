<!--
  InvoiceDrilldownModal
  Dipakai di halaman rekap/laporan (Laporan Divisi, Rekap Keseluruhan, Rekap
  Penjualan) — pas baris "Invoice (Sistem)" diklik, modal ini muncul nampilin
  daftar Invoice yang jadi sumber angka itu (divisi + rentang tanggal
  tertentu). Klik salah satu invoice-nya langsung diarahkan ke halaman detail
  invoice aslinya (yang di situ udah ada tombol Cetak).

  Pemakaian:
    <InvoiceDrilldownModal
      v-if="showDrilldown"
      :divisi="divisi"
      :dari="dari"        // "YYYY-MM-DD"
      :sampai="sampai"    // "YYYY-MM-DD"
      :label="'September 2026'"
      @close="showDrilldown = false"
    />
-->
<script setup>
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const props = defineProps({
  divisi: { type: String, default: "" },
  dari: { type: String, required: true },
  sampai: { type: String, required: true },
  label: { type: String, default: "" },
});
const emit = defineEmits(["close"]);

const router = useRouter();
const loading = ref(true);
const invoices = ref([]);

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}
function fmtTgl(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams();
    if (props.divisi) params.set("divisi", props.divisi);
    params.set("dari", props.dari);
    params.set("sampai", props.sampai);
    invoices.value = await api.get(`/invoices?${params.toString()}`);
  } catch (error) {
    toast(error?.message || "Gagal memuat daftar invoice");
  } finally {
    loading.value = false;
  }
}

function openInvoice(inv) {
  router.push({ name: "invoice-detail", params: { id: inv.id } });
}

const total = () => invoices.value.reduce((s, i) => s + Number(i.total || 0), 0);

onMounted(load);
</script>

<template>
  <div class="modal-bg" @click.self="emit('close')">
    <div class="modal" style="max-width: 720px">
      <button class="modal-close" @click="emit('close')">×</button>
      <h2>Rincian Invoice (Sistem)</h2>
      <div class="msub">
        {{ divisi || "Semua divisi" }}<span v-if="label"> — {{ label }}</span>. Klik salah satu baris untuk buka detail & cetak invoice-nya.
      </div>

      <div v-if="loading" class="empty small">Memuat…</div>
      <div v-else-if="!invoices.length" class="empty small">Tidak ada invoice pada periode ini.</div>
      <div v-else class="table-wrap">
        <table class="sj-pick-table">
          <thead>
            <tr>
              <th>No Invoice</th>
              <th>Tanggal</th>
              <th>Customer</th>
              <th>Status</th>
              <th style="text-align: right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="inv in invoices"
              :key="inv.id"
              class="clickable-row"
              @click="openInvoice(inv)"
            >
              <td class="mono">{{ inv.no }}</td>
              <td>{{ fmtTgl(inv.tanggal) }}</td>
              <td>{{ inv.customer?.nama || "-" }}</td>
              <td>
                <span class="tag" :class="inv.status === 'LUNAS' ? 'b-lunas' : 'b-belum'">
                  {{ inv.status === "LUNAS" ? "Lunas" : "Belum Lunas" }}
                </span>
              </td>
              <td class="mono" style="text-align: right">{{ rupiah(inv.total) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4"><b>Total</b></td>
              <td class="mono" style="text-align: right"><b>{{ rupiah(total()) }}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="modal-actions">
        <button class="btn btn-ghost" @click="emit('close')">Tutup</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.clickable-row { cursor: pointer; }
.clickable-row:hover { background: var(--brand-soft, #eef2ff); }
.modal-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>