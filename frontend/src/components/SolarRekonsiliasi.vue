<!-- Cek Buku vs Real (Stok Solar).
     Alur kerja: setoran REAL dicatat tiap hari di Solar Masuk; isi BUKU diketik
     belakangan (boleh telat / beberapa hari sekaligus). Panel ini mencocokkan
     keduanya per tanggal + nama sopir supaya kelihatan:
       1. Di buku harus setor, tapi real TIDAK setor.
       2. Real setor, tapi TIDAK ada di buku.
       3. Dua-duanya ada tapi liternya beda (kurang / lebih).
     Dua tampilan: "Per Hari" (siapa bermasalah di hari itu) dan "Per Sopir"
     (rekap kumulatif + rincian tanggal). Data: GET /api/solar-buku/rekonsiliasi. -->
<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { fmtL, fmtTgl, isoLokal } from "../utils/solarUtil.js";

const props = defineProps({ versi: { type: Number, default: 0 } });
const emit = defineEmits(["input-real", "berubah"]);

const hariIni = isoLokal(new Date());
// Buku tanggal T dicek dengan setoran real tanggal T+1.
const addHari = (str, n) => {
  const d = new Date(`${str}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const geser = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoLokal(d);
};

const dari = ref(`${hariIni.slice(0, 8)}01`);
const sampai = ref(hariIni);
const data = ref(null);
const loading = ref(false);
const tab = ref("HARI"); // HARI | SOPIR
const filter = ref(""); // status tertentu dari kartu ringkasan
const semuaHari = ref(false); // tampilkan juga hari yang semuanya sesuai
const hanyaMasalah = ref(true); // tab sopir
const terbuka = ref(new Set()); // sopir yang rinciannya dibuka

// ---------- Periode cepat ----------
const PRESET = [
  { k: "hari", label: "Hari ini", dr: () => [hariIni, hariIni] },
  { k: "kemarin", label: "Kemarin", dr: () => [geser(-1), geser(-1)] },
  { k: "7", label: "7 hari", dr: () => [geser(-6), hariIni] },
  { k: "bulan", label: "Bulan ini", dr: () => [`${hariIni.slice(0, 8)}01`, hariIni] },
  {
    k: "lalu",
    label: "Bulan lalu",
    dr: () => {
      const d = new Date();
      const awal = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const akhir = new Date(d.getFullYear(), d.getMonth(), 0);
      return [isoLokal(awal), isoLokal(akhir)];
    },
  },
];
const presetAktif = computed(() => PRESET.find((p) => {
  const [a, b] = p.dr();
  return a === dari.value && b === sampai.value;
})?.k);
function pilihPreset(p) {
  [dari.value, sampai.value] = p.dr();
  muat();
}

const STATUS = {
  SESUAI: { label: "Sesuai", kelas: "badge b-lunas", warna: "#159447" },
  KURANG: { label: "Setor kurang", kelas: "badge b-belum", warna: "#c91c22" },
  LEBIH: { label: "Setor lebih", kelas: "badge b-sebagian", warna: "#c47b12" },
  TIDAK_SETOR: { label: "TIDAK SETOR", kelas: "badge b-belum", warna: "#c91c22" },
  TIDAK_DI_BUKU: { label: "Tidak ada di buku", kelas: "badge b-sebagian", warna: "#c47b12" },
  MENUNGGU: { label: "Belum (hari ini)", kelas: "badge b-belumttd", warna: "#94a3b8" },
};
const MASALAH = ["TIDAK_SETOR", "TIDAK_DI_BUKU", "KURANG", "LEBIH"];

async function muat() {
  if (!dari.value || !sampai.value) return;
  loading.value = true;
  try {
    data.value = await api.get(`/solar-buku/rekonsiliasi?dari=${dari.value}&sampai=${sampai.value}`);
  } catch (e) {
    toast(e?.message || "Gagal memuat perbandingan buku dan real");
  } finally {
    loading.value = false;
  }
}
onMounted(muat);
watch(() => props.versi, muat);

const ringkasan = computed(() => data.value?.ringkasan || {});
const kosongList = computed(() => data.value?.tanggalBukuKosong || []);

// ---------- Per Hari ----------
const hariList = computed(() => {
  const rows = data.value?.rows || [];
  const peta = new Map();
  for (const r of rows) {
    if (!peta.has(r.tanggal)) peta.set(r.tanggal, []);
    peta.get(r.tanggal).push(r);
  }
  const urut = { TIDAK_SETOR: 0, KURANG: 1, TIDAK_DI_BUKU: 2, LEBIH: 3, MENUNGGU: 4, SESUAI: 5 };
  const out = [];
  for (const [tanggal, list] of peta) {
    list.sort((a, b) => urut[a.status] - urut[b.status] || a.nama.localeCompare(b.nama, "id"));
    const masalah = list.filter((r) => MASALAH.includes(r.status));
    out.push({
      tanggal,
      rows: list,
      masalah,
      sesuai: list.filter((r) => r.status === "SESUAI").length,
      tidakSetor: list.filter((r) => r.status === "TIDAK_SETOR").length,
      tidakDiBuku: list.filter((r) => r.status === "TIDAK_DI_BUKU").length,
    });
  }
  return out.sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
});
const hariTampil = computed(() => {
  let list = hariList.value;
  if (filter.value) {
    return list
      .map((h) => ({ ...h, rows: h.rows.filter((r) => r.status === filter.value) }))
      .filter((h) => h.rows.length);
  }
  if (!semuaHari.value) list = list.filter((h) => h.masalah.length);
  return list;
});
const hariBersih = computed(() => hariList.value.filter((h) => !h.masalah.length && h.rows.some((r) => r.status === "SESUAI")).length);
const adaMasalah = computed(() => hariList.value.some((h) => h.masalah.length));

function pilihFilter(f) {
  filter.value = filter.value === f ? "" : f;
  tab.value = "HARI";
}

const labelHari = (tgl) =>
  new Date(`${tgl}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

// ---------- Per Sopir ----------
const sopirTampil = computed(() => {
  const list = data.value?.perSopir || [];
  return hanyaMasalah.value ? list.filter((s) => s.bermasalah) : list;
});
function bukaTutup(nama) {
  const s = new Set(terbuka.value);
  s.has(nama) ? s.delete(nama) : s.add(nama);
  terbuka.value = s;
}
const kalimatRincian = (x) => {
  if (x.status === "TIDAK_SETOR") return `${x.masihBisaSetor ? "belum setor sampai sekarang" : "tidak setor"} (buku ${fmtL(x.bukuLiter)} L)`;
  if (x.status === "TIDAK_DI_BUKU") return `setor ${fmtL(x.realLiter)} L, tidak ada di buku`;
  if (x.status === "KURANG") return `buku ${fmtL(x.bukuLiter)} L, setor ${fmtL(x.realLiter)} L (kurang ${fmtL(-x.selisih)} L)`;
  return `buku ${fmtL(x.bukuLiter)} L, setor ${fmtL(x.realLiter)} L (lebih ${fmtL(x.selisih)} L)`;
};

async function salinRekap() {
  const list = (data.value?.perSopir || []).filter((s) => s.bermasalah);
  if (!list.length) return toast("Tidak ada sopir bermasalah untuk disalin");
  const teks = [`Rekap Solar Buku vs Real, ${fmtTgl(dari.value)} s/d ${fmtTgl(sampai.value)}`, ""];
  for (const s of list) {
    teks.push(`*${s.nama}*`);
    if (s.totalKurang) teks.push(`- Kurang total ${fmtL(s.totalKurang)} L`);
    if (s.tidakSetor) teks.push(`- Tidak setor ${s.tidakSetor}x (${fmtL(s.literTidakSetor)} L)`);
    if (s.kurang) teks.push(`- Setor kurang ${s.kurang}x (${fmtL(s.kurangLiter)} L)`);
    if (s.tidakDiBuku) teks.push(`- Setor tapi tidak di buku ${s.tidakDiBuku}x (${fmtL(s.literTidakDiBuku)} L)`);
    if (s.lebih) teks.push(`- Setor lebih ${s.lebih}x (${fmtL(s.lebihLiter)} L)`);
    teks.push("");
  }
  try {
    await navigator.clipboard.writeText(teks.join("\n").trim());
    toast("Rekap disalin, tinggal tempel di WhatsApp");
  } catch {
    toast("Gagal menyalin rekap");
  }
}

// ---------- Isi buku ----------
// Satu baris = satu sopir ("Aceng 200", "Budi - 150", "Wartono: 1.200").
// Baris yang hanya berisi tanggal ("28/9", "28 sep", "2026-09-28") memindah
// tanggal, jadi beberapa hari bisa ditempel sekaligus.
const bukaIsi = ref(false);
const tglBuku = ref(geser(-1));
const teksBuku = ref("");
const menyimpan = ref(false);

const BULAN = { jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6, jul: 7, agu: 8, agt: 8, sep: 9, okt: 10, nov: 11, des: 12 };
function parseTanggalBaris(baris, tahun) {
  const b = baris.trim();
  const pad = (n) => String(n).padStart(2, "0");
  const ok = (y, m, d) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  };
  let m = b.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = b.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (m) return ok(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : tahun, +m[2], +m[1]);
  m = b.match(/^(\d{1,2})\s+([a-z]+)\.?\s*(\d{4})?$/i);
  if (m && BULAN[m[2].slice(0, 3).toLowerCase()]) return ok(m[3] ? +m[3] : tahun, BULAN[m[2].slice(0, 3).toLowerCase()], +m[1]);
  return null;
}

function parseBuku(teks, tglAwal) {
  const tahun = Number(tglAwal.slice(0, 4));
  const grup = new Map(); // tanggal -> items
  const gagal = [];
  let tgl = tglAwal;
  for (const mentah of String(teks || "").split(/\r?\n/)) {
    const baris = mentah.trim();
    if (!baris) continue;
    const t = parseTanggalBaris(baris, tahun);
    if (t) {
      tgl = t;
      continue;
    }
    const m = baris.match(/^(.*?)[\s:=\-–]+([\d.,]+)\s*(?:l|lt|ltr|liter)?\.?$/i);
    if (!m || !m[1].trim()) {
      gagal.push(baris);
      continue;
    }
    let angka = m[2];
    if (/^\d{1,3}(\.\d{3})+$/.test(angka)) angka = angka.replace(/\./g, "");
    const liter = Number(angka.replace(",", "."));
    if (!Number.isFinite(liter) || liter <= 0) {
      gagal.push(baris);
      continue;
    }
    if (!grup.has(tgl)) grup.set(tgl, []);
    grup.get(tgl).push({ nama: m[1].trim(), liter });
  }
  const total = [...grup.values()].reduce((s, a) => s + a.length, 0);
  return { grup, gagal, total };
}
const hasilParse = computed(() => parseBuku(teksBuku.value, tglBuku.value));

async function simpanBuku() {
  const { grup, gagal, total } = hasilParse.value;
  if (!total) return toast("Belum ada baris yang valid. Format: Nama spasi liter, contoh: Aceng 200");
  if (gagal.length && !confirm(`${gagal.length} baris tidak terbaca dan akan dilewati:\n\n${gagal.join("\n")}\n\nLanjut simpan ${total} baris yang valid?`)) return;
  menyimpan.value = true;
  try {
    let simpan = 0;
    let lewat = 0;
    for (const [tanggal, items] of grup) {
      const r = await api.post("/solar-buku/massal", { tanggal, items });
      simpan += r.disimpan;
      lewat += r.dilewati.length;
      if (tanggal < dari.value) dari.value = tanggal;
      if (tanggal > sampai.value) sampai.value = tanggal;
    }
    toast(`${simpan} baris buku disimpan${lewat ? `, ${lewat} dilewati (sudah ada / tidak valid)` : ""}`);
    teksBuku.value = "";
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal menyimpan isi buku");
  } finally {
    menyimpan.value = false;
  }
}

function isiTanggal(k) {
  tglBuku.value = k.tanggalBuku || addHari(k.tanggal, -1);
  bukaIsi.value = true;
  teksBuku.value = "";
}
const tglSetorDicek = computed(() => addHari(tglBuku.value, 1));
const refReal = computed(() => kosongList.value.find((k) => k.tanggal === tglSetorDicek.value) || null);

// ---------- Aksi per baris ----------
async function masukkanKeBuku(r) {
  try {
    for (const id of r.realIds) await api.post("/solar-buku/dari-real", { solarTxId: id });
    toast(`${r.nama} (${fmtL(r.realLiter)} L) dimasukkan ke buku`);
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal memasukkan ke buku");
  }
}

async function ubahBuku(r) {
  if (r.bukuIds.length !== 1) return toast("Ada lebih dari satu baris buku untuk nama ini, hapus lalu isi ulang.");
  const v = prompt(`Liter di buku untuk ${r.nama} (${fmtTgl(r.tanggal)}):`, String(r.bukuLiter));
  if (v === null) return;
  const liter = Number(String(v).replace(",", "."));
  if (!Number.isFinite(liter) || liter <= 0) return toast("Liter harus angka lebih dari 0");
  try {
    await api.put(`/solar-buku/${r.bukuIds[0]}`, { liter });
    toast("Isi buku diperbarui");
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal memperbarui isi buku");
  }
}

async function hapusBuku(r) {
  if (!confirm(`Hapus ${r.nama} (${fmtL(r.bukuLiter)} L) dari buku tanggal ${fmtTgl(r.tanggal)}? Setoran real tidak ikut terhapus.`)) return;
  try {
    for (const id of r.bukuIds) await api.delete(`/solar-buku/${id}`);
    toast("Dihapus dari buku");
    await muat();
    emit("berubah");
  } catch (e) {
    toast(e?.message || "Gagal menghapus dari buku");
  }
}

// Kalimat selisih yang langsung bisa dipahami
function ket(r) {
  if (r.status === "TIDAK_SETOR") return r.masihBisaSetor ? `Belum setor sampai sekarang (${fmtL(r.bukuLiter)} L)` : `Kurang ${fmtL(r.bukuLiter)} L (tidak setor)`;
  if (r.status === "TIDAK_DI_BUKU") return `Setor ${fmtL(r.realLiter)} L, belum di buku`;
  if (r.status === "KURANG") return `Kurang ${fmtL(Math.abs(r.selisih))} L`;
  if (r.status === "LEBIH") return `Lebih ${fmtL(r.selisih)} L`;
  if (r.status === "MENUNGGU") return "Menunggu setoran hari ini";
  return "Pas";
}
</script>

<template>
  <div class="card" style="margin-bottom: 20px" :style="adaMasalah ? 'border-color: #f3b4b4' : ''">
    <div class="section-title">
      Cek Buku vs Real
      <span v-if="data" class="tag">{{ data.rows.length }} baris dibandingkan</span>
    </div>
    <div class="msub" style="margin-bottom: 12px">
      Buku = catatan "harusnya setor". Real = setoran yang benar-benar dicatat di Solar Masuk.
      <b>Buku tanggal 1 otomatis dicek dengan setoran tanggal 2</b> (besoknya). Buku boleh diisi belakangan, kapan saja.
    </div>

    <!-- Periode + isi buku -->
    <div class="rk-bar">
      <div class="rk-chips">
        <button v-for="p in PRESET" :key="p.k" class="rk-chip" :class="{ aktif: presetAktif === p.k }" @click="pilihPreset(p)">{{ p.label }}</button>
      </div>
      <div class="field" style="margin: 0">
        <label>Dari</label>
        <input v-model="dari" type="date" @change="muat" />
      </div>
      <div class="field" style="margin: 0">
        <label>Sampai</label>
        <input v-model="sampai" type="date" @change="muat" />
      </div>
      <button class="btn" :class="bukaIsi ? 'btn-ghost' : 'btn-primary'" @click="bukaIsi = !bukaIsi">{{ bukaIsi ? "Tutup" : "+ Isi buku" }}</button>
    </div>

    <div v-if="bukaIsi" class="rk-isi">
      <div class="rk-isi-grid">
        <div class="field" style="margin: 0">
          <label>Tanggal di buku</label>
          <input v-model="tglBuku" type="date" />
          <div class="msub" style="font-size: 11px; margin-top: 4px">Dicek dengan setoran tgl <b>{{ fmtTgl(tglSetorDicek) }}</b></div>
        </div>
        <div class="field" style="margin: 0">
          <label>Isi buku (satu baris satu sopir)</label>
          <textarea v-model="teksBuku" rows="6" placeholder="Aceng 200&#10;Budi 150&#10;&#10;kalau beberapa hari sekaligus, tulis tanggalnya sendiri:&#10;28/9&#10;Aceng 100&#10;Wartono 250"></textarea>
        </div>
      </div>
      <div v-if="refReal" class="rk-ref">
        Setoran real tgl {{ fmtTgl(refReal.tanggal) }} (contekan, jangan disalin mentah):
        <b>{{ refReal.daftar.map((d) => `${d.nama} ${fmtL(d.liter)}`).join(", ") }}</b>
      </div>
      <div class="msub" style="margin: 6px 0 10px">
        Format: <b>Nama [spasi] liter</b>. Baris berisi tanggal saja (contoh <b>28/9</b>) memindah ke tanggal itu.
        Terbaca <b>{{ hasilParse.total }}</b> baris di <b>{{ hasilParse.grup.size }}</b> tanggal<template v-if="hasilParse.gagal.length">,
        <span style="color: #b91c1c">{{ hasilParse.gagal.length }} baris tidak terbaca</span></template>.
        Nama yang mirip (huruf besar/kecil, singkatan) otomatis disamakan.
      </div>
      <button class="btn btn-primary" :disabled="menyimpan || !hasilParse.total" @click="simpanBuku">
        {{ menyimpan ? "Menyimpan..." : `Simpan ke buku (${hasilParse.total})` }}
      </button>
    </div>

    <div v-if="loading && !data" class="empty small">Memuat…</div>

    <template v-if="data">
      <!-- Tanggal yang bukunya belum diisi -->
      <div v-if="kosongList.length" class="rk-info">
        <div style="margin-bottom: 6px">
          <b>Buku belum diisi untuk {{ kosongList.length }} tanggal</b>. Setoran di tanggal berikut belum bisa dicek (bukunya adalah tanggal sehari sebelumnya), dan tidak dihitung sebagai "tidak ada di buku".
        </div>
        <div class="rk-kosong">
          <button v-for="k in kosongList.slice(0, 10)" :key="k.tanggal" class="rk-chip" @click="isiTanggal(k)">
            Buku {{ fmtTgl(k.tanggalBuku || addHari(k.tanggal, -1)) }} → setoran {{ fmtTgl(k.tanggal) }} · {{ k.setoran }} setoran · isi
          </button>
          <span v-if="kosongList.length > 10" class="msub">+{{ kosongList.length - 10 }} tanggal lain</span>
        </div>
      </div>

      <!-- Ringkasan -->
      <div class="rk-kpis">
        <button class="rk-kpi" :class="{ aktif: filter === 'TIDAK_SETOR' }" style="--c: #c91c22" @click="pilihFilter('TIDAK_SETOR')">
          <div class="rk-lbl">Di buku, TIDAK setor</div>
          <div class="rk-val">{{ ringkasan.tidakSetor || 0 }}<small>kali</small></div>
          <div class="rk-sub">{{ fmtL(ringkasan.literTidakSetor) }} L belum masuk</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'TIDAK_DI_BUKU' }" style="--c: #c47b12" @click="pilihFilter('TIDAK_DI_BUKU')">
          <div class="rk-lbl">Setor, TIDAK di buku</div>
          <div class="rk-val">{{ ringkasan.tidakDiBuku || 0 }}<small>kali</small></div>
          <div class="rk-sub">{{ fmtL(ringkasan.literTidakDiBuku) }} L belum tercatat</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'KURANG' }" style="--c: #c91c22" @click="pilihFilter('KURANG')">
          <div class="rk-lbl">Setor kurang</div>
          <div class="rk-val">{{ ringkasan.kurang || 0 }}<small>kali</small></div>
          <div class="rk-sub">kurang {{ fmtL(ringkasan.literKurang) }} L</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'LEBIH' }" style="--c: #c47b12" @click="pilihFilter('LEBIH')">
          <div class="rk-lbl">Setor lebih</div>
          <div class="rk-val">{{ ringkasan.lebih || 0 }}<small>kali</small></div>
          <div class="rk-sub">lebih {{ fmtL(ringkasan.literLebih) }} L</div>
        </button>
        <button class="rk-kpi" :class="{ aktif: filter === 'SESUAI' }" style="--c: #159447" @click="pilihFilter('SESUAI')">
          <div class="rk-lbl">Sesuai</div>
          <div class="rk-val">{{ ringkasan.sesuai || 0 }}<small>kali</small></div>
          <div class="rk-sub">buku = real</div>
        </button>
      </div>

      <!-- Tab -->
      <div class="rk-tabs">
        <button :class="{ aktif: tab === 'HARI' }" @click="tab = 'HARI'">Per Hari</button>
        <button :class="{ aktif: tab === 'SOPIR' }" @click="tab = 'SOPIR'; filter = ''">Per Sopir</button>
      </div>

      <!-- ===== PER HARI ===== -->
      <template v-if="tab === 'HARI'">
        <div class="rk-tools">
          <div v-if="filter" class="msub" style="font-weight: 600">
            Filter: {{ STATUS[filter]?.label }}
            <button class="btn btn-ghost btn-sm" @click="filter = ''">Reset</button>
          </div>
          <label v-else class="rk-cek">
            <input v-model="semuaHari" type="checkbox" /> Tampilkan juga hari yang semuanya sesuai
            <span v-if="hariBersih" class="msub">({{ hariBersih }} hari)</span>
          </label>
        </div>

        <div v-if="!hariTampil.length" class="empty small">
          <template v-if="!data.rows.length">Belum ada isi buku maupun setoran pada periode ini.</template>
          <template v-else-if="!filter">Tidak ada selisih. Semua yang tercatat di buku sesuai dengan setoran real. 🎉</template>
          <template v-else>Tidak ada baris untuk filter ini.</template>
        </div>

        <div v-for="h in hariTampil" :key="h.tanggal" class="rk-hari">
          <div class="rk-hari-h">
            <b>Setoran {{ labelHari(h.tanggal) }}</b>
            <span class="msub">(dicek dengan buku {{ fmtTgl(addHari(h.tanggal, -1)) }})</span>
            <span v-if="h.tidakSetor" class="badge b-belum">{{ h.tidakSetor }} tidak setor</span>
            <span v-if="h.tidakDiBuku" class="badge b-sebagian">{{ h.tidakDiBuku }} tidak di buku</span>
            <span v-if="h.masalah.length - h.tidakSetor - h.tidakDiBuku > 0" class="badge b-sebagian">
              {{ h.masalah.length - h.tidakSetor - h.tidakDiBuku }} selisih liter
            </span>
            <span v-if="h.sesuai" class="msub">{{ h.sesuai }} sesuai</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sopir</th>
                  <th class="num">Buku</th>
                  <th class="num">Real</th>
                  <th>Hasil</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in h.rows" :key="i" :style="{ boxShadow: `inset 4px 0 0 ${STATUS[r.status]?.warna}` }">
                  <td>
                    <b>{{ r.nama }}</b>
                    <div v-if="r.bukuSumber === 'CATATAN_REAL'" class="msub" style="font-size: 11px">buku dari catatan lama di setoran</div>
                    <div v-if="r.keterangan" class="msub" style="font-size: 11px">{{ r.keterangan }}</div>
                  </td>
                  <td class="num mono">{{ r.bukuLiter == null ? "—" : fmtL(r.bukuLiter) }}</td>
                  <td class="num mono">{{ r.status === "MENUNGGU" ? "—" : fmtL(r.realLiter) }}</td>
                  <td>
                    <span :class="STATUS[r.status]?.kelas">{{ STATUS[r.status]?.label }}</span>
                    <div v-if="r.status !== 'SESUAI'" class="msub" style="font-size: 11px; margin-top: 2px">{{ ket(r) }}</div>
                  </td>
                  <td style="white-space: nowrap">
                    <button v-if="r.status === 'TIDAK_DI_BUKU'" class="btn btn-sm btn-primary" @click="masukkanKeBuku(r)">+ Masukkan ke buku</button>
                    <button v-if="r.status === 'TIDAK_SETOR' || r.status === 'MENUNGGU'" class="btn btn-sm btn-ghost" title="Ternyata sudah setor, catat di Solar Masuk" @click="emit('input-real', r)">Catat setoran</button>
                    <template v-if="r.bukuIds.length">
                      <button class="btn btn-sm btn-ghost" @click="ubahBuku(r)">Ubah buku</button>
                      <button class="btn btn-sm btn-ghost" @click="hapusBuku(r)">Hapus buku</button>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <!-- ===== PER SOPIR ===== -->
      <template v-else>
        <div class="rk-tools">
          <label class="rk-cek"><input v-model="hanyaMasalah" type="checkbox" /> Hanya sopir yang bermasalah</label>
          <button class="btn btn-ghost btn-sm" @click="salinRekap">Salin rekap (WhatsApp)</button>
        </div>
        <div v-if="!sopirTampil.length" class="empty small">Tidak ada sopir bermasalah pada periode ini.</div>
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sopir</th>
                <th class="num">Dicek</th>
                <th class="num">Sesuai</th>
                <th class="num">Tidak setor</th>
                <th class="num">Tidak di buku</th>
                <th class="num">Total kurang</th>
                <th class="num">Total lebih</th>
                <th class="num">Selisih bersih</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="s in sopirTampil" :key="s.nama">
                <tr class="rk-klik" @click="bukaTutup(s.nama)">
                  <td>
                    <span class="rk-pan">{{ terbuka.has(s.nama) ? "▾" : "▸" }}</span> <b>{{ s.nama }}</b>
                  </td>
                  <td class="num mono">{{ s.hariDicek }}×</td>
                  <td class="num mono" style="color: #159447">{{ s.sesuai || "-" }}</td>
                  <td class="num mono">
                    <span v-if="s.tidakSetor" style="color: #b91c1c; font-weight: 600">{{ s.tidakSetor }}× · {{ fmtL(s.literTidakSetor) }} L</span><span v-else>-</span>
                  </td>
                  <td class="num mono">
                    <span v-if="s.tidakDiBuku" style="color: #b45309; font-weight: 600">{{ s.tidakDiBuku }}× · {{ fmtL(s.literTidakDiBuku) }} L</span><span v-else>-</span>
                  </td>
                  <td class="num mono" :style="s.totalKurang ? 'color:#b91c1c;font-weight:700' : ''">{{ s.totalKurang ? `${fmtL(s.totalKurang)} L` : "-" }}</td>
                  <td class="num mono" :style="s.totalLebih ? 'color:#b45309;font-weight:700' : ''">{{ s.totalLebih ? `${fmtL(s.totalLebih)} L` : "-" }}</td>
                  <td class="num mono" :style="s.selisihBersih < 0 ? 'color:#b91c1c;font-weight:700' : s.selisihBersih > 0 ? 'color:#b45309;font-weight:700' : ''">
                    {{ s.selisihBersih > 0 ? "+" : s.selisihBersih < 0 ? "−" : "" }}{{ s.selisihBersih ? `${fmtL(Math.abs(s.selisihBersih))} L` : "0" }}
                  </td>
                </tr>
                <tr v-if="terbuka.has(s.nama)">
                  <td colspan="8" class="rk-rinci">
                    <div class="msub" style="margin-bottom: 4px">
                      Buku total <b>{{ fmtL(s.totalBuku) }} L</b>, real total <b>{{ fmtL(s.totalReal) }} L</b> pada {{ s.hariDicek }} hari yang dicek.
                    </div>
                    <div v-if="!s.rincian.length" class="msub">Semua sesuai.</div>
                    <div v-for="(x, i) in s.rincian" :key="i" class="rk-rinci-baris">
                      <span class="rk-rinci-tgl" :title="`Buku ${fmtTgl(x.tanggalBuku || addHari(x.tanggal, -1))}`">Setor {{ fmtTgl(x.tanggal) }}</span>
                      <span :class="STATUS[x.status]?.kelas">{{ STATUS[x.status]?.label }}</span>
                      <span>{{ kalimatRincian(x) }}</span>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="msub" style="margin-top: 6px; font-size: 11px">
          Total kurang = liter yang seharusnya masuk tapi tidak masuk (tidak setor + setor kurang). Total lebih = liter yang masuk di luar buku
          (setor lebih + tidak ada di buku). Klik nama sopir untuk lihat rincian per tanggal.
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.rk-bar { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 12px; }
.rk-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.rk-chip { border: 1px solid var(--line); background: var(--card); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 12px; cursor: pointer; }
.rk-chip.aktif { background: var(--bms-red-soft); border-color: #f3b4b4; font-weight: 700; }
.rk-isi { background: #f7f9fc; border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin-bottom: 14px; }
.rk-isi-grid { display: grid; grid-template-columns: 180px 1fr; gap: 12px; }
.rk-isi textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13px; resize: vertical; }
.rk-ref { margin-top: 8px; font-size: 12px; color: var(--ink-soft); }
.rk-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
.rk-kpi { text-align: left; background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--c); border-radius: 10px; padding: 10px 12px; cursor: pointer; font: inherit; }
.rk-kpi.aktif { background: #fff8e6; box-shadow: 0 0 0 2px var(--c) inset; }
.rk-lbl { font-size: 11px; color: var(--ink-soft); }
.rk-val { font-size: 24px; font-weight: 800; color: var(--c); line-height: 1.2; }
.rk-val small { font-size: 11px; font-weight: 500; color: var(--ink-soft); margin-left: 4px; }
.rk-sub { font-size: 11px; color: var(--ink-soft); }
.rk-info { margin-top: 4px; margin-bottom: 4px; font-size: 12px; background: #fff7e6; border: 1px solid #f3dfb0; color: #8a5a00; border-radius: 8px; padding: 8px 10px; line-height: 1.5; }
.rk-kosong { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.rk-tabs { display: flex; gap: 4px; margin: 16px 0 10px; border-bottom: 2px solid var(--line); }
.rk-tabs button { border: 0; background: none; padding: 8px 16px; font: inherit; font-weight: 600; color: var(--ink-soft); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
.rk-tabs button.aktif { color: var(--bms-red); border-bottom-color: var(--bms-red); }
.rk-tools { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.rk-cek { font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.rk-hari { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 12px; overflow: hidden; }
.rk-hari-h { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; background: #f7f9fc; border-bottom: 1px solid var(--line); }
.rk-hari .table-wrap { margin: 0; }
.rk-klik { cursor: pointer; }
.rk-klik:hover { background: #f7f9fc; }
.rk-pan { color: var(--ink-soft); display: inline-block; width: 12px; }
.rk-rinci { background: #fafbfd; padding: 10px 14px 12px 30px !important; font-size: 12px; }
.rk-rinci-baris { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 2px 0; }
.rk-rinci-tgl { min-width: 110px; color: var(--ink-soft); }
@media (max-width: 700px) { .rk-isi-grid { grid-template-columns: 1fr; } }
</style>