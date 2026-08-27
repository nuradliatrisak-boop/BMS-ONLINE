<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";

const BULAN_NAMA = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const auth = useAuthStore();

// Admin bisa pilih divisi mana saja; user divisi hanya lihat armada divisinya
// sendiri (backend juga sudah membatasi ini lewat scopeDivisi).
const DIVISI_ALL = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const divisiOptions = computed(() =>
  auth.isAdmin ? ["Semua Divisi", ...DIVISI_ALL] : [auth.user?.divisi]
);

const divisi = ref(auth.isAdmin ? "Semua Divisi" : auth.user?.divisi);
const bulan = ref(new Date().toISOString().slice(0, 7));
const groupBy = ref("nopol"); // "nopol" | "sopir"
const data = ref(null);
const loading = ref(false);

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

const bulanLabel = computed(() => {
  if (!bulan.value) return "-";
  const [y, m] = bulan.value.split("-");
  return `${BULAN_NAMA[Number(m) - 1]} ${y}`;
});

// Baris ditampilkan per Nopol (default, sesuai sheet REKAP) atau digabung per
// Sopir kalau satu sopir memegang lebih dari satu kendaraan dalam bulan itu.
const rows = computed(() => {
  if (!data.value) return [];
  const showAll = !auth.isAdmin || divisi.value === "Semua Divisi";
  const base = data.value.rekap.filter((r) => showAll || r.divisi === divisi.value);

  if (groupBy.value === "nopol") return base;

  const map = new Map();
  for (const r of base) {
    const key = r.sopir || "(Tanpa Sopir)";
    if (!map.has(key)) {
      map.set(key, {
        nopol: "-",
        sopir: key,
        jenis: "",
        divisi: r.divisi,
        ritasi: 0,
        totalM3: 0,
        pendapatan: 0,
        sparepart: 0,
        hasilBersih: 0,
        _nopolList: [],
      });
    }
    const acc = map.get(key);
    acc.ritasi += r.ritasi;
    acc.totalM3 += r.totalM3;
    acc.pendapatan += r.pendapatan;
    acc.sparepart += r.sparepart;
    acc.hasilBersih += r.hasilBersih;
    acc._nopolList.push(r.nopol);
  }
  return Array.from(map.values()).map((r) => ({ ...r, nopol: r._nopolList.join(", ") }));
});

const totalRitasi = computed(() => rows.value.reduce((s, r) => s + r.ritasi, 0));
const totalM3 = computed(() => rows.value.reduce((s, r) => s + r.totalM3, 0));
const totalPendapatan = computed(() => rows.value.reduce((s, r) => s + r.pendapatan, 0));
const totalSparepart = computed(() => rows.value.reduce((s, r) => s + r.sparepart, 0));
const totalHasilBersih = computed(() => totalPendapatan.value - totalSparepart.value);

async function load() {
  if (!bulan.value) return;
  loading.value = true;
  try {
    data.value = await api.get(`/armada/rekap/${bulan.value}`);
  } catch (e) {
    toast(e.message || "Gagal memuat rekap armada");
  } finally {
    loading.value = false;
  }
}

watch([bulan, divisi], load);
onMounted(load);
</script>

<template>
  <div class="topbar">
    <div>
      <h1>Rekap Armada</h1>
      <div class="desc">
        Ritasi, m³, pendapatan &amp; sparepart per kendaraan / sopir — {{ bulanLabel }}
      </div>
    </div>
  </div>

  <div class="content">
    <div class="card" style="margin-bottom:16px;">
      <div class="row">
        <div class="field" v-if="auth.isAdmin">
          <label>Divisi</label>
          <select v-model="divisi">
            <option v-for="d in divisiOptions" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>

        <div class="field">
          <label>Bulan</label>
          <input v-model="bulan" type="month" />
        </div>

        <div class="field">
          <label>Kelompokkan Per</label>
          <select v-model="groupBy">
            <option value="nopol">Nomor Polisi (Kendaraan)</option>
            <option value="sopir">Sopir</option>
          </select>
        </div>
      </div>

      <div class="msub">
        Ritasi &amp; total m³ diambil dari Surat Jalan bulan berjalan. Pendapatan (Uang Jalan)
        dan Sparepart diambil dari transaksi Laporan Divisi yang ditandai per nomor polisi kendaraan.
      </div>
    </div>

    <div v-if="loading" class="empty">Memuat data…</div>

    <div v-else-if="!rows.length" class="empty">
      <div class="big">🚚</div>
      <div>Belum ada data ritasi/transaksi untuk periode ini.</div>
    </div>

    <div v-else class="card">
      <div class="section-title">
        Rekap {{ groupBy === "nopol" ? "Per Kendaraan" : "Per Sopir" }}
        <span class="tag">{{ rows.length }} baris</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>{{ groupBy === "nopol" ? "No. Polisi" : "Sopir" }}</th>
            <th v-if="groupBy === 'nopol'">Sopir</th>
            <th v-else>No. Polisi</th>
            <th>Divisi</th>
            <th style="text-align:right;">Ritasi</th>
            <th style="text-align:right;">Total m³</th>
            <th style="text-align:right;">Pendapatan</th>
            <th style="text-align:right;">Sparepart</th>
            <th style="text-align:right;">Hasil Bersih</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td class="mono">{{ groupBy === "nopol" ? r.nopol : r.sopir }}</td>
            <td>{{ groupBy === "nopol" ? (r.sopir || "-") : r.nopol }}</td>
            <td>{{ r.divisi }}</td>
            <td style="text-align:right;">{{ r.ritasi }}</td>
            <td style="text-align:right;">{{ r.totalM3.toLocaleString("id-ID") }}</td>
            <td style="text-align:right;">{{ rupiah(r.pendapatan) }}</td>
            <td style="text-align:right;">{{ rupiah(r.sparepart) }}</td>
            <td
              style="text-align:right; font-weight:600;"
              :style="{ color: r.hasilBersih >= 0 ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }"
            >
              {{ rupiah(r.hasilBersih) }}
            </td>
          </tr>
        </tbody>

        <tfoot>
          <tr style="font-weight:700; border-top:2px solid #e5e7eb;">
            <td colspan="3">Total</td>
            <td style="text-align:right;">{{ totalRitasi }}</td>
            <td style="text-align:right;">{{ totalM3.toLocaleString("id-ID") }}</td>
            <td style="text-align:right;">{{ rupiah(totalPendapatan) }}</td>
            <td style="text-align:right;">{{ rupiah(totalSparepart) }}</td>
            <td
              style="text-align:right;"
              :style="{ color: totalHasilBersih >= 0 ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }"
            >
              {{ rupiah(totalHasilBersih) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>
