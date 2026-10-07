<!--
  Import Invoice dari Excel.
  Alur: pilih file -> baca (tiap sheet = 1 invoice) -> cocokkan customer ->
  "Periksa" ke server (status Surat Jalan per baris: ADA / BARU / TERTAGIH) ->
  Simpan. Baris tanpa Surat Jalan di sistem otomatis dibuatkan Surat Jalan.
  Parser & template ada di utils/invoiceImport.js.
-->
<script setup>
import { ref, computed } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import SearchableSelect from "./SearchableSelect.vue";
import { parseInvoiceExcel, cocokkanCustomer, unduhTemplateInvoice } from "../utils/invoiceImport.js";

const props = defineProps({
  customers: { type: Array, default: () => [] },
});
const emit = defineEmits(["close", "done"]);

const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];

const file = ref(null);
const parsing = ref(false);
const checking = ref(false);
const saving = ref(false);
const error = ref("");
const drafts = ref([]); // satu per sheet yang terbaca
const dilewati = ref([]); // sheet yang tidak terbaca
const divisiDefault = ref(DIVISI[0]);
const hasil = ref(null); // hasil simpan

const customerOptions = computed(() =>
  props.customers.map((c) => ({ value: c.id, label: `${c.kode} — ${c.nama}` }))
);

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}
function fmtTgl(t) {
  if (!t) return "-";
  const [y, m, d] = String(t).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function totalBaris(it) {
  const qty = Number(it.qty) || (Number(it.panjang) * Number(it.lebar) * Number(it.tinggi) || 0);
  return qty * (Number(it.hargaSatuan) || 0);
}
function totalDraft(d) {
  return d.items.filter((x) => !x.skip).reduce((s, x) => s + totalBaris(x), 0);
}

async function onFile(e) {
  file.value = e.target.files?.[0] || null;
  drafts.value = [];
  dilewati.value = [];
  hasil.value = null;
  error.value = "";
  if (!file.value) return;
  parsing.value = true;
  try {
    const sheets = await parseInvoiceExcel(file.value);
    dilewati.value = sheets.filter((s) => s.dilewati).map((s) => ({ nama: s.sheetName, alasan: s.alasan }));
    drafts.value = sheets
      .filter((s) => !s.dilewati)
      .map((s, i) => {
        const cust = cocokkanCustomer(s.customerNama || s.sheetName, props.customers);
        const divisi = DIVISI.find((d) => d.toLowerCase() === String(s.divisi || "").trim().toLowerCase());
        return {
          key: `s${i}`,
          include: true,
          sheetName: s.sheetName,
          customerNama: s.customerNama,
          customerId: cust?.id || "",
          divisi: divisi || divisiDefault.value,
          tanggal: s.tanggal,
          jatuhTempo: s.jatuhTempo,
          catatan: s.catatan,
          buatRekap: true,
          warnings: s.warnings || [],
          items: s.items.map((x) => ({ ...x, skip: false })),
          expanded: false,
          cek: null,
        };
      });
    if (!drafts.value.length) {
      error.value =
        "Tidak ada sheet yang bisa dibaca. Pakai template (tombol Unduh Template) atau pastikan ada kolom Jumlah/P-L-T dan Harga Satuan.";
    } else {
      await periksa();
    }
  } catch (err) {
    error.value = "Gagal membaca file: " + (err?.message || String(err));
  } finally {
    parsing.value = false;
  }
}

function payload(d) {
  return {
    key: d.key,
    customerId: d.customerId,
    divisi: d.divisi,
    tanggal: d.tanggal,
    jatuhTempo: d.jatuhTempo || null,
    catatan: d.catatan || null,
    buatRekap: d.buatRekap,
    items: d.items.filter((x) => !x.skip).map(({ barisAsli, skip, ...rest }) => rest),
  };
}

const aktif = computed(() => drafts.value.filter((d) => d.include));

async function periksa() {
  if (!aktif.value.length) return;
  checking.value = true;
  try {
    const res = await api.post("/invoices/import/preview", { invoices: aktif.value.map(payload) });
    const byKey = new Map(res.invoices.map((r) => [r.key, r]));
    for (const d of drafts.value) d.cek = byKey.get(d.key) || null;
  } catch (err) {
    toast("Gagal memeriksa: " + (err?.message || String(err)));
  } finally {
    checking.value = false;
  }
}

// status SJ untuk baris ke-i (dari item yang tidak di-skip)
function statusBaris(d, item) {
  if (!d.cek) return null;
  const idx = d.items.filter((x) => !x.skip).indexOf(item);
  return idx >= 0 ? d.cek.baris[idx] : null;
}

const siapSimpan = computed(
  () =>
    aktif.value.length > 0 &&
    aktif.value.every((d) => d.customerId && d.cek && d.cek.bisaDisimpan)
);

async function simpan() {
  if (!siapSimpan.value) return toast("Lengkapi dulu customer & perbaiki baris yang error");
  saving.value = true;
  try {
    const res = await api.post("/invoices/import", { invoices: aktif.value.map(payload) });
    hasil.value = res;
    emit("done");
  } catch (err) {
    toast("Gagal menyimpan: " + (err?.message || String(err)));
  } finally {
    saving.value = false;
  }
}

const namaSheet = (key) => drafts.value.find((d) => d.key === key)?.sheetName || key;
</script>

<template>
  <div class="modal-bg" @click.self="emit('close')">
    <div class="modal" style="max-width: 1000px; width: 96%; max-height: 92vh; overflow: auto">
      <button class="modal-close" @click="emit('close')">×</button>
      <h2>Import Invoice dari Excel</h2>
      <div class="desc" style="margin-bottom: 12px">
        Satu sheet = satu invoice untuk satu customer. Baris yang belum punya Surat Jalan di sistem
        otomatis dibuatkan Surat Jalan-nya.
        <button class="link-btn" type="button" @click="unduhTemplateInvoice">⬇ Unduh Template</button>
      </div>

      <!-- HASIL SIMPAN -->
      <div v-if="hasil">
        <div class="card" style="padding: 12px 14px; margin-bottom: 10px">
          <b>{{ hasil.berhasil }} invoice berhasil dibuat</b><span v-if="hasil.gagal"> · {{ hasil.gagal }} gagal</span>
        </div>
        <div v-for="r in hasil.invoices" :key="r.key" class="card" style="padding: 10px 14px; margin-bottom: 8px">
          <template v-if="r.ok">
            ✅ <b>{{ namaSheet(r.key) }}</b> → <span class="mono">{{ r.no }}</span> · {{ r.baris }} baris ·
            {{ rupiah(r.total) }}
            <div class="desc">
              Surat Jalan: {{ r.sjTertaut }} tertaut ke yang sudah ada, {{ r.sjBaru }} dibuat otomatis ·
              Rekap penjualan baru: {{ r.rekapBaru }}
            </div>
          </template>
          <template v-else>
            ❌ <b>{{ namaSheet(r.key) }}</b> — {{ r.error }}
          </template>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" @click="emit('close')">Selesai</button>
        </div>
      </div>

      <!-- PILIH FILE & PREVIEW -->
      <div v-else>
        <div class="row" style="margin-bottom: 12px">
          <div class="field">
            <label>File Excel (.xlsx)</label>
            <input type="file" accept=".xlsx,.xls" @change="onFile" />
          </div>
          <div class="field">
            <label>Divisi bawaan <span class="optional">(kalau sheet tidak menulis Divisi)</span></label>
            <select v-model="divisiDefault">
              <option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
        </div>

        <div v-if="parsing" class="empty">Membaca file…</div>
        <div v-if="error" class="empty" style="color: #b91c1c">{{ error }}</div>

        <div v-if="dilewati.length" class="desc" style="margin-bottom: 8px">
          Sheet dilewati ({{ dilewati.length }}): {{ dilewati.map((x) => x.nama).join(", ") }}
        </div>

        <div v-for="d in drafts" :key="d.key" class="card imp-card" :class="{ off: !d.include }">
          <div class="imp-head">
            <label class="imp-check"><input v-model="d.include" type="checkbox" @change="periksa" /> <b>{{ d.sheetName }}</b></label>
            <span class="tag">{{ d.items.filter((x) => !x.skip).length }} baris · {{ rupiah(totalDraft(d)) }}</span>
          </div>

          <div v-if="d.include">
            <div class="row row-3" style="margin: 8px 0">
              <div class="field">
                <label>Customer <span v-if="d.customerNama" class="optional">(di Excel: {{ d.customerNama }})</span></label>
                <SearchableSelect v-model="d.customerId" :options="customerOptions" placeholder="Pilih customer…" @change="periksa" />
              </div>
              <div class="field">
                <label>Divisi</label>
                <select v-model="d.divisi" @change="periksa">
                  <option v-for="x in DIVISI" :key="x" :value="x">{{ x }}</option>
                </select>
              </div>
              <div class="field">
                <label>Tanggal Invoice</label>
                <input v-model="d.tanggal" type="date" @change="periksa" />
              </div>
            </div>
            <div class="row" style="margin-bottom: 6px">
              <div class="field">
                <label>Catatan <span class="optional">(mis. No. Rekapan)</span></label>
                <input v-model="d.catatan" />
              </div>
              <div class="field" style="justify-content: flex-end">
                <label class="imp-check"><input v-model="d.buatRekap" type="checkbox" /> Catat juga ke Rekap Penjualan</label>
              </div>
            </div>

            <div v-for="w in d.warnings" :key="w" class="desc" style="color: #b45309">⚠ {{ w }}</div>
            <div v-if="d.cek?.errors?.length" class="desc" style="color: #b91c1c">
              <div v-for="e in d.cek.errors" :key="e">✖ {{ e }}</div>
            </div>
            <div v-if="d.cek" class="desc">
              Surat Jalan: {{ d.cek.jumlahAda }} tertaut ke yang sudah ada ·
              <b>{{ d.cek.jumlahBaru }} akan dibuatkan otomatis</b>
            </div>

            <div class="table-wrap" style="margin-top: 6px">
              <table class="imp-table">
                <thead>
                  <tr>
                    <th>Tgl</th><th>No SJ</th><th>No Pol</th><th>Jenis Barang</th>
                    <th class="num">P</th><th class="num">L</th><th class="num">T</th>
                    <th class="num">Jumlah</th><th>Sat</th><th class="num">Harga</th><th class="num">Total</th>
                    <th>SJ</th><th title="Jangan ikut diimport">Skip</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(it, i) in d.expanded ? d.items : d.items.slice(0, 8)"
                    :key="i"
                    :class="{ skip: it.skip }"
                  >
                    <td>{{ fmtTgl(it.tanggal) }}</td>
                    <td class="mono">{{ it.noSJ || "—" }}</td>
                    <td>{{ it.noPolisi }}</td>
                    <td>{{ it.jenisBarang }}</td>
                    <td class="num">{{ it.panjang }}</td>
                    <td class="num">{{ it.lebar }}</td>
                    <td class="num">{{ it.tinggi }}</td>
                    <td class="num">{{ it.qty }}</td>
                    <td>{{ it.satuan }}</td>
                    <td class="num mono">{{ it.hargaSatuan ? Math.round(it.hargaSatuan).toLocaleString("id-ID") : "—" }}</td>
                    <td class="num mono">{{ Math.round(totalBaris(it)).toLocaleString("id-ID") }}</td>
                    <td>
                      <template v-if="!it.skip && statusBaris(d, it)">
                        <span
                          class="badge"
                          :class="statusBaris(d, it).error ? 'b-belum' : statusBaris(d, it).sjStatus === 'ADA' ? 'b-lunas' : 'b-sebagian'"
                          :title="statusBaris(d, it).error || statusBaris(d, it).peringatan.join('; ')"
                        >{{ statusBaris(d, it).error ? "ERROR" : statusBaris(d, it).sjStatus === "ADA" ? "Ada" : "Baru" }}</span>
                      </template>
                    </td>
                    <td><input v-model="it.skip" type="checkbox" @change="periksa" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button v-if="d.items.length > 8" class="link-btn" type="button" @click="d.expanded = !d.expanded">
              {{ d.expanded ? "Ringkas" : `Tampilkan semua ${d.items.length} baris` }}
            </button>
            <div v-if="d.cek && d.cek.baris.some((b) => b.error)" class="desc" style="color: #b91c1c; margin-top: 4px">
              <div v-for="b in d.cek.baris.filter((b) => b.error)" :key="b.no">✖ Baris {{ b.no }}: {{ b.error }}</div>
            </div>
          </div>
        </div>

        <div v-if="drafts.length" class="modal-actions">
          <button class="btn btn-ghost" :disabled="checking" @click="periksa">
            {{ checking ? "Memeriksa…" : "Periksa Ulang" }}
          </button>
          <button class="btn btn-primary" :disabled="saving || checking || !siapSimpan" @click="simpan">
            {{ saving ? "Menyimpan…" : `Simpan ${aktif.length} Invoice` }}
          </button>
        </div>
        <div v-if="drafts.length" class="desc" style="margin-top: 6px">
          Baris yang SJ-nya sudah tertagih di invoice lain akan ditolak otomatis (aman diimport ulang).
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.imp-card { padding: 10px 14px; margin-bottom: 10px; }
.imp-card.off { opacity: 0.55; }
.imp-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.imp-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.imp-table { font-size: 12px; }
.imp-table tr.skip td { opacity: 0.4; text-decoration: line-through; }
.row-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.optional { font-weight: 400; color: #6b7280; font-size: 11px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; padding-top: 14px; border-top: 1px solid #e5e7eb; }
@media (max-width: 700px) { .row-3 { grid-template-columns: 1fr; } }
.link-btn { background: none; border: 0; color: #2563eb; cursor: pointer; padding: 0 4px; text-decoration: underline; font: inherit; }
</style>
