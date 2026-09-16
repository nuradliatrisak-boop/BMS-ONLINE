<script setup>
// REKAP SEWA ALAT
// Menjawab: "dipisahkan total keseluruhan, terus berdasarkan kategori alatnya"
// + pencarian pakai dropdown (customer / kategori alat / unit alat / periode).
//
// Semua angka di sini diambil dari tabel Invoice, jadi sama persis dengan
// yang tampil di Dashboard & daftar Invoice -- bukan hitungan terpisah.
import { ref, onMounted, computed, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";

const loading = ref(true);
const loadingRincian = ref(false);
const ringkasan = ref(null);
const rincian = ref({ total: 0, baris: [] });
const opsi = ref({ customer: [], kategori: [], unit: [] });

const filter = ref({
  customerId: "",
  kategori: "",
  unit: "",
  dari: "",
  sampai: "",
  q: "",
});

const tampilRincian = ref(false);

function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}
function angka(n) {
  return (Number(n) || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
function tanggal(t) {
  if (!t) return "-";
  return new Date(t).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function namaBulan(kunci) {
  const [th, bl] = String(kunci).split("-");
  const nama = [
    "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
    "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
  ];
  const idx = Number(bl) - 1;
  return nama[idx] ? `${nama[idx]} ${th}` : kunci;
}

function queryString() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filter.value)) {
    if (v) p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function muat() {
  loading.value = true;
  try {
    ringkasan.value = await api.get(`/rekap-alat${queryString()}`);
    if (tampilRincian.value) await muatRincian();
  } catch (e) {
    console.error(e);
    toast("Gagal memuat rekap sewa alat");
  } finally {
    loading.value = false;
  }
}

async function muatRincian() {
  loadingRincian.value = true;
  try {
    rincian.value = await api.get(`/rekap-alat/rincian${queryString()}`);
  } catch (e) {
    toast("Gagal memuat rincian");
  } finally {
    loadingRincian.value = false;
  }
}

async function bukaRincian() {
  tampilRincian.value = !tampilRincian.value;
  if (tampilRincian.value && rincian.value.baris.length === 0) await muatRincian();
}

function reset() {
  filter.value = { customerId: "", kategori: "", unit: "", dari: "", sampai: "", q: "" };
  muat();
}

// Dropdown langsung menerapkan filter begitu dipilih (tanpa klik tombol),
// supaya cepat dipakai staf.
watch(
  () => [filter.value.customerId, filter.value.kategori, filter.value.unit],
  () => muat()
);

const maxKategori = computed(() => {
  const list = ringkasan.value?.perKategori || [];
  return list.reduce((m, k) => Math.max(m, k.nilai), 0) || 1;
});
const maxBulan = computed(() => {
  const list = ringkasan.value?.perBulan || [];
  return list.reduce((m, k) => Math.max(m, k.nilai), 0) || 1;
});

onMounted(async () => {
  try {
    opsi.value = await api.get("/rekap-alat/opsi");
  } catch (e) {
    /* dropdown kosong tidak menghalangi halaman */
  }
  await muat();
});
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Rekap Sewa Alat</h1>
      <div class="desc">
        Total keseluruhan &amp; rincian per kategori alat, diambil dari data Invoice
      </div>
    </div>
  </div>

  <div class="content">
    <!-- ================= PENCARIAN (DROPDOWN) ================= -->
    <div class="card">
      <div class="section-title">Cari / Saring Data</div>
      <div class="grid g4">
        <div class="field">
          <label>Customer</label>
          <select v-model="filter.customerId">
            <option value="">— Semua customer —</option>
            <option v-for="c in opsi.customer" :key="c.id" :value="c.id">
              {{ c.nama }}
            </option>
          </select>
        </div>
        <div class="field">
          <label>Kategori Alat</label>
          <select v-model="filter.kategori">
            <option value="">— Semua kategori —</option>
            <option v-for="k in opsi.kategori" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>
        <div class="field">
          <label>Unit Alat</label>
          <select v-model="filter.unit">
            <option value="">— Semua unit —</option>
            <option v-for="u in opsi.unit" :key="u" :value="u">{{ u }}</option>
          </select>
        </div>
        <div class="field">
          <label>Kata kunci</label>
          <input
            v-model="filter.q"
            placeholder="no invoice / lokasi / keterangan"
            @keyup.enter="muat"
          />
        </div>
        <div class="field">
          <label>Dari tanggal</label>
          <input type="date" v-model="filter.dari" />
        </div>
        <div class="field">
          <label>Sampai tanggal</label>
          <input type="date" v-model="filter.sampai" />
        </div>
      </div>
      <div class="row" style="margin-top: 10px; gap: 8px">
        <button class="btn btn-primary" @click="muat">Terapkan</button>
        <button class="btn btn-ghost" @click="reset">Reset</button>
        <button class="btn btn-ghost" @click="bukaRincian">
          {{ tampilRincian ? "Sembunyikan rincian" : "Lihat rincian per baris" }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <template v-else-if="ringkasan">
      <!-- ================= TOTAL KESELURUHAN ================= -->
      <div class="grid g4" style="margin-top: 14px">
        <div class="stat">
          <div class="lbl">Total Nilai Sewa Alat</div>
          <div class="val">{{ rupiah(ringkasan.totalNilai) }}</div>
          <div class="note">{{ ringkasan.totalBaris }} baris pemakaian</div>
        </div>
        <div class="stat">
          <div class="lbl">Total Jam Kerja</div>
          <div class="val">{{ angka(ringkasan.totalJam) }} jam</div>
          <div class="note">{{ ringkasan.totalInvoice }} invoice</div>
        </div>
        <div class="stat">
          <div class="lbl">Sudah Dibayar</div>
          <div class="val">{{ rupiah(ringkasan.totalDibayar) }}</div>
        </div>
        <div class="stat">
          <div class="lbl">Sisa Piutang</div>
          <div class="val">{{ rupiah(ringkasan.sisaPiutang) }}</div>
          <div class="note">dari total tagihan invoice terkait</div>
        </div>
      </div>

      <!-- ================= PER KATEGORI ALAT ================= -->
      <div class="card" style="margin-top: 14px">
        <div class="section-title">Berdasarkan Kategori Alat</div>
        <div v-if="!ringkasan.perKategori.length" class="empty">Belum ada data.</div>
        <div class="table-wrap" v-else>
          <table>
            <thead>
              <tr>
                <th>Kategori</th>
                <th class="num">Jam</th>
                <th class="num">Baris</th>
                <th class="num">Nilai</th>
                <th style="width: 30%">Porsi</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="k in ringkasan.perKategori" :key="k.kategori">
                <td><strong>{{ k.kategori }}</strong></td>
                <td class="num">{{ angka(k.jam) }}</td>
                <td class="num">{{ k.baris }}</td>
                <td class="num">{{ rupiah(k.nilai) }}</td>
                <td>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: (k.nilai / maxKategori) * 100 + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ================= PER CUSTOMER ================= -->
      <div class="card" style="margin-top: 14px">
        <div class="section-title">Berdasarkan Customer</div>
        <div v-if="!ringkasan.perCustomer.length" class="empty">Belum ada data.</div>
        <div class="table-wrap" v-else>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th class="num">Jam</th>
                <th class="num">Baris</th>
                <th>Rincian kategori</th>
                <th class="num">Total Nilai</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in ringkasan.perCustomer" :key="c.nama">
                <td><strong>{{ c.nama }}</strong></td>
                <td class="num">{{ angka(c.jam) }}</td>
                <td class="num">{{ c.baris }}</td>
                <td>
                  <span v-for="(v, k) in c.kategori" :key="k" class="badge" style="margin-right: 4px">
                    {{ k }}: {{ rupiah(v) }}
                  </span>
                </td>
                <td class="num">{{ rupiah(c.nilai) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ================= PER UNIT ALAT ================= -->
      <div class="card" style="margin-top: 14px">
        <div class="section-title">Berdasarkan Unit Alat (30 teratas)</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Unit Alat</th>
                <th class="num">Jam</th>
                <th class="num">Baris</th>
                <th class="num">Nilai</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in ringkasan.perUnit" :key="u.unit">
                <td>{{ u.unit }}</td>
                <td class="num">{{ angka(u.jam) }}</td>
                <td class="num">{{ u.baris }}</td>
                <td class="num">{{ rupiah(u.nilai) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ================= PER BULAN ================= -->
      <div class="card" style="margin-top: 14px">
        <div class="section-title">Pemakaian per Bulan</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bulan</th>
                <th class="num">Jam</th>
                <th class="num">Nilai</th>
                <th style="width: 40%"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in ringkasan.perBulan" :key="b.bulan">
                <td>{{ namaBulan(b.bulan) }}</td>
                <td class="num">{{ angka(b.jam) }}</td>
                <td class="num">{{ rupiah(b.nilai) }}</td>
                <td>
                  <div class="bar-track">
                    <div class="bar-fill" :style="{ width: (b.nilai / maxBulan) * 100 + '%' }"></div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ================= RINCIAN PER BARIS ================= -->
      <div v-if="tampilRincian" class="card" style="margin-top: 14px">
        <div class="section-title">
          Rincian per Baris
          <span class="note" v-if="rincian.total > rincian.baris.length">
            (menampilkan {{ rincian.baris.length }} dari {{ rincian.total }} baris — persempit filternya kalau mau lebih fokus)
          </span>
        </div>
        <div v-if="loadingRincian" class="empty">Memuat rincian…</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Customer</th>
                <th>No Invoice</th>
                <th>Unit</th>
                <th>Kategori</th>
                <th class="num">Qty</th>
                <th class="num">Harga</th>
                <th class="num">Nilai</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b in rincian.baris" :key="b.id">
                <td>{{ tanggal(b.tglPakai) }}</td>
                <td>{{ b.customer }}</td>
                <td>
                  <router-link :to="`/invoices/${b.invoiceId}`">{{ b.noInvoice }}</router-link>
                  <span v-if="b.tarifAsumsi" class="badge b-belum" title="Tarif tidak tertulis di Excel, memakai tarif standar — mohon dicek">
                    tarif asumsi
                  </span>
                </td>
                <td>{{ b.unitAlat }}</td>
                <td>{{ b.kategoriAlat }}</td>
                <td class="num">{{ angka(b.qty) }} {{ b.satuan }}</td>
                <td class="num">{{ rupiah(b.hargaSatuan) }}</td>
                <td class="num">{{ rupiah(b.nilai) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bar-track {
  background: rgba(127, 127, 127, 0.18);
  border-radius: 6px;
  height: 10px;
  overflow: hidden;
}
.bar-fill {
  background: #c8a04a;
  height: 100%;
  border-radius: 6px;
}
.note {
  font-weight: 400;
  font-size: 12px;
  opacity: 0.75;
}
</style>
