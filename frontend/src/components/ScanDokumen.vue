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
import DimInput from "./DimInput.vue";
import { fmtM3 } from "../utils/format.js";
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
const step = ref("capture"); // capture | putar | daftar | review

// --- antrian multi-foto ---
// Pengguna memilih dulu berapa foto yang mau diambil. Tiap foto langsung dibaca di
// latar belakang (paralel), jadi tidak perlu menunggu satu per satu.
const target = ref(1);          // jumlah foto yang mau diambil di putaran ini
const diambil = ref(0);         // sudah berapa foto di putaran ini
const jobs = ref([]);           // {id,status,label,pct,photoUrl,hasil,snapshot,catatan,error}
const curJob = ref(null);       // job yang sedang dibuka di layar cek
const pending = ref([]);        // canvas dari file yang menunggu diputar
const praUrl = ref("");
const praPotret = ref(false);
const flash = ref(false);
const MAKS_FOTO = 10;
const canvasMap = new Map();    // id job -> canvas asli (untuk OCR cadangan), dibuang setelah selesai
let jobSeq = 0;
const customers = ref([]);
const config = reactive({ ai: false, model: null });
const pakaiAi = ref(localStorage.getItem("bms.scan.ai") !== "0");

const photoUrl = ref("");
const rawText = ref("");
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
const errSave = ref("");
const cekSjBusy = ref(false);
let skipWatch = false;

const customerOptions = computed(() =>
  customers.value.map((c) => ({ value: c.id, label: `${c.kode} — ${c.nama}` }))
);

const master = ref([]);
// Opsi dropdown jenis barang, format sama dengan hasil rapikan: "BATU SPLIT / BB"
const jenisOptions = computed(() => {
  const seen = new Set();
  const out = [];
  for (const x of master.value) {
    if (x.aktif === false) continue;
    const kode = String(x.kode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!kode || !x.nama || seen.has(kode)) continue;
    seen.add(kode);
    const v = `${P.spasiNama(String(x.nama).toUpperCase().replace(/\s+/g, " ").trim())} / ${kode}`;
    out.push({ value: v, label: v });
  }
  const cur = sj.jenisBarang;
  if (out.length && cur && !out.some((o) => o.value === cur)) {
    out.unshift({ value: cur, label: `${cur} (hasil baca — belum ada di master)` });
  }
  return out;
});

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
  const outW = Math.min(3200, Math.round(sw));
  const outH = Math.round((outW * sh) / sw);
  const c = document.createElement("canvas");
  c.width = outW; c.height = outH;
  c.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);
  flash.value = true;
  setTimeout(() => (flash.value = false), 150);
  antrikan(c);
  // kamera tetap menyala untuk foto berikutnya; kalau jumlah foto sudah terpenuhi -> lihat hasil
  if (diambil.value >= target.value) selesaiMengambil();
}

function muatFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = Math.min(3200, img.naturalWidth);
      const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Pilih banyak foto sekaligus dari galeri -> masing-masing bisa diputar dulu
async function dariFile(e) {
  const files = Array.from(e.target.files || []).slice(0, MAKS_FOTO);
  e.target.value = "";
  if (!files.length) return;
  errMsg.value = "";
  const cs = await Promise.all(files.map(muatFile));
  const ok = cs.filter(Boolean);
  if (ok.length !== cs.length) errMsg.value = "Ada foto yang tidak bisa dibuka.";
  if (!ok.length) return;
  stopCamera();
  target.value = Math.min(MAKS_FOTO, Math.max(target.value, diambil.value + pending.value.length + ok.length));
  pending.value.push(...ok);
  tampilPutar();
}

// ------------------------------------------------------------------ putar foto (sebelum diproses)
function putarCanvas(c, deg) {
  const swap = deg % 180 !== 0;
  const o = document.createElement("canvas");
  o.width = swap ? c.height : c.width;
  o.height = swap ? c.width : c.height;
  const x = o.getContext("2d");
  x.translate(o.width / 2, o.height / 2);
  x.rotate((deg * Math.PI) / 180);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return o;
}
function previewUrl(c) {
  const w = Math.min(1100, c.width), h = Math.round((w * c.height) / c.width);
  const t = document.createElement("canvas");
  t.width = w; t.height = h;
  t.getContext("2d").drawImage(c, 0, 0, w, h);
  return t.toDataURL("image/jpeg", 0.75);
}
function tampilPutar() {
  const c = pending.value[0];
  if (!c) return selesaiPutar();
  praUrl.value = previewUrl(c);
  praPotret.value = c.height > c.width;
  step.value = "putar";
}
function putarFoto(deg) {
  pending.value[0] = putarCanvas(pending.value[0], deg);
  tampilPutar();
}
function pakaiFotoPutar() {
  const c = pending.value.shift();
  if (c) antrikan(c);
  tampilPutar();
}
function lewatiFotoPutar() {
  pending.value.shift();
  tampilPutar();
}
function selesaiPutar() {
  if (jobs.value.length && diambil.value >= target.value) return selesaiMengambil();
  step.value = "capture";
  startCamera();
}

function selesaiMengambil() {
  stopCamera();
  step.value = jobs.value.length ? "daftar" : "capture";
  if (!jobs.value.length) startCamera();
}
function tambahFotoLagi() {
  target.value = 1;
  diambil.value = 0;
  errMsg.value = "";
  step.value = "capture";
  startCamera();
}

// ------------------------------------------------------------------ antrian & proses
function bikinSem(n) {
  let aktif = 0;
  const q = [];
  const next = () => {
    if (aktif < n && q.length) {
      aktif++;
      const { fn, res, rej } = q.shift();
      fn().then(res, rej).finally(() => { aktif--; next(); });
    }
  };
  return { run: (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); }) };
}
const semAi = bikinSem(3);   // sampai 3 foto dikirim ke AI bersamaan
const semOcr = bikinSem(1);  // OCR bawaan berat -> satu per satu

// Thumbnail kecil khusus untuk daftar hasil (ringan di layar); foto penuh tetap dipakai AI & layar cek
function bikinThumb(c) {
  const w = 220, h = Math.max(1, Math.round((w * c.height) / c.width));
  const t = document.createElement("canvas");
  t.width = w; t.height = h;
  t.getContext("2d").drawImage(c, 0, 0, w, h);
  return t.toDataURL("image/jpeg", 0.7);
}

function antrikan(canvas) {
  // Foto untuk AI & layar cek: kualitas SAMA seperti sebelumnya (2200px, JPEG 0.9) supaya
  // titik-titik cetakan dot-matrix tetap terbaca jelas. Kecepatan dicari dari proses paralel,
  // bukan dari menurunkan kualitas foto.
  const pw = Math.min(2200, canvas.width), ph = Math.round((pw * canvas.height) / canvas.width);
  const pc = document.createElement("canvas");
  pc.width = pw; pc.height = ph;
  pc.getContext("2d").drawImage(canvas, 0, 0, pw, ph);
  jobs.value.push({
    id: ++jobSeq, status: "antri", label: "Menunggu giliran…", pct: 0, dasar: 0,
    photoUrl: pc.toDataURL("image/jpeg", 0.9),
    thumb: bikinThumb(pc),
    hasil: null, rawText: "", snapshot: "", catatan: "", error: "",
  });
  const job = jobs.value[jobs.value.length - 1];
  canvasMap.set(job.id, canvas);
  diambil.value++;
  prosesJob(job);
}

async function prosesJob(job) {
  job.error = "";
  job.catatan = "";
  job.status = "antri";
  job.pct = 0;
  try {
    let hasil = null;
    if (config.ai && pakaiAi.value) {
      await semAi.run(async () => {
        job.status = "baca"; job.label = "AI membaca dokumen…"; job.pct = 40;
        try {
          const j = await api.post("/scan/ai-extract", { tipe: props.tipe, image: job.photoUrl });
          hasil = P.fromAi(props.tipe, j);
        } catch (e) {
          // Tanpa popup: cukup dicatat di kartu dokumen, lalu otomatis pakai pembaca bawaan
          job.catatan = `AI belum berhasil (${e.message}). Dibaca dengan pembaca bawaan — lebih lambat, cek hasilnya lebih teliti.`;
        }
      });
    }
    if (!hasil) {
      const canvas = canvasMap.get(job.id);
      if (!canvas) throw new Error("Foto sudah tidak ada di memori, ambil ulang.");
      hasil = await semOcr.run(() => bacaOcr(canvas, job));
    }
    job.hasil = hasil;
    job.rawText = hasil.rawText || "";
    job.status = "siap";
    job.pct = 100;
    canvasMap.delete(job.id);
  } catch (e) {
    job.status = "error";
    job.error = e.message || "Gagal membaca dokumen";
  }
}

// Beberapa percobaan pemrosesan foto (kanal warna & ukuran berbeda); dipilih hasil yang paling lengkap.
// Cetakan dot-matrix = titik-titik renggang. Varian 2-4 menghaluskan + menebalkan goresan supaya huruf utuh.
const VARIAN = [
  { W: 2400, channel: "r", dilate: 0, blur: false },
  { W: 3000, channel: "r", dilate: 1, blur: true },
  { W: 3200, channel: "luma", dilate: 1, blur: true },
  { W: 3600, channel: "r", dilate: 1, blur: false, C: 10 },
];

// Worker Tesseract dipakai ulang antar dokumen (tidak dibuat ulang tiap foto)
let ocrWorker = null;
let ocrJob = null;
async function getWorker() {
  if (ocrWorker) return ocrWorker;
  await loadScript(TESS_JS);
  const w = await window.Tesseract.createWorker("eng", 1, {
    langPath: TESS_LANG,
    logger: (m) => {
      const j = ocrJob;
      if (!j) return;
      if (m.status === "recognizing text") j.pct = j.dasar + Math.round(m.progress * 20);
      else if (m.status && m.status.indexOf("loading") === 0) { j.label = "Memuat data bahasa…"; j.pct = 8; }
    },
  });
  await w.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
  ocrWorker = w;
  return w;
}

async function bacaOcr(canvas, job) {
  ocrJob = job;
  job.status = "baca";
  job.label = "Menyiapkan pembaca teks (pertama kali ±3 MB)…";
  job.pct = 3;
  try {
    const worker = await getWorker();
    let best = null, bestScore = -1;
    for (let k = 0; k < VARIAN.length; k++) {
      const { W, channel, dilate, blur, C } = VARIAN[k];
      job.dasar = 10 + k * 22;
      const H = Math.round((W * canvas.height) / canvas.width);
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, 0, 0, W, H);
      job.label = `Membersihkan foto (percobaan ${k + 1}/${VARIAN.length})…`;
      job.pct = 8 + k * 22;
      await new Promise((r) => setTimeout(r, 30));
      const id = ctx.getImageData(0, 0, W, H);
      const bin = P.binarize(id, { channel, dilate, blur, C });
      for (let i = 0, p = 0; i < bin.length; i++, p += 4) {
        id.data[p] = id.data[p + 1] = id.data[p + 2] = bin[i];
        id.data[p + 3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      job.label = `Membaca teks (percobaan ${k + 1}/${VARIAN.length})…`;
      const { data } = await worker.recognize(c);
      const hasil = isSJ.value ? P.parseSuratJalan(data.text) : P.parseInvoice(data.text);
      const sc = P.scoreResult(props.tipe, hasil);
      if (sc > bestScore) { best = hasil; bestScore = sc; best.rawText = data.text; }
      // sudah lengkap & cocok -> tidak perlu percobaan lagi
      if (isSJ.value ? sc >= 10 : hasil.totalCocok) break;
    }
    return best;
  } finally {
    ocrJob = null;
  }
}

// ------------------------------------------------------------------ daftar & buka hasil
const jumlahSiap = computed(() => jobs.value.filter((j) => j.status === "siap").length);
const jumlahBaca = computed(() => jobs.value.filter((j) => j.status === "antri" || j.status === "baca").length);
const jumlahBelumSimpan = computed(() => jobs.value.filter((j) => j.status !== "tersimpan").length);
const STATUS_TEKS = { antri: "Menunggu", baca: "Dibaca…", siap: "Siap dicek", error: "Gagal dibaca", tersimpan: "Tersimpan ✔" };

function ringkasJob(j) {
  if (!j.hasil) return "";
  const h = j.hasil;
  if (isSJ.value) return (h.no || "(nomor tidak terbaca)") + (h.tujuan ? " • " + h.tujuan : "");
  return (h.no || "(nomor tidak terbaca)") + " • " + (h.rows ? h.rows.length : 0) + " baris" + (h.namaCustomer ? " • " + h.namaCustomer : "");
}

function bukaJob(job) {
  curJob.value = job;
  rawText.value = job.rawText || "";
  photoUrl.value = job.photoUrl;
  zoomFoto.value = false;
  errSave.value = "";
  const form = isSJ.value ? sj : inv;
  if (job.snapshot) {
    const snap = JSON.parse(job.snapshot);
    if (!isSJ.value) skipWatch = inv.customerId !== snap.customerId;
    Object.assign(form, snap);
  } else {
    terapkanHasil(job.hasil);
  }
  step.value = "review";
  if (!isSJ.value && inv.customerId) cekSjDiSistem();
}

// kembali ke daftar tanpa kehilangan isian yang sudah diedit
function kembaliDaftar() {
  if (curJob.value) curJob.value.snapshot = JSON.stringify(isSJ.value ? sj : inv);
  curJob.value = null;
  step.value = "daftar";
}

function hapusJob(job) {
  jobs.value = jobs.value.filter((j) => j.id !== job.id);
  canvasMap.delete(job.id);
  if (!jobs.value.length) tambahFotoLagi();
}

function fotoUlang() {
  if (curJob.value) hapusJobTanpaKamera(curJob.value);
  curJob.value = null;
  tambahFotoLagi();
}
function hapusJobTanpaKamera(job) {
  jobs.value = jobs.value.filter((j) => j.id !== job.id);
  canvasMap.delete(job.id);
}

function isoDateOnly(v) { return v ? String(v).slice(0, 10) : ""; }

function terapkanHasil(h) {
  const def = auth.user?.divisi && DIVISI.includes(auth.user.divisi) ? auth.user.divisi : "Supplier";
  if (isSJ.value) {
    errSave.value = "";
    Object.assign(sj, {
      no: h.no, tanggal: h.tanggal || new Date().toISOString().slice(0, 10), jam: h.jam, divisi: def,
      penerima: h.penerima || h.dari, tujuan: h.tujuan, jenisBarang: h.jenisBarang, noPolisi: h.noPolisi,
      panjang: h.panjang, lebar: h.lebar, tinggi: h.tinggi, timpa: false, warnings: h.warnings.slice(),
    });
    const m = P.matchCustomer(customers.value, { nama: h.dari || h.penerima });
    sj.customerId = m ? m.id : "";
    sj.match = m;
    if (!m) sj.warnings.push("Customer belum cocok otomatis — boleh dipilih nanti, surat jalan tetap bisa disimpan.");
  } else {
    errSave.value = "";
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

// Admin mengetik/mengubah jenis barang -> rapikan spasi, cocokkan master, isi kode otomatis
function rapikanJenis() {
  const rj = P.resolveJenis(sj.jenisBarang);
  if (!rj.jenis) return;
  sj.jenisBarang = rj.jenis;
  sj.warnings = sj.warnings.filter((w) => !/^Jenis barang/.test(w));
  if (rj.warn) sj.warnings.push(rj.warn);
}
function rapikanKodeBaris(r) {
  const kd = P.fixKode(r.kode);
  if (kd) r.kode = kd;
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
  errSave.value = "";
  // Hanya nomor yang wajib. Customer, nopol, ukuran, tujuan, dll boleh kosong (bisa dilengkapi nanti).
  if (!sj.no || !String(sj.no).trim()) {
    errSave.value = "Nomor surat jalan wajib diisi.";
    return toast(errSave.value);
  }
  rapikanJenis();
  saving.value = true;
  try {
    const res = await api.post("/scan/surat-jalan", {
      no: String(sj.no).trim(), tanggal: sj.tanggal || undefined, jam: sj.jam, divisi: sj.divisi || "Supplier", customerId: sj.customerId || undefined,
      penerima: sj.penerima, tujuan: sj.tujuan, jenisBarang: sj.jenisBarang, noPolisi: sj.noPolisi,
      panjang: Number(sj.panjang) || 0, lebar: Number(sj.lebar) || 0, tinggi: Number(sj.tinggi) || 0, timpa: sj.timpa,
    });
    toast(res.diperbarui ? `Surat jalan ${sj.no} diperbarui` : `Surat jalan ${sj.no} tersimpan`);
    emit("saved");
    setelahSimpan();
  } catch (e) {
    errSave.value = e.message || "Gagal menyimpan surat jalan";
    if (/sudah ada/i.test(errSave.value)) sj.timpa = true;
    toast(errSave.value);
  } finally {
    saving.value = false;
  }
}

function gagalInvoice(msg) {
  errSave.value = msg;
  toast(msg);
}
async function simpanInvoice() {
  errSave.value = "";
  if (!inv.no || !inv.tanggal || !inv.divisi) return gagalInvoice("Nomor, tanggal, dan divisi invoice wajib diisi");
  if (!inv.customerId) return gagalInvoice("Pilih customer dulu (invoice harus punya customer)");
  if (!inv.rows.length) return gagalInvoice("Belum ada baris invoice");
  for (const r of inv.rows) {
    if (!r.noSJ || !(rowM3(r) > 0) || !(Number(r.harga) > 0)) {
      return gagalInvoice(`Baris SJ ${r.noSJ || "(kosong)"}: nomor SJ, ukuran P-L-T, dan harga wajib terisi (dipakai untuk menghitung tagihan)`);
    }
    if (r.sjInfo?.tertagih && r.suratJalanId) return gagalInvoice(`SJ ${r.sjInfo.no} sudah tertagih di invoice ${r.sjInfo.invoiceNo}`);
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
        jenisBarang: P.jenisDariKode(r.kode, inv.jenisDefault) || undefined,
        alamat: r.alamat, panjang: r.panjang, lebar: r.lebar, tinggi: r.tinggi, harga: r.harga,
      })),
    });
    toast(
      `Invoice ${res.no} tersimpan (${res.baris} baris, ${fmtRp(res.total)})` +
        (res.sjBaru ? ` • ${res.sjBaru} SJ baru` : "") +
        (inv.buatRekap ? ` • rekap +${res.rekapBaru}` : "")
    );
    emit("saved");
    setelahSimpan();
  } catch (e) {
    errSave.value = e.message || "Gagal menyimpan invoice";
    toast(errSave.value);
  } finally {
    saving.value = false;
  }
}

function setelahSimpan() {
  if (curJob.value) { curJob.value.status = "tersimpan"; curJob.value.snapshot = ""; }
  curJob.value = null;
  if (jobs.value.some((j) => j.status !== "tersimpan")) {
    step.value = "daftar";
  } else {
    jobs.value = [];
    tambahFotoLagi();
  }
}

function tutup() {
  if (jumlahBelumSimpan.value && !confirm(`Masih ada ${jumlahBelumSimpan.value} dokumen yang belum disimpan. Tutup dan buang?`)) return;
  stopCamera();
  emit("close");
}
function simpanPilihanAi() { localStorage.setItem("bms.scan.ai", pakaiAi.value ? "1" : "0"); }

onMounted(async () => {
  document.body.style.overflow = "hidden";
  try { customers.value = await api.get("/customers"); } catch (e) { toast("Gagal memuat customer: " + e.message); }
  try { Object.assign(config, await api.get("/scan/config")); } catch { /* AI tidak tersedia */ }
  try {
    const m = await api.get("/stock-master");
    master.value = m;
    P.setMaster(m);
  } catch { /* tanpa master: jenis barang jadi kolom ketik biasa */ }
  await nextTick();
  updateFrameStyle();
  window.addEventListener("resize", updateFrameStyle);
  startCamera();
});
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  window.removeEventListener("resize", updateFrameStyle);
  stopCamera();
  if (ocrWorker) { ocrWorker.terminate(); ocrWorker = null; }
});
</script>

<template>
  <div class="scan-root">
    <!-- ============ BAR ATAS ============ -->
    <div class="scan-top">
      <button class="scan-x" @click="tutup" aria-label="Tutup">✕</button>
      <div class="scan-title">📷 {{ judul }}</div>
      <div class="scan-steps">
        <span :class="{ on: step === 'capture' || step === 'putar' }">1 Foto</span>›
        <span :class="{ on: step === 'daftar' }">2 Hasil<template v-if="jumlahBaca"> ({{ jumlahBaca }}…)</template></span>›
        <span :class="{ on: step === 'review' }">3 Cek &amp; Simpan</span>
      </div>
    </div>

    <!-- ============ 1. KAMERA ============ -->
    <div v-show="step === 'capture'" class="scan-cam">
      <div class="cam-count">
        <span>Jumlah foto:</span>
        <button class="btn btn-sm" :disabled="target <= diambil + 1" @click="target--">−</button>
        <b>{{ target }}</b>
        <button class="btn btn-sm" :disabled="target >= MAKS_FOTO" @click="target++">＋</button>
        <span class="cam-count-n">Foto ke {{ Math.min(diambil + 1, target) }} dari {{ target }}</span>
        <button v-if="jobs.length" class="btn btn-sm" @click="selesaiMengambil">Lihat hasil ({{ jobs.length }})</button>
      </div>
      <div ref="boxEl" class="cam-box">
        <video ref="videoEl" playsinline muted autoplay @loadedmetadata="updateFrameStyle"></video>
        <div v-if="camReady" class="cam-frame" :style="frameStyle">
          <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
          <div class="cam-hint">{{ isSJ ? "Seluruh SURAT JALAN di dalam bingkai" : "Seluruh INVOICE (judul sampai total) di dalam bingkai" }}</div>
        </div>
        <div v-if="camReady" class="cam-q" :class="kualitas.level">{{ kualitas.text }}</div>
        <div v-if="camError" class="cam-err">{{ camError }}</div>
        <div v-if="flash" class="cam-flash"></div>
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
          🖼 Pilih Foto (bisa banyak)
          <input type="file" accept="image/*" multiple hidden @change="dariFile" />
        </label>
        <button v-if="camReady" class="btn" @click="switchCamera">🔄</button>
      </div>
    </div>

    <!-- ============ 1b. PUTAR FOTO (untuk foto yang diupload) ============ -->
    <div v-if="step === 'putar'" class="scan-putar">
      <div class="pt-info">Foto {{ diambil + 1 }} dari {{ target }} — putar sampai tulisan terbaca tegak.</div>
      <div v-if="praPotret" class="pt-tip">Foto ini berdiri (potret). Kertas biasanya mendatar, jadi kemungkinan perlu diputar 90°.</div>
      <div class="pt-img"><img :src="praUrl" alt="pratinjau" /></div>
      <div class="pt-act">
        <button class="btn" @click="putarFoto(-90)">↺ Putar kiri</button>
        <button class="btn" @click="putarFoto(90)">↻ Putar kanan</button>
        <button class="btn" @click="putarFoto(180)">⇅ 180°</button>
      </div>
      <div class="pt-act">
        <button class="btn" @click="lewatiFotoPutar">Lewati foto ini</button>
        <button class="btn btn-primary" @click="pakaiFotoPutar">✔ Pakai foto ini ({{ pending.length }} tersisa)</button>
      </div>
    </div>

    <!-- ============ 2. DAFTAR HASIL (dibaca di latar belakang) ============ -->
    <div v-if="step === 'daftar'" class="scan-list">
      <div class="ls-head">
        <b>{{ jobs.length }} dokumen</b>
        <span v-if="jumlahBaca"> — {{ jumlahBaca }} masih dibaca, boleh ditinggal</span>
        <span v-else> — semua sudah dibaca</span>
      </div>
      <div v-for="(j, i) in jobs" :key="j.id" class="ls-item" :class="j.status">
        <img :src="j.thumb" alt="" />
        <div class="ls-info">
          <div class="ls-t">Dokumen {{ i + 1 }} <span class="ls-badge" :class="j.status">{{ STATUS_TEKS[j.status] }}</span></div>
          <div v-if="j.status === 'antri' || j.status === 'baca'" class="ls-prog">
            <div class="proc-bar"><i :style="{ width: j.pct + '%' }"></i></div>
            <small>{{ j.label }}</small>
          </div>
          <div v-else-if="j.hasil" class="ls-sub">{{ ringkasJob(j) }}</div>
          <div v-if="j.catatan" class="ls-note">{{ j.catatan }}</div>
          <div v-if="j.error" class="ls-err">{{ j.error }}</div>
        </div>
        <div class="ls-act">
          <button v-if="j.status === 'siap'" class="btn btn-primary btn-sm" @click="bukaJob(j)">Cek &amp; simpan</button>
          <button v-if="j.status === 'error'" class="btn btn-sm" @click="prosesJob(j)">Coba lagi</button>
          <button v-if="j.status !== 'tersimpan'" class="btn btn-sm" @click="hapusJob(j)">🗑</button>
        </div>
      </div>
      <div class="ls-foot">
        <button class="btn" @click="tambahFotoLagi">＋ Foto lagi</button>
      </div>
    </div>

    <!-- ============ 3. REVIEW ============ -->
    <div v-if="step === 'review'" class="scan-review">
      <div class="rv-grid">
        <div class="rv-photo">
          <img :src="photoUrl" alt="foto" :class="{ zoom: zoomFoto }" @click="zoomFoto = !zoomFoto" />
          <div class="rv-photo-note">Ketuk foto untuk memperbesar — cocokkan dengan isian di samping.</div>
          <button class="btn btn-sm" @click="kembaliDaftar">← Kembali ke daftar</button>
          <button class="btn btn-sm" @click="fotoUlang">↺ Foto ulang</button>
        </div>

        <div class="rv-form">
          <details v-if="rawText" class="rv-raw">
            <summary>Teks mentah hasil baca (untuk diagnosa)</summary>
            <pre>{{ rawText }}</pre>
          </details>
          <div v-if="errSave" class="rv-err">⛔ {{ errSave }}</div>
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
            <label class="fl">Customer (boleh dikosongkan)
              <SearchableSelect v-model="sj.customerId" :options="customerOptions" placeholder="Pilih customer…" />
              <small v-if="sj.match">Terbaca “{{ sj.penerima }}” → cocok {{ Math.round(sj.match.score * 100) }}%</small>
            </label>
            <label class="fl">Penerima<input v-model="sj.penerima" /></label>
            <label class="fl">Tujuan<input v-model="sj.tujuan" /></label>
            <label class="fl">Jenis barang
              <SearchableSelect v-if="jenisOptions.length" v-model="sj.jenisBarang" :options="jenisOptions" placeholder="Pilih jenis barang…" />
              <input v-else v-model="sj.jenisBarang" placeholder="mis. BATU SPLIT / BB" @change="rapikanJenis" />
              <small>Pilih dari master barang. Boleh dikosongkan.</small>
            </label>
            <label class="fl">No. Polisi (boleh kosong)<input v-model="sj.noPolisi" placeholder="B 1234 XYZ" /></label>
            <div class="f3">
              <label>Panjang<DimInput v-model="sj.panjang" /></label>
              <label>Lebar<DimInput v-model="sj.lebar" /></label>
              <label>Tinggi<DimInput v-model="sj.tinggi" /></label>
            </div>
            <div class="rv-m3">M3 = P × L × T = <b>{{ fmtM3(m3Sj) }}</b></div>
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
                  <label class="kd">Kode<input v-model="r.kode" maxlength="3" placeholder="BB" @change="rapikanKodeBaris(r)" /></label>
                  <button class="x" @click="hapusBaris(i)" title="Hapus baris">🗑</button>
                </div>
                <div class="inv-row-nums">
                  <label>P<DimInput v-model="r.panjang" /></label>
                  <label>L<DimInput v-model="r.lebar" /></label>
                  <label>T<DimInput v-model="r.tinggi" /></label>
                  <label>Harga/m³<input type="number" step="500" inputmode="numeric" v-model.number="r.harga" /></label>
                </div>
                <div class="inv-row-sum">
                  M3 <b>{{ fmtM3(rowM3(r)) }}</b> × {{ fmtRp(r.harga) }} = <b>{{ fmtRp(rowJumlah(r)) }}</b>
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
                  <template v-else>＋ SJ belum ada — akan dibuat otomatis (BM-{{ r.noSJ }}<template v-if="r.jenisBarang">, {{ r.jenisBarang }}</template>)</template>
                </div>
                <ul v-if="r.warn && r.warn.length" class="row-warn">
                  <li class="hdr">Catatan hasil baca awal (abaikan bila sudah Anda perbaiki):</li>
                  <li v-for="(w, k) in r.warn" :key="k">{{ w }}</li>
                </ul>
              </div>
              <button class="btn btn-sm" @click="tambahBaris">＋ Tambah baris</button>
            </div>

            <div class="inv-total" :class="{ ok: selisihTotal !== null && Math.abs(selisihTotal) <= 1, bad: selisihTotal !== null && Math.abs(selisihTotal) > 1 }">
              <div>Total M3: <b>{{ fmtM3(invTotalM3) }}</b></div>
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
.proc-bar { width: min(420px, 100%); height: 10px; background: #1f2a44; border-radius: 99px; overflow: hidden; }
.proc-bar i { display: block; height: 100%; background: #ffd166; transition: width 0.3s; }
.proc-sub { font-size: 12px; opacity: 0.7; }

.cam-count { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; background: #111a2e; font-size: 13px; }
.cam-count b { min-width: 20px; text-align: center; font-size: 16px; color: #ffd166; }
.cam-count-n { margin-left: auto; opacity: 0.85; }
.cam-flash { position: absolute; inset: 0; background: #fff; opacity: 0.7; pointer-events: none; }

.scan-putar { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px; min-height: 0; }
.pt-info { font-weight: 600; font-size: 14px; }
.pt-tip { font-size: 12px; background: #fff4df; color: #7a4a00; padding: 6px 10px; border-radius: 8px; max-width: 520px; }
.pt-img { flex: 1; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; }
.pt-img img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; background: #000; }
.pt-act { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

.scan-list { flex: 1; overflow: auto; background: #f4f7fb; color: #172033; padding: 12px; display: flex; flex-direction: column; gap: 10px; -webkit-overflow-scrolling: touch; }
.ls-head { font-size: 14px; max-width: 760px; width: 100%; margin: 0 auto; }
.ls-item { display: flex; gap: 10px; align-items: center; background: #fff; border-radius: 12px; padding: 8px; box-shadow: 0 2px 8px rgba(23, 32, 51, 0.06); max-width: 760px; width: 100%; margin: 0 auto; box-sizing: border-box; }
.ls-item.tersimpan { opacity: 0.55; }
.ls-item img { width: 84px; height: 60px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1; flex: none; }
.ls-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ls-t { font-weight: 700; font-size: 14px; }
.ls-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; margin-left: 6px; background: #eef2f7; color: #475569; }
.ls-badge.baca { background: #fff4df; color: #7a4a00; }
.ls-badge.siap, .ls-badge.tersimpan { background: #e9f8ef; color: #0f6b34; }
.ls-badge.error { background: #fdebec; color: #8a1118; }
.ls-sub { font-size: 12px; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ls-prog small { font-size: 11px; color: #64748b; }
.ls-prog .proc-bar { background: #e2e8f0; height: 6px; }
.ls-note { font-size: 11px; color: #a35a00; }
.ls-err { font-size: 12px; color: #c91c22; font-weight: 600; }
.ls-act { display: flex; flex-direction: column; gap: 6px; flex: none; }
.ls-foot { max-width: 760px; width: 100%; margin: 0 auto; }

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
.inv-row-top { display: grid; grid-template-columns: auto 1fr 1fr 64px auto; gap: 6px; align-items: end; }
.rv-err { background: #fdebec; border: 1px solid #e49aa0; color: #8a1118; padding: 8px 10px; border-radius: 8px; font-size: 13px; font-weight: 600; }
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
