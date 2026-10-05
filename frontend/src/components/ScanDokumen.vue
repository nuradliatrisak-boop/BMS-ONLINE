<!--
  ScanDokumen
  Scan Surat Jalan / Invoice kertas lewat kamera HP -> dibaca otomatis -> dicek admin -> masuk sistem.

  Pemakaian:
    <ScanDokumen v-if="showScan" tipe="SJ" @close="showScan = false" @saved="reload" />
    <ScanDokumen v-if="showScan" tipe="INVOICE" ... />

  Pembaca teks (OCR) = Tesseract.js, jalan DI HP (gratis, foto tidak dikirim ke mana-mana).
  Kalau server punya GEMINI_API_KEY, tersedia opsi "Pakai AI" yang lebih akurat.
  Aturan baca ada di utils/scanParser.js (salinan dari backend/public/simple/scan-parser.js).
-->
<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { api } from "../services/api.js";
import { toast } from "../services/toast.js";
import { useAuthStore } from "../stores/auth.js";
import SearchableSelect from "./SearchableSelect.vue";
import P from "../utils/scanParser.js";

const props = defineProps({ tipe: { type: String, default: "SJ" } }); // "SJ" | "INVOICE"
const emit = defineEmits(["close", "saved"]);

const auth = useAuthStore();
const DIVISI = ["Supplier", "Armada", "Alat Berat", "Kontraktor", "Kapal"];
const isSJ = computed(() => props.tipe === "SJ");
const judul = computed(() => (isSJ.value ? "Scan Surat Jalan" : "Scan Invoice"));

// rasio kertas (lebar:tinggi) untuk bingkai panduan.  SJ 9,5"x4,25"  Invoice 9,5"x5,5"
const RASIO = computed(() => (isSJ.value ? 241.3 / 108 : 241.3 / 140));

// CDN tesseract.js (versi dikunci). Bahasa 'eng' cukup untuk cetakan dot-matrix.
const TESS_JS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const TESS_LANG = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int";

// ------------------------------------------------------------------ state
const step = ref("capture"); // capture | proses | review
const customers = ref([]);
const config = reactive({ ai: false, model: null });
const pakaiAi = ref(localStorage.getItem("bms.scan.ai") !== "0");

const photoUrl = ref("");
const rawText = ref("");
const progress = ref({ label: "", pct: 0 });
const errMsg = ref("");
const zoomFoto = ref(false);

// kamera
const videoEl = ref(null);
const boxEl = ref(null);
let stream = null;
let qTimer = null;
const camReady = ref(false);
const camError = ref("");
const facing = ref("environment");
const torchOn = ref(false);
const torchOk = ref(false);
const kualitas = ref({ text: "Arahkan ke kertas", level: "idle" });

// hasil & form
const sj = reactive({
  no: "", tanggal: "", jam: "", divisi: "", customerId: "", penerima: "", tujuan: "",
  jenisBarang: "", noPolisi: "", panjang: 0, lebar: 0, tinggi: 0, timpa: false, warnings: [], match: null,
});
const inv = reactive({
  no: "", tanggal: "", halaman: 1, divisi: "", customerId: "", jenisDefault: "", buatRekap: true,
  rows: [], warnings: [], totalTagihanTerbaca: 0, totalM3Terbaca: 0, match: null, namaTerbaca: "",
});
const saving = ref(false);
const cekSjBusy = ref(false);
let skipWatch = false;

const customerOptions = computed(() =>
  customers.value.map((c) => ({ value: c.id, label: `${c.kode} — ${c.nama}` }))
);

// ------------------------------------------------------------------ util
const fmtRp = (n) => "Rp " + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const m3Sj = computed(() => P.hitungM3(sj.panjang, sj.lebar, sj.tinggi));
function rowM3(r) { return P.hitungM3(r.panjang, r.lebar, r.tinggi); }
function rowJumlah(r) { return Math.round(rowM3(r) * (Number(r.harga) || 0)); }
const invTotal = computed(() => inv.rows.reduce((s, r) => s + rowJumlah(r), 0));
const invTotalM3 = computed(() => inv.rows.reduce((s, r) => s + rowM3(r), 0));
const selisihTotal = computed(() => (inv.totalTagihanTerbaca ? invTotal.value - inv.totalTagihanTerbaca : null));

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Gagal memuat pembaca teks (cek internet HP)."));
    document.head.appendChild(s);
  });
}

// ------------------------------------------------------------------ kamera
async function startCamera() {
  camError.value = "";
  camReady.value = false;
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    camError.value = "Kamera langsung tidak tersedia di browser ini (perlu HTTPS). Pakai tombol “Ambil/Pilih Foto” di bawah.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facing.value }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    await nextTick();
    const v = videoEl.value;
    if (!v) return;
    v.srcObject = stream;
    await v.play().catch(() => {});
    camReady.value = true;
    await nextTick();
    updateFrameStyle();
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    torchOk.value = !!caps.torch;
    torchOn.value = false;
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }
    qTimer = setInterval(cekKualitas, 700);
  } catch (e) {
    camError.value =
      e && e.name === "NotAllowedError"
        ? "Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser, atau pakai tombol “Ambil/Pilih Foto”."
        : "Kamera tidak bisa dibuka (" + (e?.message || e) + "). Pakai tombol “Ambil/Pilih Foto”.";
  }
}

function stopCamera() {
  clearInterval(qTimer);
  qTimer = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  camReady.value = false;
}

async function toggleTorch() {
  if (!stream) return;
  torchOn.value = !torchOn.value;
  try {
    await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: torchOn.value }] });
  } catch {
    torchOn.value = false;
  }
}

function switchCamera() {
  facing.value = facing.value === "environment" ? "user" : "environment";
  startCamera();
}

// Posisi bingkai (px relatif ke kotak kamera)
function frameRect(cw, ch) {
  let w = cw * 0.94;
  let h = w / RASIO.value;
  if (h > ch * 0.78) { h = ch * 0.78; w = h * RASIO.value; }
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}
const frameStyle = ref({});
function updateFrameStyle() {
  const b = boxEl.value;
  if (!b) return;
  const f = frameRect(b.clientWidth, b.clientHeight);
  frameStyle.value = { left: f.x + "px", top: f.y + "px", width: f.w + "px", height: f.h + "px" };
}

// area video (piksel asli) yang berada di dalam bingkai
function cropFromVideo() {
  const v = videoEl.value, b = boxEl.value;
  const cw = b.clientWidth, ch = b.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
  const scale = Math.max(cw / vw, ch / vh); // object-fit: cover
  const ox = (cw - vw * scale) / 2, oy = (ch - vh * scale) / 2;
  const f = frameRect(cw, ch);
  const pad = 0.02; // longgarkan 2% supaya tepi kertas tidak terpotong
  const sx = Math.max(0, (f.x - f.w * pad - ox) / scale);
  const sy = Math.max(0, (f.y - f.h * pad - oy) / scale);
  const sw = Math.min(vw - sx, (f.w * (1 + 2 * pad)) / scale);
  const sh = Math.min(vh - sy, (f.h * (1 + 2 * pad)) / scale);
  return { sx, sy, sw, sh };
}

function cekKualitas() {
  const v = videoEl.value;
  if (!v || !v.videoWidth || !boxEl.value) return;
  try {
    const { sx, sy, sw, sh } = cropFromVideo();
    const w = 240, h = Math.max(40, Math.round((w * sh) / sw));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
    const q = P.quality(ctx.getImageData(0, 0, w, h).data, w, h);
    if (q.brightness < 70) kualitas.value = { text: "Kurang terang — dekatkan ke lampu / nyalakan senter", level: "bad" };
    else if (q.brightness > 225) kualitas.value = { text: "Terlalu silau — miringkan sedikit", level: "bad" };
    else if (q.sharpness < 120) kualitas.value = { text: "Belum fokus — tahan HP, tunggu sebentar", level: "warn" };
    else kualitas.value = { text: "Bagus — tahan, lalu ambil foto", level: "ok" };
  } catch {
    /* abaikan */
  }
}

function ambilFoto() {
  const v = videoEl.value;
  if (!v || !v.videoWidth) return;
  const { sx, sy, sw, sh } = cropFromVideo();
  const outW = Math.min(2400, Math.round(sw));
  const outH = Math.round((outW * sh) / sw);
  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  c.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
  prosesCanvas(c);
}

function dariFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const w = Math.min(2400, img.naturalWidth);
    const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    prosesCanvas(c);
  };
  img.onerror = () => { errMsg.value = "Foto tidak bisa dibuka."; };
  img.src = url;
}

// ------------------------------------------------------------------ proses
async function prosesCanvas(canvas) {
  stopCamera();
  errMsg.value = "";
  const pw = Math.min(1800, canvas.width), ph = Math.round((pw * canvas.height) / canvas.width);
  const pc = document.createElement("canvas");
  pc.width = pw; pc.height = ph;
  pc.getContext("2d").drawImage(canvas, 0, 0, pw, ph);
  photoUrl.value = pc.toDataURL("image/jpeg", 0.85);
  step.value = "proses";

  let hasil = null;
  try {
    if (config.ai && pakaiAi.value) {
      progress.value = { label: "AI membaca dokumen…", pct: 30 };
      try {
        const j = await api.post("/scan/ai-extract", { tipe: props.tipe, image: photoUrl.value });
        hasil = P.fromAi(props.tipe, j);
      } catch (e) {
        toast("AI gagal: " + e.message + " — pakai pembaca bawaan");
      }
    }
    if (!hasil) hasil = await bacaOcr(canvas);
    rawText.value = hasil.rawText || "";
    terapkanHasil(hasil);
    step.value = "review";
    if (!isSJ.value && inv.customerId) cekSjDiSistem();
  } catch (e) {
    errMsg.value = e.message || "Gagal membaca dokumen";
    step.value = "capture";
    startCamera();
  }
}

// Beberapa percobaan pemrosesan foto (kanal warna & ukuran berbeda); dipilih hasil yang paling lengkap.
const VARIAN = [
  { W: 2400, channel: "r" },
  { W: 3200, channel: "luma" },
  { W: 3200, channel: "r" },
];

async function bacaOcr(canvas) {
  progress.value = { label: "Menyiapkan pembaca teks (pertama kali ±3 MB)…", pct: 3 };
  await loadScript(TESS_JS);
  let aktif = 0;
  const worker = await window.Tesseract.createWorker("eng", 1, {
    langPath: TESS_LANG,
    logger: (m) => {
      const dasar = 10 + aktif * 28;
      if (m.status === "recognizing text") progress.value = { label: `Membaca teks (percobaan ${aktif + 1}/${VARIAN.length})…`, pct: dasar + Math.round(m.progress * 26) };
      else if (m.status && m.status.indexOf("loading") === 0) progress.value = { label: "Memuat data bahasa…", pct: 8 };
    },
  });
  let best = null, bestScore = -1;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    for (let k = 0; k < VARIAN.length; k++) {
      aktif = k;
      const { W, channel } = VARIAN[k];
      const H = Math.round((W * canvas.height) / canvas.width);
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, 0, 0, W, H);
      progress.value = { label: `Membersihkan foto (percobaan ${k + 1}/${VARIAN.length})…`, pct: 8 + k * 28 };
      await new Promise((r) => setTimeout(r, 30));
      const id = ctx.getImageData(0, 0, W, H);
      const bin = P.binarize(id, { channel });
      for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
        id.data[p] = id.data[p + 1] = id.data[p + 2] = bin[i];
        id.data[p + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      const { data } = await worker.recognize(c);
      const hasil = isSJ.value ? P.parseSuratJalan(data.text) : P.parseInvoice(data.text);
      const sc = P.scoreResult(props.tipe, hasil);
      if (sc > bestScore) { best = hasil; bestScore = sc; best.rawText = data.text; }
      // sudah lengkap & cocok -> tidak perlu percobaan lagi
      if (isSJ.value ? sc >= 9 : hasil.totalCocok) break;
    }
  } finally {
    worker.terminate();
  }
  return best;
}

function isoDateOnly(v) { return v ? String(v).slice(0, 10) : ""; }

function terapkanHasil(h) {
  const def = auth.user?.divisi && DIVISI.includes(auth.user.divisi) ? auth.user.divisi : "Supplier";
  if (isSJ.value) {
    Object.assign(sj, {
      no: h.no, tanggal: h.tanggal, jam: h.jam, divisi: def,
      penerima: h.penerima || h.dari, tujuan: h.tujuan, jenisBarang: h.jenisBarang, noPolisi: h.noPolisi,
      panjang: h.panjang, lebar: h.lebar, tinggi: h.tinggi, timpa: false, warnings: h.warnings.slice(),
    });
    const m = P.matchCustomer(customers.value, { nama: h.dari || h.penerima });
    sj.customerId = m ? m.id : "";
    sj.match = m;
    if (!m) sj.warnings.push("Customer belum cocok otomatis — pilih manual.");
  } else {
    const m = P.matchCustomer(customers.value, { kode: h.kodeCustomer, nama: h.namaCustomer });
    // harga master customer -> bantu koreksi harga yang salah baca
    const cust = m ? customers.value.find((c) => c.id === m.id) : null;
    if (cust && cust.prices && cust.prices.length && h.rows.length && !h.totalCocok) {
      P.reconcileHarga(h, cust.prices.map((p) => Number(p.hargaM3)).filter(Boolean));
    }
    skipWatch = inv.customerId !== (m ? m.id : "");
    Object.assign(inv, {
      no: h.no, tanggal: h.tanggal, halaman: h.halaman, divisi: def, customerId: m ? m.id : "",
      jenisDefault: "", buatRekap: true, warnings: h.warnings.slice(),
      totalTagihanTerbaca: h.totalTagihanTerbaca, totalM3Terbaca: h.totalM3Terbaca,
      match: m, namaTerbaca: h.namaCustomer,
      rows: h.rows.map((r) => ({
        ...r, suratJalanId: "", sjStatus: "", sjInfo: null, key: Math.random().toString(36).slice(2),
      })),
    });
    if (!m) inv.warnings.push("Customer belum cocok otomatis — pilih manual.");
  }
}

// ------------------------------------------------------------------ invoice: cek SJ
async function cekSjDiSistem() {
  if (!inv.customerId || !inv.rows.length) return;
  cekSjBusy.value = true;
  try {
    const res = await api.post("/scan/invoice/preview", {
      customerId: inv.customerId,
      rows: inv.rows.map((r) => ({
        noSJ: r.noSJ, tglKirim: r.tglKirim, panjang: r.panjang, lebar: r.lebar, tinggi: r.tinggi,
      })),
    });
    res.forEach((x, i) => {
      const r = inv.rows[i];
      if (!r) return;
      r.sjStatus = x.status;
      r.sjInfo = x.sj;
      r.suratJalanId = x.status === "ADA" ? x.sj.id : "";
    });
  } catch (e) {
    toast("Cek SJ gagal: " + e.message);
  } finally {
    cekSjBusy.value = false;
  }
}

// kalau admin mengganti customer manual -> cocokkan ulang SJ
watch(() => inv.customerId, () => {
  if (skipWatch) { skipWatch = false; return; }
  if (step.value === "review" && !isSJ.value) cekSjDiSistem();
});

function pakaiSaran(r) {
  r.suratJalanId = r.sjInfo.id;
  r.noSJ = String(r.sjInfo.no).replace(/\D/g, "");
  r.tglKirim = isoDateOnly(r.sjInfo.tanggal);
  r.sjStatus = "ADA";
}

function tambahBaris() {
  inv.rows.push({
    tglKirim: inv.tanggal, noSJ: "", kode: "", alamat: "", panjang: 0, lebar: 0, tinggi: 0, harga: 0,
    warn: [], suratJalanId: "", sjStatus: "", sjInfo: null, key: Math.random().toString(36).slice(2),
  });
}
function hapusBaris(i) { inv.rows.splice(i, 1); }

// ------------------------------------------------------------------ simpan
async function simpanSJ() {
  if (!sj.no || !sj.tanggal || !sj.divisi) return toast("Nomor, tanggal, dan divisi wajib diisi");
  if (!sj.customerId) return toast("Pilih customer dulu");
  saving.value = true;
  try {
    const res = await api.post("/scan/surat-jalan", {
      no: sj.no, tanggal: sj.tanggal, jam: sj.jam, divisi: sj.divisi, customerId: sj.customerId,
      penerima: sj.penerima, tujuan: sj.tujuan, jenisBarang: sj.jenisBarang, noPolisi: sj.noPolisi,
      panjang: sj.panjang, lebar: sj.lebar, tinggi: sj.tinggi, timpa: sj.timpa,
    });
    toast(res.diperbarui ? `Surat jalan ${sj.no} diperbarui` : `Surat jalan ${sj.no} tersimpan`);
    emit("saved");
    resetUntukBerikutnya();
  } catch (e) {
    if (/sudah ada/i.test(e.message)) sj.warnings.unshift(e.message);
    toast(e.message);
  } finally {
    saving.value = false;
  }
}

async function simpanInvoice() {
  if (!inv.no || !inv.tanggal || !inv.divisi) return toast("Nomor, tanggal, dan divisi wajib diisi");
  if (!inv.customerId) return toast("Pilih customer dulu");
  if (!inv.rows.length) return toast("Belum ada baris invoice");
  for (const r of inv.rows) {
    if (!r.noSJ || !(rowM3(r) > 0) || !(Number(r.harga) > 0)) {
      return toast(`Baris SJ ${r.noSJ || "(kosong)"}: nomor SJ, ukuran P-L-T, dan harga wajib terisi`);
    }
    if (r.sjInfo?.tertagih && r.suratJalanId) return toast(`SJ ${r.sjInfo.no} sudah tertagih di invoice ${r.sjInfo.invoiceNo}`);
  }
  if (selisihTotal.value !== null && Math.abs(selisihTotal.value) > 1) {
    if (!confirm(`Total hitungan ${fmtRp(invTotal.value)} berbeda dari total di kertas ${fmtRp(inv.totalTagihanTerbaca)}.\nTetap simpan?`)) return;
  }
  saving.value = true;
  try {
    const res = await api.post("/scan/invoice", {
      no: inv.no, tanggal: inv.tanggal, halaman: inv.halaman, divisi: inv.divisi, customerId: inv.customerId,
      jenisDefault: inv.jenisDefault, buatRekap: inv.buatRekap,
      items: inv.rows.map((r) => ({
        suratJalanId: r.suratJalanId || undefined, noSJ: r.noSJ, tglKirim: r.tglKirim, kode: r.kode,
        alamat: r.alamat, panjang: r.panjang, lebar: r.lebar, tinggi: r.tinggi, harga: r.harga,
      })),
    });
    toast(
      `Invoice ${res.no} tersimpan (${res.baris} baris, ${fmtRp(res.total)})` +
        (res.sjBaru ? ` • ${res.sjBaru} SJ baru` : "") +
        (inv.buatRekap ? ` • rekap +${res.rekapBaru}` : "")
    );
    emit("saved");
    resetUntukBerikutnya();
  } catch (e) {
    toast(e.message);
    inv.warnings.unshift(e.message);
  } finally {
    saving.value = false;
  }
}

function resetUntukBerikutnya() {
  step.value = "capture";
  photoUrl.value = "";
  errMsg.value = "";
  startCamera();
}

function tutup() { stopCamera(); emit("close"); }
function simpanPilihanAi() { localStorage.setItem("bms.scan.ai", pakaiAi.value ? "1" : "0"); }

onMounted(async () => {
  document.body.style.overflow = "hidden";
  try { customers.value = await api.get("/customers"); } catch (e) { toast("Gagal memuat customer: " + e.message); }
  try { Object.assign(config, await api.get("/scan/config")); } catch { /* AI tidak tersedia */ }
  await nextTick();
  updateFrameStyle();
  window.addEventListener("resize", updateFrameStyle);
  startCamera();
});
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  window.removeEventListener("resize", updateFrameStyle);
  stopCamera();
});
</script>

<template>
  <div class="scan-root">
    <!-- ============ BAR ATAS ============ -->
    <div class="scan-top">
      <button class="scan-x" @click="tutup" aria-label="Tutup">✕</button>
      <div class="scan-title">📷 {{ judul }}</div>
      <div class="scan-steps">
        <span :class="{ on: step === 'capture' }">1 Foto</span>›
        <span :class="{ on: step === 'proses' }">2 Baca</span>›
        <span :class="{ on: step === 'review' }">3 Cek &amp; Simpan</span>
      </div>
    </div>

    <!-- ============ 1. KAMERA ============ -->
    <div v-show="step === 'capture'" class="scan-cam">
      <div ref="boxEl" class="cam-box">
        <video ref="videoEl" playsinline muted autoplay @loadedmetadata="updateFrameStyle"></video>
        <div v-if="camReady" class="cam-frame" :style="frameStyle">
          <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
          <div class="cam-hint">{{ isSJ ? "Seluruh SURAT JALAN di dalam bingkai" : "Seluruh INVOICE (judul sampai total) di dalam bingkai" }}</div>
        </div>
        <div v-if="camReady" class="cam-q" :class="kualitas.level">{{ kualitas.text }}</div>
        <div v-if="camError" class="cam-err">{{ camError }}</div>
      </div>

      <ul class="cam-tips">
        <li>Taruh kertas <b>datar</b> di meja, HP <b>sejajar</b> di atasnya (jangan miring).</li>
        <li>Hindari <b>bayangan tangan/HP</b> dan pantulan lampu. Nyalakan senter bila gelap.</li>
        <li>Pastikan <b>angka-angka tabel</b> terlihat tajam sebelum menekan tombol.</li>
      </ul>

      <div v-if="config.ai" class="cam-ai">
        <label>
          <input type="checkbox" v-model="pakaiAi" @change="simpanPilihanAi" />
          Pakai AI (Gemini) — lebih akurat. Foto dikirim ke Google.
        </label>
      </div>
      <div v-if="errMsg" class="cam-errmsg">{{ errMsg }}</div>

      <div class="cam-actions">
        <button v-if="torchOk" class="btn" @click="toggleTorch">{{ torchOn ? "🔦 Senter ON" : "🔦 Senter" }}</button>
        <button class="btn btn-primary shutter" :disabled="!camReady" @click="ambilFoto">⬤ Ambil Foto</button>
        <label class="btn">
          🖼 Ambil/Pilih Foto
          <input type="file" accept="image/*" hidden @change="dariFile" />
        </label>
        <button v-if="camReady" class="btn" @click="switchCamera">🔄</button>
      </div>
    </div>

    <!-- ============ 2. PROSES ============ -->
    <div v-if="step === 'proses'" class="scan-proc">
      <img v-if="photoUrl" :src="photoUrl" class="proc-img" alt="" />
      <div class="proc-label">{{ progress.label }}</div>
      <div class="proc-bar"><i :style="{ width: progress.pct + '%' }"></i></div>
      <div class="proc-sub">Jangan tutup halaman ini. Biasanya 10–40 detik.</div>
    </div>

    <!-- ============ 3. REVIEW ============ -->
    <div v-if="step === 'review'" class="scan-review">
      <div class="rv-grid">
        <div class="rv-photo">
          <img :src="photoUrl" alt="foto" :class="{ zoom: zoomFoto }" @click="zoomFoto = !zoomFoto" />
          <div class="rv-photo-note">Ketuk foto untuk memperbesar — cocokkan dengan isian di samping.</div>
          <button class="btn btn-sm" @click="resetUntukBerikutnya">↺ Foto ulang</button>
        </div>

        <div class="rv-form">
          <details v-if="rawText" class="rv-raw">
            <summary>Teks mentah hasil baca (untuk diagnosa)</summary>
            <pre>{{ rawText }}</pre>
          </details>
          <div v-if="(isSJ ? sj.warnings : inv.warnings).length" class="rv-warn">
            <b>⚠ Perlu dicek:</b>
            <ul><li v-for="(w, i) in (isSJ ? sj.warnings : inv.warnings)" :key="i">{{ w }}</li></ul>
          </div>

          <!-- ===== SURAT JALAN ===== -->
          <template v-if="isSJ">
            <div class="f2">
              <label>No. Surat Jalan<input v-model="sj.no" /></label>
              <label>Tanggal<input type="date" v-model="sj.tanggal" /></label>
            </div>
            <div class="f2">
              <label>Divisi
                <select v-model="sj.divisi"><option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option></select>
              </label>
              <label>Jam<input v-model="sj.jam" placeholder="14:23:23" /></label>
            </div>
            <label class="fl">Customer
              <SearchableSelect v-model="sj.customerId" :options="customerOptions" placeholder="Pilih customer…" />
              <small v-if="sj.match">Terbaca “{{ sj.penerima }}” → cocok {{ Math.round(sj.match.score * 100) }}%</small>
            </label>
            <label class="fl">Penerima<input v-model="sj.penerima" /></label>
            <label class="fl">Tujuan<input v-model="sj.tujuan" /></label>
            <label class="fl">Jenis barang<input v-model="sj.jenisBarang" /></label>
            <label class="fl">No. Polisi<input v-model="sj.noPolisi" placeholder="B 1234 XYZ" /></label>
            <div class="f3">
              <label>Panjang<input type="number" step="0.01" inputmode="decimal" v-model.number="sj.panjang" /></label>
              <label>Lebar<input type="number" step="0.01" inputmode="decimal" v-model.number="sj.lebar" /></label>
              <label>Tinggi<input type="number" step="0.001" inputmode="decimal" v-model.number="sj.tinggi" /></label>
            </div>
            <div class="rv-m3">M3 = P × L × T = <b>{{ m3Sj.toFixed(3) }}</b></div>
            <label class="chk"><input type="checkbox" v-model="sj.timpa" /> Timpa data lama bila nomor ini sudah ada di sistem</label>
            <button class="btn btn-primary btn-save" :disabled="saving" @click="simpanSJ">
              {{ saving ? "Menyimpan…" : "💾 Simpan Surat Jalan" }}
            </button>
          </template>

          <!-- ===== INVOICE ===== -->
          <template v-else>
            <div class="f2">
              <label>No. Invoice<input v-model="inv.no" /></label>
              <label>Tanggal<input type="date" v-model="inv.tanggal" /></label>
            </div>
            <div class="f2">
              <label>Divisi
                <select v-model="inv.divisi"><option v-for="d in DIVISI" :key="d" :value="d">{{ d }}</option></select>
              </label>
              <label>Halaman<input type="number" min="1" v-model.number="inv.halaman" /></label>
            </div>
            <label class="fl">Customer
              <SearchableSelect v-model="inv.customerId" :options="customerOptions" placeholder="Pilih customer…" />
              <small v-if="inv.match">Terbaca “{{ inv.namaTerbaca }}” → cocok {{ Math.round(inv.match.score * 100) }}%</small>
            </label>

            <div class="inv-rows">
              <div class="inv-rows-h">
                <b>Baris invoice ({{ inv.rows.length }})</b>
                <button class="btn btn-sm" :disabled="cekSjBusy || !inv.customerId" @click="cekSjDiSistem">
                  {{ cekSjBusy ? "Mencocokkan…" : "↻ Cocokkan dgn SJ di sistem" }}
                </button>
              </div>

              <div v-for="(r, i) in inv.rows" :key="r.key" class="inv-row" :class="{ bad: r.warn && r.warn.length }">
                <div class="inv-row-top">
                  <span class="no">#{{ i + 1 }}</span>
                  <label>No SJ<input v-model="r.noSJ" inputmode="numeric" /></label>
                  <label>Tgl kirim<input type="date" v-model="r.tglKirim" /></label>
                  <button class="x" @click="hapusBaris(i)" title="Hapus baris">🗑</button>
                </div>
                <div class="inv-row-nums">
                  <label>P<input type="number" step="0.01" inputmode="decimal" v-model.number="r.panjang" /></label>
                  <label>L<input type="number" step="0.01" inputmode="decimal" v-model.number="r.lebar" /></label>
                  <label>T<input type="number" step="0.01" inputmode="decimal" v-model.number="r.tinggi" /></label>
                  <label>Harga/m³<input type="number" step="500" inputmode="numeric" v-model.number="r.harga" /></label>
                </div>
                <div class="inv-row-sum">
                  M3 <b>{{ rowM3(r).toFixed(3) }}</b> × {{ fmtRp(r.harga) }} = <b>{{ fmtRp(rowJumlah(r)) }}</b>
                </div>
                <div v-if="r.sjStatus" class="sj-chip" :class="r.sjStatus">
                  <template v-if="r.sjStatus === 'ADA'">
                    ✔ SJ di sistem: <b>{{ r.sjInfo.no }}</b>
                    <span v-if="r.sjInfo.tertagih" class="red"> — sudah ditagih di {{ r.sjInfo.invoiceNo }}</span>
                  </template>
                  <template v-else-if="r.sjStatus === 'SARAN'">
                    ❓ Mirip SJ <b>{{ r.sjInfo.no }}</b> ({{ isoDateOnly(r.sjInfo.tanggal) }}, ukuran sama)
                    <button class="btn btn-sm" @click="pakaiSaran(r)">Pakai ini</button>
                    <span v-if="r.sjInfo.tertagih" class="red"> sudah ditagih di {{ r.sjInfo.invoiceNo }}</span>
                  </template>
                  <template v-else>＋ SJ belum ada — akan dibuat otomatis (BM-{{ r.noSJ }})</template>
                </div>
                <ul v-if="r.warn && r.warn.length" class="row-warn">
                  <li class="hdr">Catatan hasil baca awal (abaikan bila sudah Anda perbaiki):</li>
                  <li v-for="(w, k) in r.warn" :key="k">{{ w }}</li>
                </ul>
              </div>
              <button class="btn btn-sm" @click="tambahBaris">＋ Tambah baris</button>
            </div>

            <div class="inv-total" :class="{ ok: selisihTotal !== null && Math.abs(selisihTotal) <= 1, bad: selisihTotal !== null && Math.abs(selisihTotal) > 1 }">
              <div>Total M3: <b>{{ invTotalM3.toFixed(3) }}</b></div>
              <div>Total tagihan (dihitung): <b>{{ fmtRp(invTotal) }}</b></div>
              <div v-if="inv.totalTagihanTerbaca">
                Total di kertas: {{ fmtRp(inv.totalTagihanTerbaca) }}
                <span v-if="Math.abs(selisihTotal) <= 1"> ✔ cocok</span>
                <span v-else> ⚠ selisih {{ fmtRp(Math.abs(selisihTotal)) }}</span>
              </div>
            </div>

            <label class="fl">Jenis barang untuk SJ yang belum ada (opsional)
              <input v-model="inv.jenisDefault" placeholder="mis. BATU SPLIT  → jadi “BATU SPLIT / BB”" />
            </label>
            <label class="chk"><input type="checkbox" v-model="inv.buatRekap" /> Catat juga di <b>Rekap Penjualan</b></label>

            <button class="btn btn-primary btn-save" :disabled="saving" @click="simpanInvoice">
              {{ saving ? "Menyimpan…" : "💾 Simpan Invoice" }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scan-root { position: fixed; inset: 0; z-index: 2000; background: #0b1220; color: #fff; display: flex; flex-direction: column; overflow: hidden; }
.scan-top { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #111a2e; flex-wrap: wrap; }
.scan-x { background: none; border: 0; color: #fff; font-size: 20px; padding: 4px 8px; cursor: pointer; }
.scan-title { font-weight: 700; flex: 1; }
.scan-steps { font-size: 12px; opacity: 0.85; display: flex; gap: 6px; }
.scan-steps .on { color: #ffd166; font-weight: 700; }

.scan-cam { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.cam-box { position: relative; flex: 1; min-height: 240px; background: #000; overflow: hidden; }
.cam-box video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cam-frame { position: absolute; border: 2px solid rgba(255, 255, 255, 0.9); box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55); border-radius: 4px; pointer-events: none; }
.cam-frame .c { position: absolute; width: 22px; height: 22px; border: 4px solid #ffd166; }
.cam-frame .tl { left: -3px; top: -3px; border-right: 0; border-bottom: 0; }
.cam-frame .tr { right: -3px; top: -3px; border-left: 0; border-bottom: 0; }
.cam-frame .bl { left: -3px; bottom: -3px; border-right: 0; border-top: 0; }
.cam-frame .br { right: -3px; bottom: -3px; border-left: 0; border-top: 0; }
.cam-hint { position: absolute; left: 0; right: 0; top: -30px; text-align: center; font-size: 12px; color: #fff; text-shadow: 0 1px 3px #000; }
.cam-q { position: absolute; left: 50%; transform: translateX(-50%); bottom: 10px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: rgba(0, 0, 0, 0.7); white-space: nowrap; max-width: 94%; overflow: hidden; text-overflow: ellipsis; }
.cam-q.ok { background: #159447; }
.cam-q.warn { background: #c47b12; }
.cam-q.bad { background: #c91c22; }
.cam-err { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 24px; font-size: 14px; line-height: 1.5; }
.cam-tips { margin: 0; padding: 8px 14px 4px 30px; font-size: 12px; color: #cbd5e1; background: #111a2e; }
.cam-ai { padding: 4px 14px; font-size: 12px; background: #111a2e; color: #ffd166; }
.cam-errmsg { padding: 6px 14px; background: #7f1d1d; font-size: 13px; }
.cam-actions { display: flex; gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); background: #111a2e; justify-content: center; flex-wrap: wrap; }
.cam-actions .btn { cursor: pointer; }
.shutter { font-size: 16px; padding: 12px 22px; }

.scan-proc { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 20px; text-align: center; }
.proc-img { max-width: 80%; max-height: 38vh; border-radius: 8px; opacity: 0.85; }
.proc-label { font-weight: 600; }
.proc-bar { width: min(420px, 80%); height: 10px; background: #1f2a44; border-radius: 99px; overflow: hidden; }
.proc-bar i { display: block; height: 100%; background: #ffd166; transition: width 0.3s; }
.proc-sub { font-size: 12px; opacity: 0.7; }

.scan-review { flex: 1; overflow: auto; background: #f4f7fb; color: #172033; -webkit-overflow-scrolling: touch; }
.rv-grid { display: grid; grid-template-columns: minmax(240px, 380px) 1fr; gap: 14px; padding: 12px; max-width: 1100px; margin: 0 auto; }
@media (max-width: 800px) { .rv-grid { grid-template-columns: 1fr; } }
.rv-photo { position: sticky; top: 0; align-self: start; }
@media (max-width: 800px) { .rv-photo { position: static; } }
.rv-photo img { width: 100%; border-radius: 8px; border: 1px solid #cbd5e1; max-height: 34vh; object-fit: contain; background: #fff; cursor: zoom-in; }
.rv-photo img.zoom { max-height: none; cursor: zoom-out; }
.rv-photo-note { font-size: 11px; color: #64748b; margin: 4px 0 6px; }
.rv-form { background: #fff; border-radius: 12px; padding: 12px; box-shadow: 0 2px 8px rgba(23, 32, 51, 0.06); display: flex; flex-direction: column; gap: 10px; }
.rv-form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: #475569; }
.rv-form input, .rv-form select { font-size: 16px; padding: 8px 9px; border: 1px solid #cbd5e1; border-radius: 8px; width: 100%; box-sizing: border-box; font-weight: 400; color: #172033; background: #fff; }
.rv-form small { font-weight: 400; color: #64748b; }
.f2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.f3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.rv-m3 { font-size: 14px; background: #eaf1fb; padding: 8px 10px; border-radius: 8px; }
.chk { flex-direction: row !important; align-items: center; gap: 8px !important; font-weight: 500 !important; }
.chk input { width: auto; }
.btn-save { padding: 13px; font-size: 16px; }
.rv-warn { background: #fff4df; border: 1px solid #f0c36d; color: #7a4a00; padding: 8px 10px; border-radius: 8px; font-size: 13px; }
.rv-raw { font-size: 12px; color: #475569; }
.rv-raw pre { white-space: pre-wrap; background: #f1f5f9; padding: 8px; border-radius: 8px; max-height: 200px; overflow: auto; font-size: 11px; }
.rv-warn ul { margin: 4px 0 0 18px; padding: 0; }

.inv-rows { display: flex; flex-direction: column; gap: 8px; }
.inv-rows-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.inv-row { border: 1px solid #dbe3ee; border-radius: 10px; padding: 8px; background: #fafcff; }
.inv-row.bad { border-color: #e2a53a; background: #fffaf0; }
.inv-row-top { display: grid; grid-template-columns: auto 1fr 1fr auto; gap: 6px; align-items: end; }
.inv-row-top .no { font-weight: 700; color: #2459a6; padding-bottom: 10px; }
.inv-row-top .x { background: none; border: 0; font-size: 18px; cursor: pointer; padding-bottom: 6px; }
.inv-row-nums { display: grid; grid-template-columns: 1fr 1fr 1fr 1.6fr; gap: 6px; margin-top: 6px; }
.inv-row-sum { font-size: 13px; margin-top: 6px; }
.sj-chip { margin-top: 6px; font-size: 12px; padding: 5px 8px; border-radius: 8px; background: #eef2f7; }
.sj-chip.ADA { background: #e9f8ef; color: #0f6b34; }
.sj-chip.SARAN { background: #fff4df; color: #7a4a00; }
.sj-chip.BARU { background: #eaf1fb; color: #173f7a; }
.sj-chip .red { color: #c91c22; font-weight: 700; }
.row-warn { margin: 6px 0 0 16px; padding: 0; font-size: 12px; color: #a35a00; }
.row-warn .hdr { list-style: none; margin-left: -16px; font-weight: 600; }
.inv-total { padding: 10px; border-radius: 10px; background: #eef2f7; font-size: 14px; line-height: 1.6; }
.inv-total.ok { background: #e9f8ef; }
.inv-total.bad { background: #fdebec; }
</style>
