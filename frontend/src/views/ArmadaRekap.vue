<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";
import { fmtM3 } from "../utils/format.js";

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
// Pakai tanggal lokal (WIB), bukan toISOString() yang UTC -- kalau tidak, jam
// 00:00-07:00 di tanggal 1 akan membuka bulan SEBELUMNYA.
const _now = new Date();
const bulan = ref(`${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`);
const groupBy = ref("nopol"); // "nopol" | "sopir"
const data = ref(null);
const loading = ref(false);

// Search (Nopol/Sopir) & filter Jenis kendaraan (Tronton / Cold Diesel / dst)
const search = ref("");
const filterJenis = ref("Semua");
const jenisTersedia = computed(() =>
  Array.from(new Set((data.value?.rekap || []).map((r) => r.jenis).filter(Boolean))).sort()
);

function rupiah(n) {
  return "Rp " + Math.round(n || 0).toLocaleString("id-ID");
}

const bulanLabel = computed(() => {
  if (!bulan.value) return "-";
  const [y, m] = bulan.value.split("-");
  return `${BULAN_NAMA[Number(m) - 1]} ${y}`;
});

// Baris ditampilkan per Nopol (default, sesuai sheet REKAP) atau per Sopir.
// Mode Sopir: Ritasi, m3 & Komisi dihitung dari Surat Jalan (melekat ke ORANG
// sopirnya, walau dia pindah-pindah kendaraan); Pendapatan/Sparepart diambil
// dari kendaraan yang dipegang sopir itu di data Armada.
const rows = computed(() => {
  if (!data.value) return [];
  const showAll = !auth.isAdmin || divisi.value === "Semua Divisi";
  const q = search.value.trim().toLowerCase();
  const cocokDivisi = (r) => showAll || r.divisi === divisi.value;

  if (groupBy.value === "nopol") {
    return data.value.rekap
      .filter((r) => {
        if (!cocokDivisi(r)) return false;
        if (filterJenis.value !== "Semua" && r.jenis !== filterJenis.value) return false;
        if (!q) return true;
        return (r.nopol || "").toLowerCase().includes(q) || (r.sopir || "").toLowerCase().includes(q);
      })
      .map((r) => ({ ...r, komisi: 0, komisiBelum: 0 }));
  }

  // --- per Sopir
  const map = new Map();
  const ambil = (key, nama) => {
    if (!map.has(key)) {
      map.set(key, {
        sopir: nama || "(Tanpa Sopir)",
        divisiSet: new Set(),
        nopolSet: new Set(),
        ritasi: 0,
        totalM3: 0,
        komisi: 0,
        komisiBelum: 0,
        pendapatan: 0,
        sparepart: 0,
        hasilBersih: 0,
      });
    }
    return map.get(key);
  };

  // uang kendaraan yang dipegang sopir (sesuai filter Divisi)
  for (const r of data.value.rekap) {
    if (!cocokDivisi(r)) continue;
    if (!r.sopirKey || r.sopirKey === "-") {
      // kendaraan tanpa sopir: tampil hanya kalau memang ada angkanya
      if (!(r.ritasi || r.pendapatan || r.sparepart)) continue;
    }
    const acc = ambil(r.sopirKey || "-", r.sopir);
    acc.divisiSet.add(r.divisi);
    acc.nopolSet.add(r.nopol);
    acc.pendapatan += r.pendapatan;
    acc.sparepart += r.sparepart;
    acc.hasilBersih += r.hasilBersih;
  }
  // ritasi, m3 & komisi dari Surat Jalan
  for (const p of data.value.perSopir || []) {
    // kalau divisi dibatasi, hanya sopir yang punya kendaraan di divisi itu
    if (!showAll && !map.has(p.sopirKey)) continue;
    const acc = ambil(p.sopirKey, p.sopir);
    acc.ritasi = p.ritasi;
    acc.totalM3 = p.totalM3;
    acc.komisi = p.komisi;
    acc.komisiBelum = p.komisiBelumDiambil;
    (p.nopol || []).forEach((n) => acc.nopolSet.add(n));
  }

  return Array.from(map.values())
    .map((r) => ({
      ...r,
      divisi: Array.from(r.divisiSet).join(", ") || "-",
      nopol: Array.from(r.nopolSet).join(", ") || "-",
    }))
    .filter((r) => !q || r.sopir.toLowerCase().includes(q) || r.nopol.toLowerCase().includes(q))
    .sort((x, y) => x.sopir.localeCompare(y.sopir));
});

const totalRitasi = computed(() => rows.value.reduce((s, r) => s + r.ritasi, 0));
const totalM3 = computed(() => rows.value.reduce((s, r) => s + r.totalM3, 0));
const totalKomisi = computed(() => rows.value.reduce((s, r) => s + (r.komisi || 0), 0));
const tidakCocok = computed(() => data.value?.tidakCocok || null);
const adaTidakCocok = computed(() => !!(tidakCocok.value && (tidakCocok.value.sjJumlah || tidakCocok.value.txJumlah)));
const totalPendapatan = computed(() => rows.value.reduce((s, r) => s + r.pendapatan, 0));
const totalSparepart = computed(() => rows.value.reduce((s, r) => s + r.sparepart, 0));
const totalHasilBersih = computed(() => totalPendapatan.value - totalSparepart.value);

let loadSeq = 0;
async function load() {
  if (!bulan.value) return;
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const res = await api.get(`/armada/rekap/${bulan.value}`);
    if (seq === loadSeq) data.value = res; // abaikan respon basi
  } catch (e) {
    if (seq === loadSeq) toast(e.message || "Gagal memuat rekap armada");
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

// Divisi cuma menyaring tampilan (data dari server sama), jadi tidak perlu load ulang.
watch(bulan, load);
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

        <div class="field">
          <label>Cari (Nopol / Sopir)</label>
          <input v-model="search" placeholder="Contoh: B 9244 atau Aceng" />
        </div>

        <div class="field">
          <label>Jenis</label>
          <select v-model="filterJenis" :disabled="groupBy === 'sopir'">
            <option value="Semua">Semua Jenis</option>
            <option v-for="j in jenisTersedia" :key="j" :value="j">{{ j }}</option>
          </select>
        </div>
      </div>

      <div class="msub">
        Ritasi &amp; total m³ diambil dari Surat Jalan bulan terpilih (kendaraan dicocokkan lewat armada
        atau nomor polisi di SJ). Pendapatan (Uang Jalan) dan Sparepart/pengeluaran diambil dari transaksi
        Laporan Divisi yang ditandai per nomor polisi kendaraan.
        <template v-if="groupBy === 'sopir'">
          Mode Sopir: Ritasi, m³ &amp; Komisi dihitung dari Surat Jalan per sopir (komisi hanya tugas TTD lengkap);
          Pendapatan &amp; Sparepart dari kendaraan yang dipegang sopir tsb. Filter Jenis dimatikan di mode ini.
        </template>
      </div>
    </div>

    <div v-if="adaTidakCocok" class="card" style="margin-bottom:16px; border-left:4px solid #d97706;">
      <div style="font-weight:600; margin-bottom:4px;">⚠ Ada data yang belum cocok ke kendaraan manapun</div>
      <div class="msub" style="margin:0;">
        <span v-if="tidakCocok.sjJumlah">
          {{ tidakCocok.sjJumlah }} Surat Jalan tidak punya Armada / No. Polisi yang terdaftar di menu Armada
          (tetap dihitung di mode Sopir, tapi tidak masuk baris kendaraan).
        </span>
        <span v-if="tidakCocok.txJumlah">
          {{ tidakCocok.txJumlah }} transaksi Laporan Divisi (pendapatan {{ rupiah(tidakCocok.txPendapatan) }},
          pengeluaran {{ rupiah(tidakCocok.txPengeluaran) }}) memakai nopol yang tidak ada di menu Armada:
          {{ tidakCocok.txNopol.join(", ") }}. Cek penulisan nopolnya atau daftarkan kendaraannya.
        </span>
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
            <th v-if="groupBy === 'sopir'" style="text-align:right;">Komisi</th>
            <th style="text-align:right;">Pendapatan</th>
            <th style="text-align:right;">Sparepart</th>
            <th style="text-align:right;">Hasil Bersih</th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(r, i) in rows" :key="r.armadaId || r.sopir + i">
            <td class="mono">{{ groupBy === "nopol" ? r.nopol : r.sopir }}</td>
            <td>{{ groupBy === "nopol" ? (r.sopir || "-") : r.nopol }}</td>
            <td>{{ r.divisi }}</td>
            <td style="text-align:right;">{{ r.ritasi }}</td>
            <td style="text-align:right;">{{ fmtM3(r.totalM3) }}</td>
            <td v-if="groupBy === 'sopir'" style="text-align:right;">{{ rupiah(r.komisi) }}</td>
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
            <td style="text-align:right;">{{ fmtM3(totalM3) }}</td>
            <td v-if="groupBy === 'sopir'" style="text-align:right;">{{ rupiah(totalKomisi) }}</td>
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
