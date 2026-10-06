/*
 * scan-parser.js  --  Pembaca hasil scan Surat Jalan & Invoice BMS
 *
 * ES5 murni (tanpa ?. ?? => spread) supaya jalan di halaman /simple (HTML polos),
 * di aplikasi Vue (salinan ESM: frontend/src/utils/scanParser.js), dan di Node.
 *
 *   binarize / quality  : foto -> hitam-putih adaptif; ukur terang & fokus (panduan kamera)
 *   parseSuratJalan     : teks OCR -> data surat jalan
 *   parseInvoice        : teks OCR -> data invoice + baris tabel
 *   fromAi              : hasil JSON Gemini -> bentuk yang sama
 *   reconcileHarga      : koreksi digit harga yang salah baca (cocokkan dgn total di kertas)
 *   matchCustomer       : cocokkan nama/kode hasil scan ke master customer
 *   buatPertanyaan      : kalau format kertas tidak biasa / tulisan meragukan -> daftar
 *                         pertanyaan pilihan ganda untuk admin (jawaban langsung mengisi form)
 * Semua angka dihitung ulang (M3 = P x L x T, Jumlah = M3 x Harga); angka asli
 * di kertas disimpan hanya sebagai pembanding.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ScanParser = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function r3(n) { return Math.round(n * 1000) / 1000; }
  function num(s) {
    if (s === null || s === undefined) return NaN;
    return parseFloat(String(s).replace(",", "."));
  }
  function digitsOnly(s) { return String(s || "").replace(/\D/g, ""); }
  function hitungM3(p, l, t) { return r3(Number(p || 0) * Number(l || 0) * Number(t || 0)); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  function toIsoDate(d, m, y) {
    d = parseInt(d, 10); m = parseInt(m, 10); y = parseInt(y, 10);
    if (y < 100) y += 2000;
    if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100)) return "";
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  var DATE_RE = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)/;
  function findDate(text) {
    var m = DATE_RE.exec(text || "");
    return m ? toIsoDate(m[1], m[2], m[3]) : "";
  }

  function norm(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  // Kemiripan teks (bigram Dice 0..1) -- OCR sering salah 1-2 huruf
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    var grams = {}, i, hit = 0;
    for (i = 0; i < a.length - 1; i++) { var g = a.substr(i, 2); grams[g] = (grams[g] || 0) + 1; }
    for (i = 0; i < b.length - 1; i++) {
      var h = b.substr(i, 2);
      if (grams[h] > 0) { grams[h]--; hit++; }
    }
    return (2 * hit) / (a.length - 1 + b.length - 1);
  }

  function cleanField(s) {
    s = String(s || "");
    s = s.split(/\s{3,}/)[0];
    s = s.replace(/\s+(Nomor|Nomer|Tanggal|Halaman|No\.?\s*Invoice)\b.*$/i, "");
    s = s.replace(/^[^A-Za-z0-9]+/, "");
    s = s.replace(/[|_~=\\]+/g, " ").replace(/\s+/g, " ").trim();
    s = s.replace(/[\s'"`+,;:*\-]+$/, "");
    return s;
  }
  function cleanLines(text) {
    var out = [], lines = String(text || "").split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) if (lines[i].replace(/\s/g, "")) out.push(lines[i]);
    return out;
  }


  // ------------------------------------------------------- master jenis barang
  // MASTER = [{kode, nama}] dari /api/stock-master (diisi lewat setMaster).
  // Dipakai untuk: (1) menambah spasi yang hilang, (2) membetulkan nama yang salah
  // baca sedikit (FASIR BANGKA -> PASIR BANGKA), (3) menentukan kode barang.
  var MASTER = [], BY_KODE = {};
  var VOCAB = {};
  var KATA = ["PASIR", "BATU", "BANGKA", "SPLIT", "PUTIH", "URUK", "BELAH", "CUCI", "CELUP", "COR", "HITAM",
    "LAMPUNG", "SUPER", "ABU", "EXTRA", "BETON", "AYAK", "BELITUNG", "CILEGON", "RANGKAS", "CIWANDAN",
    "JAMBI", "KALIMANTAN", "MALIMPING", "TAYAN", "PAP"];
  (function () { for (var i = 0; i < KATA.length; i++) VOCAB[KATA[i]] = 1; })();

  function setMaster(list) {
    var i, j, w;
    MASTER = []; BY_KODE = {};
    VOCAB = {};
    for (i = 0; i < KATA.length; i++) VOCAB[KATA[i]] = 1;
    for (i = 0; i < (list || []).length; i++) {
      var it = list[i];
      if (!it || !it.kode || !it.nama || it.aktif === false) continue;
      var kode = String(it.kode).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!kode) continue;
      var rec = { kode: kode, nama: String(it.nama).toUpperCase().replace(/\s+/g, " ").trim() };
      MASTER.push(rec); BY_KODE[kode] = rec;
      // kata dari nama yang MEMANG berspasi di master ikut jadi kamus pemisah spasi
      if (rec.nama.indexOf(" ") > 0) {
        var ws = rec.nama.split(/[^A-Z0-9]+/);
        for (j = 0; j < ws.length; j++) { w = ws[j]; if (w.length >= 3) VOCAB[w] = 1; }
      }
    }
  }

  // "PASIRBANGKA" -> "PASIR BANGKA" (hanya kalau seluruh kata bisa dipecah jadi kata yang dikenal)
  function pecahKata(tok) {
    var n = tok.length, best = [], from = [], i, j;
    if (n < 6 || !/^[A-Z]+$/.test(tok)) return tok;
    for (i = 0; i <= n; i++) { best[i] = 1e9; from[i] = -1; }
    best[0] = 0;
    for (i = 1; i <= n; i++) {
      for (j = 0; j < i; j++) {
        if (best[j] < 1e9 && i - j >= 3 && VOCAB[tok.slice(j, i)] && best[j] + 1 < best[i]) { best[i] = best[j] + 1; from[i] = j; }
      }
    }
    if (best[n] >= 1e9 || best[n] < 2) return tok;
    var parts = [], p = n;
    while (p > 0) { parts.unshift(tok.slice(from[p], p)); p = from[p]; }
    return parts.join(" ");
  }
  function spasiNama(s) {
    s = String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
    var toks = s.split(" "), i;
    for (i = 0; i < toks.length; i++) toks[i] = pecahKata(toks[i]);
    return toks.join(" ");
  }
  // "JL.SUNTER" -> "JL. SUNTER"
  function rapikanAlamat(s) {
    return String(s || "").replace(/\b(JL|JLN|GG)\.?(?=[A-Z]{3})/gi, function (m, a) { return a.toUpperCase() + ". "; }).replace(/\s+/g, " ").trim();
  }

  function lev(a, b) {
    var m = a.length, n = b.length, i, j, prev = [], cur = [];
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }
  // 0..1, spasi diabaikan (PASIRBANGKA == PASIR BANGKA)
  function nameScore(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    return Math.max(1 - lev(a, b) / Math.max(a.length, b.length), similarity(a, b));
  }

  // Kode 2 huruf; OCR sering menukar huruf/angka (88 -> BB). Return kode valid di master atau "".
  function fixKode(k) {
    k = String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!k) return "";
    if (BY_KODE[k]) return k;
    var alt = k.replace(/8/g, "B").replace(/0/g, "O").replace(/5/g, "S").replace(/1/g, "I").replace(/6/g, "G").replace(/2/g, "Z");
    return BY_KODE[alt] ? alt : "";
  }

  // Teks jenis barang (hasil baca / ketikan) -> {jenis:"PASIR BANGKA / BA", nama, kode, matched, warn}
  //  - ada kode di kertas & valid  -> pakai kode itu (nama diambil dari master)
  //  - hanya nama                  -> cocokkan ke master (toleran salah baca), kode ditentukan otomatis
  //  - tidak ada di master         -> dipertahankan apa adanya (spasi dirapikan), tetap boleh disimpan
  function resolveJenis(raw) {
    var out = { jenis: "", nama: "", kode: "", matched: false, warn: "" };
    var s = String(cleanField(raw) || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!s) return out;
    var name = s, kode = "", cm, i, sc;
    if (s.length === 2 && fixKode(s)) { name = ""; kode = fixKode(s); }
    else if ((cm = /^(.*?)[\s\/|\\_,;:\-]+([A-Z0-9]{2})$/.exec(s)) && fixKode(cm[2])) { name = cm[1].replace(/[\s\/|\\_,;:\-]+$/, ""); kode = fixKode(cm[2]); }
    var codeItem = kode ? BY_KODE[kode] : null;

    var best = null, second = 0;
    if (name && MASTER.length) {
      for (i = 0; i < MASTER.length; i++) {
        sc = nameScore(name, MASTER[i].nama);
        if (!best || sc > best.score) { if (best) second = Math.max(second, best.score); best = { item: MASTER[i], score: sc }; }
        else if (sc > second) second = sc;
      }
    }
    var nameItem = best && best.score >= 0.7 && (best.score === 1 || best.score - second >= 0.04) ? best.item : null;

    var item = null;
    if (codeItem) {
      item = codeItem; // kode di kertas = acuan utama
      if (nameItem && nameItem.kode !== codeItem.kode && best.score >= 0.8) {
        out.warn = "Nama “" + name + "” mirip " + nameItem.nama + " (" + nameItem.kode + "), tapi kode di kertas " + codeItem.kode + " (" + codeItem.nama + "). Dipakai kode di kertas, cek lagi.";
      }
    } else if (nameItem) item = nameItem;

    if (item) {
      out.nama = spasiNama(item.nama); out.kode = item.kode; out.matched = true;
      out.jenis = out.nama + " / " + out.kode;
      if (!out.warn && norm(name || "") !== norm(item.nama) && name) {
        out.warn = "Jenis barang terbaca “" + s + "” dicocokkan ke master: " + out.jenis + ".";
      }
      return out;
    }
    out.nama = spasiNama(name); out.kode = kode;
    out.jenis = out.nama + (kode ? " / " + kode : "");
    if (MASTER.length && name) out.warn = "Jenis barang “" + out.nama + "” tidak ditemukan di master kode barang. Dibiarkan apa adanya (boleh disimpan).";
    return out;
  }

  // Jenis barang untuk 1 baris invoice: kode baris + (opsional) nama umum yang diketik admin
  function jenisDariKode(kode, jenisDefault) {
    var kd = fixKode(kode), jd = String(jenisDefault || "").trim();
    if (jd) {
      var rj = resolveJenis(jd);
      var nm = rj.matched ? rj.nama : spasiNama(jd.replace(/[\s\/\-]+[A-Z0-9]{2}$/, function (m) { return fixKode(m.replace(/[^A-Z0-9]/g, "")) ? "" : m; }));
      var kk = kd || rj.kode || "";
      return nm + (kk ? " / " + kk : "");
    }
    if (kd) return spasiNama(BY_KODE[kd].nama) + " / " + kd;
    return "";
  }

  // ------------------------------------------------------------ preprocess
  // imageData: {data: RGBA, width, height}. Hasil Uint8Array 0/255 (hitam-putih).
  // channel "r" (default) menghilangkan stempel/tinta merah & kertas pink.
  function binarize(imageData, opts) {
    opts = opts || {};
    var w = imageData.width, h = imageData.height, src = imageData.data;
    var channel = opts.channel || "r";
    var gray = new Uint8Array(w * h), i, p;
    for (i = 0, p = 0; i < w * h; i++, p += 4) {
      gray[i] = channel === "luma" ? (src[p] * 299 + src[p + 1] * 587 + src[p + 2] * 114) / 1000 : src[p];
    }
    // sedikit haluskan (kernel 1-2-1) supaya titik-titik dot-matrix menyambung
    if (opts.blur) {
      var g2 = new Uint8Array(w * h), xx, yy;
      for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) {
        var a0 = gray[yy * w + (xx > 0 ? xx - 1 : xx)], a1 = gray[yy * w + xx], a2 = gray[yy * w + (xx < w - 1 ? xx + 1 : xx)];
        g2[yy * w + xx] = (a0 + 2 * a1 + a2) >> 2;
      }
      for (yy = 0; yy < h; yy++) for (xx = 0; xx < w; xx++) {
        var b0 = g2[(yy > 0 ? yy - 1 : yy) * w + xx], b1 = g2[yy * w + xx], b2 = g2[(yy < h - 1 ? yy + 1 : yy) * w + xx];
        gray[yy * w + xx] = (b0 + 2 * b1 + b2) >> 2;
      }
    }
    var win = opts.window || Math.max(25, Math.round(w / 65));
    var C = opts.C === undefined ? 12 : opts.C;
    var r = win >> 1, W1 = w + 1;
    var ii = new Float64Array(W1 * (h + 1)), x, y, row;
    for (y = 0; y < h; y++) {
      row = 0;
      for (x = 0; x < w; x++) {
        row += gray[y * w + x];
        ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row;
      }
    }
    var out = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        var area = (y1 - y0 + 1) * (x1 - x0 + 1);
        var sum = ii[(y1 + 1) * W1 + x1 + 1] - ii[y0 * W1 + x1 + 1] - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];
        out[y * w + x] = gray[y * w + x] < sum / area - C ? 0 : 255;
      }
    }
    // tebalkan goresan: titik dot-matrix yang renggang jadi huruf utuh (dilate piksel hitam)
    var dil = opts.dilate | 0;
    if (dil > 0) {
      var tmp = new Uint8Array(w * h), k, xq, yq, hit;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        hit = 255;
        for (k = -dil; k <= dil; k++) { xq = x + k; if (xq >= 0 && xq < w && out[y * w + xq] === 0) { hit = 0; break; } }
        tmp[y * w + x] = hit;
      }
      var out2 = new Uint8Array(w * h);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        hit = 255;
        for (k = -dil; k <= dil; k++) { yq = y + k; if (yq >= 0 && yq < h && tmp[yq * w + x] === 0) { hit = 0; break; } }
        out2[y * w + x] = hit;
      }
      out = out2;
    }
    return out;
  }

  // Kecerahan & ketajaman (variansi Laplacian) untuk panduan di layar kamera
  function quality(rgba, w, h) {
    var n = w * h, i, p, sum = 0, g = new Uint8Array(n);
    for (i = 0, p = 0; i < n; i++, p += 4) {
      g[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
      sum += g[i];
    }
    var mean = sum / n, acc = 0, cnt = 0, x, y;
    for (y = 1; y < h - 1; y++) {
      for (x = 1; x < w - 1; x++) {
        var c = y * w + x;
        var lap = 4 * g[c] - g[c - 1] - g[c + 1] - g[c - w] - g[c + w];
        acc += lap * lap; cnt++;
      }
    }
    return { brightness: mean, sharpness: cnt ? acc / cnt : 0 };
  }

  // ------------------------------------------------------------ Surat Jalan
  // M3 di kertas biasanya terbaca benar (angka besar). Kalau P x L x T tidak cocok,
  // coba cari SATU ukuran yang salah baca: ukuran = M3 / (dua ukuran lainnya).
  function fixDimsByM3(res) {
    var d = [res.panjang, res.lebar, res.tinggi], k, o, v, cand = [];
    if (!res.m3Terbaca || !d[0] || !d[1] || !d[2]) return;
    if (Math.abs(hitungM3(d[0], d[1], d[2]) - res.m3Terbaca) <= 0.002) return;
    for (k = 0; k < 3; k++) {
      o = d.filter(function (_, i) { return i !== k; });
      v = res.m3Terbaca / (o[0] * o[1]);
      var dec = k === 2 ? 3 : 2;
      var rv = Math.round(v * Math.pow(10, dec)) / Math.pow(10, dec);
      var test = d.slice(); test[k] = rv;
      if (rv > 0 && Math.abs(hitungM3(test[0], test[1], test[2]) - res.m3Terbaca) <= 0.0008) cand.push({ k: k, v: rv });
    }
    if (cand.length === 1) {
      var nm = ["Panjang", "Lebar", "Tinggi"][cand[0].k], was = d[cand[0].k];
      if (cand[0].k === 0) res.panjang = cand[0].v; else if (cand[0].k === 1) res.lebar = cand[0].v; else res.tinggi = cand[0].v;
      res.koreksi = (res.koreksi || []);
      res.koreksiDim = { field: ["panjang", "lebar", "tinggi"][cand[0].k], nama: nm, dari: was, ke: cand[0].v };
      res.koreksi.push(nm + " dikoreksi otomatis " + was + " → " + cand[0].v + " (supaya cocok dengan M3 " + res.m3Terbaca.toFixed(3) + " di kertas). Cek lagi.");
    }
  }

  function finishSj(res) {
    res.warnings = [];
    res.koreksi = [];
    fixDimsByM3(res);
    for (var kk = 0; kk < res.koreksi.length; kk++) res.warnings.push(res.koreksi[kk]);
    if (!res.panjang || !res.lebar || !res.tinggi) res.warnings.push("Ukuran bak (P-L-T) tidak terbaca, isi manual.");
    res.m3 = hitungM3(res.panjang, res.lebar, res.tinggi);
    if (res.m3Terbaca && res.m3 && Math.abs(res.m3Terbaca - res.m3) > 0.002) {
      res.warnings.push("M3 di kertas " + res.m3Terbaca.toFixed(3) + " tidak sama dengan P×L×T = " + res.m3.toFixed(3) + ". Cek ukuran bak.");
    }
    // jenis barang: rapikan spasi, cocokkan ke master, tentukan kode
    var rj = resolveJenis(res.jenisBarang);
    res.jenisBarang = rj.jenis;
    res.jenisKode = rj.kode;
    if (rj.warn) res.warnings.push(rj.warn);
    if (!res.jenisBarang) res.warnings.push("Jenis barang tidak terbaca (boleh dikosongkan).");
    res.tujuan = rapikanAlamat(String(res.tujuan || "").replace(/\s*[\r\n]+\s*/g, " "));
    if (!res.no) res.warnings.push("Nomor surat jalan tidak terbaca.");
    if (!res.tanggal) res.warnings.push("Tanggal tidak terbaca (diisi hari ini bila dikosongkan).");
    if (!res.noPolisi) res.warnings.push("Nomor polisi tidak terbaca / kosong di kertas (boleh disimpan kosong).");
    return res;
  }

  // "TU BATU SPLIT 7 9B" -> "BATU SPLIT" ; "BATU SPLIT / BB" tetap
  function cleanJenis(v) {
    v = cleanField(v).replace(/^(?:[A-Z]{1,2}\s+)+(?=[A-Z]{3,})/, "");
    var m = /^(.*?)\s+[\/7T1|]\s+([A-Z0-9]{1,3})$/.exec(v);
    if (m) return /^[A-Z]{2}$/.test(m[2]) ? m[1] + " / " + m[2] : m[1];
    return v;
  }

  // ---- Tujuan / alamat bisa 2 baris ------------------------------------------
  // Di kertas SJ, alamat panjang turun ke baris bawah dan baris ke-2 itu SEJAJAR dengan kolom
  // Nomor di kanan ("KEC. TANJUNG PRIOK      Nomor : BM-002096"). Fungsi ini mengembalikan teks
  // lanjutan alamat, atau null kalau baris itu sudah field lain / bukan alamat.
  var STOP_FIELD = /^\W*(?:[JjdD]en\w{1,3}\s*[Bb]\w{1,2}\b|Tan\w{2,5}\s*[:=;.&]|Jam\s*[:;.]|Nomo[rn]\b|Mos[oa]r\b|A\s*\/\s*P\b|Pen\w{3,7}\s*[:=;]|Tuj\w{2,4}\s*[:=;])/i;
  var DIM_RE = /(\d[.,]\d{2,3})\s*[-–—~=]+\s*(\d[.,]\d{2,3})\s*[-–—~=]+\s*(\d[.,]\d{2,3})/;
  var NOMOR_EKOR = /\s*\S{0,7}\s*[:=;]\s*[A-Z8]{2}\s*[-–—~=]?\s*0?\d{5,}.*$/i;
  function lanjutanTujuan(line) {
    if (STOP_FIELD.test(line) || DIM_RE.test(line)) return null;
    var s = cleanField(line).replace(NOMOR_EKOR, "");
    s = s.replace(/[\s'"`+,;:*\-]+$/, "").trim();
    if (s.replace(/[^A-Za-z0-9]/g, "").length < 3) return null;
    if (/^[\d\s.,:\-\/]+$/.test(s)) return null;                  // hanya angka/tanggal
    if (/^[A-Z8]{2}\s*[-–—~=]?\s*0?\d{5,}$/i.test(s)) return null;  // nomor SJ berdiri sendiri
    return s;
  }

  function parseSuratJalan(text) {
    var t = String(text || ""), lines = cleanLines(t);
    var res = {
      tipe: "SJ", no: "", tanggal: "", jam: "", dari: "", penerima: "", tujuan: "",
      jenisBarang: "", noPolisi: "", panjang: 0, lebar: 0, tinggi: 0, m3: 0, m3Terbaca: 0, warnings: []
    };
    var m, li, tujuanIdx = -1;

    // Nomor: label bisa rusak ("Mosor") -> cari pola nomor itu sendiri (2 huruf + 6 digit, mis. BM-002096)
    m = /Nomo[rn]\s*[:=;.]?\s*([A-Za-z]{1,4})\s*[-–—~]?\s*(\d{3,8})/.exec(t);
    if (!m) m = /\b([A-Z8]{2})\s*[-–—~=]?\s*(0\d{5})/.exec(t);
    if (m) {
      var pre = m[1].toUpperCase();
      if (/^(BN|BH|8M|RM|EM|BW)$/.test(pre)) pre = "BM";
      res.no = pre + "-" + m[2];
    } else if ((m = /Nomo[rn]\s*[:=;.]?\s*([A-Za-z0-9\-]{4,})/.exec(t))) res.no = m[1].toUpperCase();

    m = /Tan\w{2,5}\s*[:=;.&]?\s*(\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{2,4})/i.exec(t);
    res.tanggal = m ? findDate(m[1]) : findDate(t);

    m = /Jam\s*[:;.]?\s*(\d{1,2})\s*[:.]\s*(\d{2})(?:\s*[:.]\s*(\d{2}))?/.exec(t);
    if (m) res.jam = pad2(+m[1]) + ":" + m[2] + (m[3] ? ":" + m[3] : "");

    // Label dicocokkan longgar (OCR sering salah huruf): "A/P Dari", "Pen...", "Tuj...", "Jenis Brg"
    var SEP = "[\\s:=;.&|]*(?:[8$]\\s+)?";
    for (li = 0; li < lines.length; li++) {
      var ln = lines[li];
      if (!res.dari && (m = new RegExp("A\\s*\\/\\s*P\\s*Da\\w{0,3}" + SEP + "(.+)", "i").exec(ln))) res.dari = cleanField(m[1]);
      else if (!res.penerima && (m = new RegExp("^\\W*Pen\\w{3,7}\\b" + SEP + "(.+)", "i").exec(ln))) res.penerima = cleanField(m[1]);
      else if (!res.tujuan && (m = new RegExp("Tuj\\w{2,4}\\b" + SEP + "(.+)", "i").exec(ln))) { res.tujuan = cleanField(m[1]); tujuanIdx = li; }
      if (!res.jenisBarang && (m = /[JjdD]en\w{1,3}\s*[Bb]\w{1,2}[^A-Z]{0,5}([A-Z][A-Z0-9 \/.\-]{2,})/.exec(ln))) {
        res.jenisBarang = cleanJenis(m[1]);
      }
    }

    // alamat tujuan yang turun ke baris berikutnya (max 2 baris lanjutan)
    res.tujuanBaris = res.tujuan ? [res.tujuan] : [];
    if (tujuanIdx >= 0) {
      for (li = tujuanIdx + 1; li < lines.length && res.tujuanBaris.length < 3; li++) {
        var lanj = lanjutanTujuan(lines[li]);
        if (!lanj) break;
        res.tujuanBaris.push(lanj);
      }
      if (!res.tujuan && res.tujuanBaris.length) res.tujuan = "";
      res.tujuan = res.tujuanBaris.join(" ");
    }

    // baris ukuran bak: "3.58 - 1.75 - 0.820    5.137"
    var DIM = /(\d[.,]\d{2,3})\s*[-–—~=]+\s*(\d[.,]\d{2,3})\s*[-–—~=]+\s*(\d[.,]\d{2,3})(.*)$/;
    for (li = 0; li < lines.length; li++) {
      m = DIM.exec(lines[li]);
      if (m) {
        res.panjang = num(m[1]); res.lebar = num(m[2]); res.tinggi = num(m[3]);
        var mm = /(\d{1,2}[.,]\d{3})(?!\d)/.exec(m[4]);
        if (mm) res.m3Terbaca = num(mm[1]);
        var left = lines[li].slice(0, lines[li].indexOf(m[1]));
        var pl = /\b([A-Z]{1,2})\s*-?\s*(\d{1,4})\s*-?\s*([A-Z]{1,3})\b/.exec(left);
        if (pl) res.noPolisi = pl[1] + " " + pl[2] + " " + pl[3];
        break;
      }
    }
    return finishSj(res);
  }

  // --------------------------------------------------------------- Invoice
  // Satu baris: "1 10/08/26 002096 -BB JL.SUNTER ... 3.58 1.75 0.82 5.137 445,000 2,285,965"
  function parseInvoiceRow(line) {
    var dm = DATE_RE.exec(line);
    if (!dm) return null;
    var after = line.slice(dm.index + dm[0].length);
    var nm = /(?:^|\s)(\d{4,7})(?!\d)/.exec(after);
    if (!nm) return null;
    var tglKirim = toIsoDate(dm[1], dm[2], dm[3]);
    var noSJ = nm[1];
    var rest = after.slice(nm.index + nm[0].length);
    return buildRow(tglKirim, noSJ, rest);
  }

  // Sisa baris (setelah no SJ) -> kode, ukuran, M3, harga, jumlah, alamat
  function buildRow(tglKirim, noSJ, rest) {
    var kode = "", kodeDipakai = false;
    var km = /^\s*[-–—~_]?\s*([A-Z0-9]{1,3})(?=\s)/.exec(rest);
    if (km) {
      if (MASTER.length) { var kf = fixKode(km[1]); if (kf) { kode = kf; kodeDipakai = true; } }
      else if (/^[A-Z]{1,3}$/.test(km[1])) { kode = km[1]; kodeDipakai = true; }
    }

    var toks = rest.match(/\d[\d.,]*\d|\d/g) || [];
    var dims = [], m3Read = NaN, harga = NaN, jumlahRead = "", i, tk, val;
    for (i = 0; i < toks.length; i++) {
      tk = toks[i];
      if (/^\d[.,]\d{2}$/.test(tk) || (/^\d[.,]\d{3}$/.test(tk) && dims.length < 3 && isNaN(m3Read) && /^0[.,]/.test(tk))) {
        if (dims.length < 3) { dims.push(num(tk)); continue; }
      }
      if (/^\d[.,]\d{3}$/.test(tk) && dims.length >= 3 && isNaN(m3Read)) { m3Read = num(tk); continue; }
      if (/^\d{2}[.,]\d{3}$/.test(tk) && dims.length >= 3 && isNaN(m3Read) && num(tk) < 100) {
        val = Number(digitsOnly(tk));
        if (val < 20000) { m3Read = num(tk); continue; }
      }
      if (/^\d{2,3}[.,]\d{3}$/.test(tk)) {
        val = Number(digitsOnly(tk));
        if (val >= 20000 && val <= 5000000 && isNaN(harga)) { harga = val; continue; }
      }
      if (/^\d{1,3}([.,]\d{3}){2,}$/.test(tk)) { jumlahRead = digitsOnly(tk); }
    }

    var firstDim = dims.length ? rest.search(/\d[.,]\d{2,3}\s+\d[.,]\d{2,3}/) : -1;
    var addrPart = firstDim > 0 ? rest.slice(0, firstDim) : rest;
    if (kodeDipakai) addrPart = addrPart.replace(/^\s*[-–—~_]?\s*[A-Z0-9]{1,3}(?=\s)/, "");
    var alamat = rapikanAlamat(cleanField(addrPart.replace(/[^A-Za-z0-9.,\/\-() ]+/g, " ")));

    return {
      tglKirim: tglKirim, noSJ: noSJ, kode: kode, alamat: alamat,
      panjang: dims[0] || 0, lebar: dims[1] || 0, tinggi: dims[2] || 0,
      m3Terbaca: isNaN(m3Read) ? 0 : m3Read,
      harga: isNaN(harga) ? 0 : harga,
      jumlahTerbaca: jumlahRead, warn: []
    };
  }

  // Pembaca cadangan untuk baris yang formatnya tidak seperti biasa: tanggal boleh tidak ada /
  // urutan kolom beda. Hanya dipakai kalau pembaca biasa tidak menemukan satu baris pun.
  function parseInvoiceRowLoose(line) {
    var dm = DATE_RE.exec(line), tgl = "", s = line;
    if (dm) {
      tgl = toIsoDate(dm[1], dm[2], dm[3]);
      s = line.slice(0, dm.index) + " " + line.slice(dm.index + dm[0].length);
    }
    var nm = /(?:^|\s)(\d{4,7})(?=\s|$|[-–—~_])/.exec(s);
    if (!nm) return null;
    var row = buildRow(tgl, nm[1], s.slice(nm.index + nm[0].length));
    if (!(row.harga && (row.panjang || row.m3Terbaca))) return null;
    row.longgar = true;
    return row;
  }

  // Alamat kirim yang turun ke baris berikutnya (tidak ada tanggal / angka tabel)
  var STOP_ALAMAT = /\b(?:Total|Jumlah|Halaman|Terbilang|Hormat|Penerima|Tagihan|Catatan|Kode\s*Customer|Nama\s*Customer|Alamat|Invoice|Tgl|Tanggal|Harga|M3|Bank|Rek)\b/i;
  function lanjutanAlamat(line) {
    if (DATE_RE.test(line) || STOP_ALAMAT.test(line) || /\d[.,]\d{2,3}/.test(line)) return null;
    var s = rapikanAlamat(cleanField(line.replace(/[^A-Za-z0-9.,\/\-() ]+/g, " ")));
    return s.replace(/[^A-Za-z]/g, "").length < 4 ? null : s;
  }

  function finalizeRow(r) {
    r.warn = [];
    if (r.kode) { var kf2 = fixKode(r.kode); if (kf2) r.kode = kf2; }
    r.jenisBarang = r.kode && BY_KODE[r.kode] ? spasiNama(BY_KODE[r.kode].nama) + " / " + r.kode : "";
    r.m3 = hitungM3(r.panjang, r.lebar, r.tinggi);
    r.jumlah = Math.round(r.m3 * r.harga);
    if (!r.panjang || !r.lebar || !r.tinggi) r.warn.push("Ukuran P-L-T belum lengkap");
    if (!r.harga) r.warn.push("Harga tidak terbaca");
    if (r.m3Terbaca && r.m3 && Math.abs(r.m3Terbaca - r.m3) > 0.002) {
      r.warn.push("M3 di kertas " + r.m3Terbaca.toFixed(3) + " ≠ P×L×T " + r.m3.toFixed(3));
    }
    if (r.jumlahTerbaca && r.jumlah) {
      var calc = String(r.jumlah);
      var ok = r.jumlahTerbaca === calc || (r.jumlahTerbaca.length > calc.length && r.jumlahTerbaca.slice(-calc.length) === calc);
      if (!ok) r.warn.push("Jumlah di kertas " + fmt(Number(r.jumlahTerbaca)) + " ≠ hitung " + fmt(r.jumlah));
    }
    if (!r.tglKirim) r.warn.push("Tanggal kirim tidak terbaca");
    return r;
  }

  function sumInvoice(inv) {
    var i, tm = 0, tt = 0;
    inv.warnings = (inv.warnings || []).filter(function (w) { return w.indexOf("Total") !== 0; });
    for (i = 0; i < inv.rows.length; i++) { tm += inv.rows[i].m3 || 0; tt += inv.rows[i].jumlah || 0; }
    inv.totalM3 = r3(tm);
    inv.totalTagihan = tt;
    inv.totalCocok = false;
    if (inv.totalTagihanTerbaca) {
      if (Math.abs(inv.totalTagihanTerbaca - tt) > 1) {
        inv.warnings.push("Total tagihan di kertas Rp " + fmt(inv.totalTagihanTerbaca) + " ≠ jumlah baris Rp " + fmt(tt) + ". Ada baris yang salah baca / belum lengkap.");
      } else {
        inv.totalCocok = true;
      }
    }
    if (inv.totalM3Terbaca && Math.abs(inv.totalM3Terbaca - inv.totalM3) > 0.011) {
      inv.warnings.push("Total M3 di kertas " + inv.totalM3Terbaca + " ≠ jumlah baris " + inv.totalM3.toFixed(2) + ".");
    }
    return inv;
  }

  function parseInvoice(text) {
    var t = String(text || ""), lines = cleanLines(t);
    var res = {
      tipe: "INVOICE", no: "", tanggal: "", halaman: 1, kodeCustomer: "", namaCustomer: "", alamat: "",
      rows: [], totalM3Terbaca: 0, totalTagihanTerbaca: 0, totalM3: 0, totalTagihan: 0, warnings: []
    };
    var m, li, ln;

    m = /In[vy]\w{0,3}ice\s*[:=;.]?\s*(\d{3,10})/i.exec(t);
    if (m) res.no = m[1];
    else if ((m = /Invoice\s*[:=;.]?\s*([A-Z0-9\-\/]{3,})/i.exec(t))) res.no = m[1];

    m = /(?:Tanggal|anggal)\s*[:=;.]?\s*(\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{4})/i.exec(t);
    res.tanggal = m ? findDate(m[1]) : "";
    if (!res.tanggal) {
      var re4 = /(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})(?!\d)/;
      for (li = 0; li < lines.length && li < 18; li++) {
        m = re4.exec(lines[li]);
        if (m) { res.tanggal = toIsoDate(m[1], m[2], m[3]); break; }
      }
    }

    m = /Halaman\W{0,6}(\d{1,3})/i.exec(t);
    if (m) res.halaman = parseInt(m[1], 10) || 1;

    for (li = 0; li < lines.length; li++) {
      ln = lines[li];
      if (!res.kodeCustomer && (m = /Kode\s*Customer\s*[:=;.]?\s*([A-Za-z0-9]{2,12})/i.exec(ln))) res.kodeCustomer = m[1].toUpperCase();
      if (!res.namaCustomer && (m = /Nama\s*Customer\s*[:=;.]?\s*(.+)/i.exec(ln))) res.namaCustomer = cleanField(m[1]);
      if (!res.alamat && (m = /\bAlamat\s*(?!Kirim)[:=;.]?\s*(.+)/i.exec(ln)) && !/Tgl\s*Kirim/i.test(ln)) res.alamat = cleanField(m[1]);
    }
    var lastRow = null, lanjut = 0;
    for (li = 0; li < lines.length; li++) {
      var row = parseInvoiceRow(lines[li]);
      if (row && (row.harga || row.panjang)) { res.rows.push(row); lastRow = row; lanjut = 0; continue; }
      if (lastRow && lanjut < 2) {
        var extraA = lanjutanAlamat(lines[li]);
        if (extraA) { lastRow.alamat = (lastRow.alamat + " " + extraA).replace(/\s+/g, " ").trim(); lanjut++; continue; }
      }
      lastRow = null;
    }
    if (!res.rows.length) {
      for (li = 0; li < lines.length; li++) {
        var rl = parseInvoiceRowLoose(lines[li]);
        if (rl) res.rows.push(rl);
      }
    }
    var k;
    for (k = 0; k < res.rows.length; k++) {
      var rr = res.rows[k];
      if (res.alamat && similarity(rr.alamat, res.alamat) >= 0.5) rr.alamat = res.alamat.replace(/\s*\(\d[\d\-\s]+\)\s*$/, "");
      finalizeRow(rr);
    }

    m = /Total\s*M\s*[3B]\W{0,6}([\d]+[.,]\d{1,3})/i.exec(t);
    if (m) res.totalM3Terbaca = num(m[1]);
    m = /Tagihan\W{0,8}(?:Rp\W{0,3})?\s*([\d][\d.,]{4,})/i.exec(t);
    if (m) res.totalTagihanTerbaca = Number(digitsOnly(m[1]));

    reconcileHarga(res, []);
    if (!res.no) res.warnings.push("Nomor invoice tidak terbaca.");
    if (!res.tanggal) res.warnings.push("Tanggal invoice tidak terbaca.");
    if (!res.rows.length) res.warnings.push("Baris tabel tidak terbaca. Foto ulang lebih dekat/terang, atau tambah baris manual.");
    return res;
  }

  // ------------------------------------------------- koreksi otomatis harga
  // OCR paling sering salah di digit harga (445.000 terbaca 845.000). Petunjuk:
  //  a) jumlah di kertas / M3 -> harga bulat
  //  b) daftar harga customer di master (knownPrices)
  //  c) total tagihan di kertas harus = jumlah semua baris
  function reconcileHarga(inv, knownPrices) {
    var rows = inv.rows, n = rows.length, i, j;
    if (!n) return sumInvoice(inv);
    var cands = [];
    for (i = 0; i < n; i++) {
      var r = rows[i], set = [], seen = {};
      var add = function (v, src) {
        v = Math.round(v / 500) * 500;
        if (v >= 20000 && v <= 5000000 && !seen[v]) { seen[v] = 1; set.push({ v: v, src: src }); }
      };
      if (r.harga) { seen[r.harga] = 1; set.push({ v: r.harga, src: "baca" }); }
      var jt = r.jumlahTerbaca || "";
      if (r.m3 > 0 && jt) {
        var tries = [jt, jt.slice(-7), jt.slice(-6)];
        for (j = 0; j < tries.length; j++) {
          if (!tries[j]) continue;
          var hj = Number(tries[j]) / r.m3;
          if (Math.abs(hj - Math.round(hj / 500) * 500) < hj * 0.0004) add(hj, "jumlah");
        }
      }
      for (j = 0; j < rows.length; j++) if (rows[j].harga) add(rows[j].harga, "baris lain");
      for (j = 0; j < (knownPrices || []).length; j++) add(Number(knownPrices[j]), "master");
      cands.push(set);
    }
    var total = inv.totalTagihanTerbaca || 0;
    var chosen = [];
    for (i = 0; i < n; i++) chosen.push(cands[i][0] ? cands[i][0].v : 0);

    function sumFor(sel) {
      var s = 0, k;
      for (k = 0; k < n; k++) s += Math.round(rows[k].m3 * sel[k]);
      return s;
    }

    if (total && Math.abs(sumFor(chosen) - total) > 1 && n <= 10) {
      var best = null, bestChanges = 99, cur = [], steps = 0;
      var dfs = function (idx, changes) {
        if (steps++ > 400000 || changes >= bestChanges) return;
        if (idx === n) {
          if (Math.abs(sumFor(cur) - total) <= 1) { best = cur.slice(); bestChanges = changes; }
          return;
        }
        var c = cands[idx], k;
        if (!c.length) { cur[idx] = 0; dfs(idx + 1, changes); return; }
        for (k = 0; k < c.length; k++) {
          cur[idx] = c[k].v;
          dfs(idx + 1, changes + (c[k].v === rows[idx].harga ? 0 : 1));
        }
      };
      dfs(0, 0);
      if (best) chosen = best;
      else {
        // satu baris saja yang bermasalah? -> hitung dari sisa total
        for (i = 0; i < n; i++) {
          var others = 0, k2;
          for (k2 = 0; k2 < n; k2++) if (k2 !== i) others += Math.round(rows[k2].m3 * chosen[k2]);
          var h = rows[i].m3 > 0 ? (total - others) / rows[i].m3 : 0;
          if (h > 20000 && Math.abs(h - Math.round(h / 500) * 500) < h * 0.0004) {
            var test = chosen.slice(); test[i] = Math.round(h / 500) * 500;
            if (Math.abs(sumFor(test) - total) <= 1) { chosen = test; break; }
          }
        }
      }
    }
    for (i = 0; i < n; i++) {
      if (chosen[i] && chosen[i] !== rows[i].harga) {
        rows[i].hargaTerbaca = rows[i].harga;
        rows[i].hargaKoreksi = true;
        rows[i].harga = chosen[i];
      }
      finalizeRow(rows[i]);
      if (rows[i].hargaKoreksi) rows[i].warn.push("Harga dikoreksi otomatis: terbaca " + fmt(rows[i].hargaTerbaca) + " → " + fmt(rows[i].harga) + " (cocok dengan total/jumlah di kertas). Cek lagi.");
    }
    markSjLength(inv);
    return sumInvoice(inv);
  }

  function markSjLength(inv) {
    var cnt = {}, best = 0, bestLen = 0, i, L;
    for (i = 0; i < inv.rows.length; i++) { L = inv.rows[i].noSJ.length; cnt[L] = (cnt[L] || 0) + 1; if (cnt[L] > best) { best = cnt[L]; bestLen = L; } }
    for (i = 0; i < inv.rows.length; i++) {
      if (inv.rows[i].noSJ.length !== bestLen) inv.rows[i].warn.push("No SJ " + inv.rows[i].noSJ + " panjangnya tidak sama dengan baris lain, cek digitnya.");
    }
  }

  // ------------------------------------------------------ hasil AI (Gemini)
  function isoOrEmpty(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : findDate(v); }
  function fromAi(tipe, j) {
    j = j || {};
    var k;
    if (tipe === "SJ") {
      var sjr = finishSj({
        tipe: "SJ", no: String(j.no || "").toUpperCase().replace(/\s+/g, ""), tanggal: isoOrEmpty(j.tanggal), jam: String(j.jam || ""),
        dari: String(j.dari || ""), penerima: String(j.penerima || ""), tujuan: oneLine(j.tujuan),
        tujuanBaris: String(j.tujuan || "").split(/\s*[\r\n]+\s*/).filter(Boolean),
        jenisBarang: String(j.jenisBarang || ""), noPolisi: String(j.noPolisi || ""),
        panjang: Number(j.panjang) || 0, lebar: Number(j.lebar) || 0, tinggi: Number(j.tinggi) || 0,
        m3: 0, m3Terbaca: Number(j.m3) || 0, warnings: []
      });
      if (j.catatanFormat) sjr.warnings.unshift("Format kertas ini berbeda dari biasanya: " + String(j.catatanFormat));
      sjr.pertanyaanAi = raguKePertanyaan("SJ", j, 0);
      return sjr;
    }
    var inv = {
      tipe: "INVOICE", no: String(j.no || "").trim(), tanggal: isoOrEmpty(j.tanggal), halaman: Number(j.halaman) || 1,
      kodeCustomer: String(j.kodeCustomer || ""), namaCustomer: String(j.namaCustomer || ""), alamat: String(j.alamat || ""),
      rows: [], totalM3Terbaca: Number(j.totalM3) || 0, totalTagihanTerbaca: Number(j.totalTagihan) || 0,
      totalM3: 0, totalTagihan: 0, warnings: []
    };
    var src = j.rows || [];
    for (k = 0; k < src.length; k++) {
      var r = src[k];
      inv.rows.push({
        tglKirim: isoOrEmpty(r.tglKirim), noSJ: digitsOnly(r.noSJ), kode: String(r.kode || ""), alamat: oneLine(r.alamat),
        panjang: Number(r.panjang) || 0, lebar: Number(r.lebar) || 0, tinggi: Number(r.tinggi) || 0,
        m3Terbaca: Number(r.m3) || 0, harga: Number(r.harga) || 0,
        jumlahTerbaca: r.jumlah ? String(Math.round(Number(r.jumlah))) : "", warn: []
      });
    }
    for (k = 0; k < inv.rows.length; k++) finalizeRow(inv.rows[k]);
    reconcileHarga(inv, []);
    if (!inv.no) inv.warnings.push("Nomor invoice tidak terbaca.");
    if (!inv.tanggal) inv.warnings.push("Tanggal invoice tidak terbaca.");
    if (j.catatanFormat) inv.warnings.unshift("Format kertas ini berbeda dari biasanya: " + String(j.catatanFormat));
    inv.pertanyaanAi = raguKePertanyaan("INVOICE", j, inv.rows.length);
    return inv;
  }

  function oneLine(v) { return String(v || "").replace(/\s*[\r\n]+\s*/g, " ").replace(/\s+/g, " ").trim(); }

  // "ragu" dari AI (hal yang tidak dia yakini + kemungkinan jawabannya) -> pertanyaan pilihan ganda
  var NAMA_BIDANG = {
    no: "Nomor", tanggal: "Tanggal", jam: "Jam", penerima: "Penerima", tujuan: "Tujuan", jenisBarang: "Jenis barang",
    noPolisi: "No. polisi", panjang: "Panjang", lebar: "Lebar", tinggi: "Tinggi",
    noSJ: "No SJ", tglKirim: "Tgl kirim", kode: "Kode barang", alamat: "Alamat kirim", harga: "Harga/m³"
  };
  var RAGU_SJ = { no: 1, tanggal: 1, jam: 1, penerima: 1, tujuan: 1, jenisBarang: 1, noPolisi: 1, panjang: 1, lebar: 1, tinggi: 1 };
  var RAGU_INV_FORM = { no: 1, tanggal: 1 };
  var RAGU_INV_ROW = { noSJ: 1, tglKirim: 1, kode: 1, alamat: 1, panjang: 1, lebar: 1, tinggi: 1, harga: 1 };
  function nilaiRagu(tipe, field, v) {
    if (field === "tanggal" || field === "tglKirim") return isoOrEmpty(v);
    if (field === "panjang" || field === "lebar" || field === "tinggi") return num(v) || 0;
    if (field === "harga") return Number(digitsOnly(v)) || 0;
    if (field === "noSJ") return digitsOnly(v);
    if (field === "kode") return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (field === "no" && tipe === "SJ") return String(v || "").toUpperCase().replace(/\s+/g, "");
    return oneLine(v);
  }
  function raguKePertanyaan(tipe, j, jumlahBaris) {
    var list = (j && j.ragu) || [], out = [], i, p, it, field, row, vals, opts, v, lbl;
    if (!(list instanceof Array)) return out;
    for (i = 0; i < list.length && out.length < 6; i++) {
      it = list[i] || {};
      field = String(it.bidang || "");
      row = undefined;
      if (tipe === "SJ") { if (!RAGU_SJ[field]) continue; }
      else if (RAGU_INV_FORM[field]) { /* header invoice */ }
      else if (RAGU_INV_ROW[field]) {
        row = Number(it.baris) - 1;
        if (!(row >= 0 && row < jumlahBaris)) continue;
      } else continue;
      vals = (it.pilihan instanceof Array ? it.pilihan : []).slice(0, 4);
      opts = [];
      for (p = 0; p < vals.length; p++) {
        v = nilaiRagu(tipe, field, vals[p]);
        if (v === "" || v === 0) continue;
        lbl = typeof v === "number" ? (field === "harga" ? "Rp " + fmt(v) : String(v)) : String(v);
        opts.push({ label: lbl, set: [{ scope: row === undefined ? "form" : "row", field: field, row: row, value: v }] });
      }
      if (!opts.length) continue;
      opts.push({ label: "Biarkan seperti hasil baca", set: [] });
      out.push({
        id: (row === undefined ? "form" : "row") + "|" + field + "|" + (row === undefined ? "" : row),
        teks: (NAMA_BIDANG[field] || field) + (row === undefined ? "" : " baris #" + (row + 1)) + ": " + (String(it.alasan || "").trim() || "tulisan kurang jelas") + ". Yang mana yang benar?",
        pilihan: opts
      });
    }
    return out;
  }

  // Nilai kualitas hasil baca (dipakai memilih percobaan OCR terbaik). Makin tinggi makin lengkap.
  function scoreResult(tipe, r) {
    var n = 0;
    if (tipe === "SJ") {
      if (r.no) n += 2;
      if (r.tanggal) n += 1;
      if (r.dari || r.penerima) n += 1;
      if (r.tujuan) n += 1;
      if (r.jenisBarang) n += 1;
      if (r.jenisKode) n += 1;
      if (r.panjang && r.lebar && r.tinggi) n += 2;
      if (r.m3Terbaca && Math.abs(r.m3Terbaca - r.m3) <= 0.002) n += 2;
      return n;
    }
    if (r.no) n += 2;
    if (r.tanggal) n += 1;
    if (r.namaCustomer || r.kodeCustomer) n += 1;
    n += Math.min(r.rows.length, 10) * 2;
    if (r.totalCocok) n += 6;
    return n;
  }

  // ------------------------------------------------------ cocokkan customer
  // list: [{id, kode, nama}]; q: {kode, nama}. Return {id, score, nama} atau null.
  function matchCustomer(list, q) {
    var best = null, i, c, s;
    var kode = norm(String(q.kode || "").replace(/O/g, "0"));
    for (i = 0; i < (list || []).length; i++) {
      c = list[i];
      s = similarity(c.nama, q.nama);
      if (kode && norm(String(c.kode || "").replace(/O/g, "0")) === kode) s = Math.max(s, 0.95);
      if (!best || s > best.score) best = { id: c.id, score: s, nama: c.nama };
    }
    return best && best.score >= 0.5 ? best : null;
  }

  // ------------------------------------------------------ pertanyaan ke admin
  // Dipanggil SESUDAH hasil baca jadi (dan sesudah harga dikoreksi). Mengembalikan daftar
  //   {id, teks, pilihan:[{label, set:[{scope:"form"|"row", field, row, value}], aksi?}]}
  // Tiap pilihan = satu ketukan yang langsung mengisi form. Hanya bertanya kalau ada pilihan nyata.
  //   ctx: {customers:[{id,kode,nama,alamat}], match, rawText, ai:boolean, jenisDefault}
  var QMAX = 8;
  function rpf(n) { return "Rp " + fmt(n); }
  function hariIni() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function selisihHari(a, b) {
    var ta = Date.parse(a + "T00:00:00Z"), tb = Date.parse(b + "T00:00:00Z");
    return isNaN(ta) || isNaN(tb) ? NaN : Math.round((ta - tb) / 86400000);
  }
  function swapIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var d = parseInt(m[3], 10), mo = parseInt(m[2], 10);
    return d > 12 || d === mo ? "" : m[1] + "-" + pad2(d) + "-" + pad2(mo);
  }
  function qTanggal(iso, ref, minH, maxH, scope, field, row, nama) {
    if (!iso) return null;
    var d = selisihHari(iso, ref), alt = swapIso(iso), da;
    if (isNaN(d) || (d >= minH && d <= maxH) || !alt) return null;
    da = selisihHari(alt, ref);
    if (isNaN(da) || da < minH || da > maxH) return null;
    return {
      id: scope + "|" + field + "|" + (row === undefined ? "" : row),
      teks: nama + " terbaca " + iso + ", tidak wajar. Mungkin tanggal & bulan tertukar?",
      pilihan: [
        { label: iso + " (seperti terbaca)", set: [] },
        { label: alt + " (tanggal ↔ bulan ditukar)", set: [{ scope: scope, field: field, row: row, value: alt }] }
      ]
    };
  }
  function topCustomers(list, q, n) {
    var out = [], i, c, s, kode = norm(String(q.kode || "").replace(/O/g, "0"));
    for (i = 0; i < (list || []).length; i++) {
      c = list[i];
      s = similarity(c.nama, q.nama);
      if (kode && norm(String(c.kode || "").replace(/O/g, "0")) === kode) s = Math.max(s, 0.95);
      if (s >= 0.25) out.push({ c: c, s: s });
    }
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, n);
  }
  function topMaster(name, n) {
    var out = [], i, s;
    for (i = 0; i < MASTER.length; i++) {
      s = nameScore(name, MASTER[i].nama);
      if (s >= 0.4) out.push({ it: MASTER[i], s: s });
    }
    out.sort(function (a, b) { return b.s - a.s; });
    return out.slice(0, n);
  }
  function opsiCustomer(top, denganKosong) {
    var opts = [], i;
    for (i = 0; i < top.length; i++) {
      opts.push({
        label: (top[i].c.kode ? top[i].c.kode + " — " : "") + top[i].c.nama + " (" + Math.round(top[i].s * 100) + "%)",
        set: [{ scope: "form", field: "customerId", value: top[i].c.id }]
      });
    }
    if (denganKosong) opts.push({ label: "Tanpa customer (pembeli kontan)", set: [{ scope: "form", field: "customerId", value: "" }] });
    return opts;
  }
  function kandidatHarga(h, r, known) {
    var set = [], seen = {}, j, tries, hj, jt = r.jumlahTerbaca || "";
    function add(v) {
      v = Math.round(v / 500) * 500;
      if (v >= 20000 && v <= 5000000 && !seen[v]) { seen[v] = 1; set.push(v); }
    }
    if (r.harga) add(r.harga);
    if (r.hargaTerbaca) add(r.hargaTerbaca);
    if (r.m3 > 0 && jt) {
      tries = [jt, jt.slice(-7), jt.slice(-6)];
      for (j = 0; j < tries.length; j++) {
        if (!tries[j]) continue;
        hj = Number(tries[j]) / r.m3;
        if (Math.abs(hj - Math.round(hj / 500) * 500) < hj * 0.0004) add(hj);
      }
    }
    for (j = 0; j < h.rows.length; j++) if (h.rows[j].harga) add(h.rows[j].harga);
    for (j = 0; j < (known || []).length; j++) add(Number(known[j]));
    return set.slice(0, 4);
  }

  function buatPertanyaan(tipe, h, ctx) {
    ctx = ctx || {};
    var out = [], seen = {}, cust = ctx.customers || [], i, k, top, opts, mt = ctx.match;
    function add(q) {
      if (!q || seen[q.id] || out.length >= QMAX) return;
      seen[q.id] = 1; out.push(q);
    }
    for (i = 0; i < (h.pertanyaanAi || []).length; i++) add(h.pertanyaanAi[i]);

    if (tipe === "SJ") {
      var nmC = h.dari || h.penerima;
      if (!h.no && ctx.rawText) {
        var cands = [], seenNo = {}, mm, re = /\b([A-Z8]{2})\s*[-–—~=]?\s*(0?\d{5,7})\b/g;
        while ((mm = re.exec(String(ctx.rawText).toUpperCase())) && cands.length < 3) {
          var pre = /^(BN|BH|8M|RM|EM|BW)$/.test(mm[1]) ? "BM" : mm[1], val = pre + "-" + mm[2];
          if (!seenNo[val]) { seenNo[val] = 1; cands.push({ label: val, set: [{ scope: "form", field: "no", value: val }] }); }
        }
        if (cands.length) add({ id: "form|no", teks: "Nomor surat jalan tidak terbaca jelas. Yang mana?", pilihan: cands });
      }
      if (cust.length && nmC && (!mt || mt.score < 0.8)) {
        top = topCustomers(cust, { nama: nmC }, 3);
        if (top.length) add({ id: "form|customerId", teks: "Customer “" + nmC + "” belum pasti. Yang mana?", pilihan: opsiCustomer(top, true) });
      }
      if (h.jenisBarang && MASTER.length && !resolveJenis(h.jenisBarang).matched) {
        var rawJ = String(h.jenisBarang).replace(/\s*\/\s*[A-Z0-9]{2}$/, "");
        top = topMaster(rawJ, 3);
        if (top.length) {
          opts = [];
          for (i = 0; i < top.length; i++) {
            var jv = spasiNama(top[i].it.nama) + " / " + top[i].it.kode;
            opts.push({ label: jv, set: [{ scope: "form", field: "jenisBarang", value: jv }] });
          }
          opts.push({ label: "Pakai tulisan apa adanya: " + h.jenisBarang, set: [] });
          add({ id: "form|jenisBarang", teks: "Jenis barang terbaca “" + h.jenisBarang + "” tidak ada persis di master. Maksudnya yang mana?", pilihan: opts });
        }
      }
      add(qTanggal(h.tanggal, hariIni(), -366, 7, "form", "tanggal", undefined, "Tanggal"));
      var dd = [h.panjang, h.lebar, h.tinggi];
      if (h.koreksiDim) {
        add({
          id: "form|ukuran", teks: h.koreksiDim.nama + " terbaca " + h.koreksiDim.dari + ", saya ubah jadi " + h.koreksiDim.ke + " supaya cocok dengan M3 " + h.m3Terbaca.toFixed(3) + " di kertas. Pakai yang mana?",
          pilihan: [
            { label: h.koreksiDim.nama + " " + h.koreksiDim.ke + " (hasil koreksi)", set: [] },
            { label: h.koreksiDim.nama + " " + h.koreksiDim.dari + " (seperti terbaca)", set: [{ scope: "form", field: h.koreksiDim.field, value: h.koreksiDim.dari }] }
          ]
        });
      } else if (dd[0] && dd[1] && dd[2] && h.m3Terbaca && Math.abs(h.m3 - h.m3Terbaca) > 0.002) {
        var names = ["Panjang", "Lebar", "Tinggi"], flds = ["panjang", "lebar", "tinggi"];
        opts = [];
        for (k = 0; k < 3; k++) {
          var oth = dd.filter(function (_, ix) { return ix !== k; });
          var dec = k === 2 ? 3 : 2, pw = Math.pow(10, dec);
          var v = Math.round((h.m3Terbaca / (oth[0] * oth[1])) * pw) / pw, tst = dd.slice();
          tst[k] = v;
          if (v > 0.05 && v < 20 && v !== dd[k] && Math.abs(hitungM3(tst[0], tst[1], tst[2]) - h.m3Terbaca) <= 0.01) {
            opts.push({ label: names[k] + " seharusnya " + v + " (bukan " + dd[k] + ")", set: [{ scope: "form", field: flds[k], value: v }] });
          }
        }
        opts.push({ label: "Ukuran sudah benar, M3 di kertas yang salah", set: [] });
        add({ id: "form|ukuran", teks: "P×L×T = " + h.m3.toFixed(3) + " tapi M3 di kertas " + h.m3Terbaca.toFixed(3) + ". Angka mana yang salah baca?", pilihan: opts });
      } else if (!(dd[0] && dd[1] && dd[2]) && h.m3Terbaca > 0) {
        add({
          id: "form|m3", teks: "Ukuran P-L-T tidak terbaca, tapi ada M3 di kertas: " + h.m3Terbaca.toFixed(3) + ". Pakai M3 itu langsung?",
          pilihan: [
            { label: "Pakai M3 " + h.m3Terbaca.toFixed(3), set: [{ scope: "form", field: "m3Manual", value: h.m3Terbaca }] },
            { label: "Saya isi ukuran sendiri", set: [] }
          ]
        });
      }
      if (!h.tujuan && mt) {
        for (i = 0; i < cust.length; i++) {
          if (cust[i].id === mt.id && cust[i].alamat) {
            add({
              id: "form|tujuan", teks: "Tujuan tidak terbaca. Pakai alamat customer?",
              pilihan: [{ label: cust[i].alamat, set: [{ scope: "form", field: "tujuan", value: cust[i].alamat }] }, { label: "Saya isi sendiri", set: [] }]
            });
            break;
          }
        }
      }
      return out;
    }

    // ---------------- INVOICE
    if ((h.namaCustomer || h.kodeCustomer) && cust.length && (!mt || mt.score < 0.8)) {
      top = topCustomers(cust, { nama: h.namaCustomer, kode: h.kodeCustomer }, 3);
      if (top.length) add({ id: "form|customerId", teks: "Customer “" + (h.namaCustomer || h.kodeCustomer) + "” belum pasti. Yang mana?", pilihan: opsiCustomer(top, false) });
    }
    add(qTanggal(h.tanggal, hariIni(), -366, 7, "form", "tanggal", undefined, "Tanggal invoice"));
    if (!h.rows.length) {
      opts = [];
      if (ctx.ai) opts.push({ label: "Baca ulang pakai AI", aksi: "ai", set: [] });
      opts.push({ label: "Tambah baris manual", aksi: "tambah", set: [] });
      opts.push({ label: "Foto ulang (lebih dekat/terang)", aksi: "foto", set: [] });
      add({ id: "form|barisKosong", teks: "Baris tabel tidak terbaca — kemungkinan format invoice ini berbeda. Mau bagaimana?", pilihan: opts });
      return out;
    }
    var perluTotal = !h.totalCocok && h.totalTagihanTerbaca, adaTanyaHarga = false, tanpaKode = [], kodeAda = [], kodeSeen = {};
    var refTgl = h.tanggal || hariIni();
    for (i = 0; i < h.rows.length; i++) {
      var r = h.rows[i], nr = "#" + (i + 1) + " (SJ " + (r.noSJ || "?") + ")";
      add(qTanggal(r.tglKirim, refTgl, -60, 45, "row", "tglKirim", i, "Tgl kirim baris " + nr));
      if (r.hargaKoreksi) {
        adaTanyaHarga = true;
        add({
          id: "row|harga|" + i, teks: "Harga baris " + nr + " terbaca " + rpf(r.hargaTerbaca) + ", saya koreksi ke " + rpf(r.harga) + " supaya cocok dengan total di kertas. Pakai yang mana?",
          pilihan: [
            { label: rpf(r.harga) + " (hasil koreksi)", set: [] },
            { label: rpf(r.hargaTerbaca) + " (seperti terbaca)", set: [{ scope: "row", field: "harga", row: i, value: r.hargaTerbaca }] }
          ]
        });
      } else if (!r.harga || (perluTotal && r.warn && r.warn.length)) {
        var kh = kandidatHarga(h, r, ctx.prices);
        if (kh.length >= (r.harga ? 2 : 1)) {
          adaTanyaHarga = true;
          opts = [];
          for (k = 0; k < kh.length; k++) opts.push({ label: rpf(kh[k]) + (kh[k] === r.harga ? " (terbaca)" : ""), set: [{ scope: "row", field: "harga", row: i, value: kh[k] }] });
          add({ id: "row|harga|" + i, teks: (r.harga ? "Total di kertas tidak cocok. " : "Harga tidak terbaca. ") + "Harga/m³ baris " + nr + " yang benar?", pilihan: opts });
        }
      }
      if (!(r.panjang && r.lebar && r.tinggi) && r.m3Terbaca > 0) {
        add({
          id: "row|m3|" + i, teks: "Baris " + nr + ": ukuran P-L-T tidak terbaca, tapi M3 di kertas " + r.m3Terbaca.toFixed(3) + ". Pakai M3 itu langsung?",
          pilihan: [
            { label: "Pakai M3 " + r.m3Terbaca.toFixed(3), set: [{ scope: "row", field: "m3Manual", row: i, value: r.m3Terbaca }] },
            { label: "Saya isi ukuran sendiri", set: [] }
          ]
        });
      }
      if (r.longgar) {
        add({
          id: "row|longgar|" + i, teks: "Baris " + nr + " formatnya tidak biasa, terbaca harga " + rpf(r.harga) + (r.m3Terbaca ? ", M3 " + r.m3Terbaca.toFixed(3) : "") + ". Sudah benar?",
          pilihan: [{ label: "Ya, benar", set: [] }, { label: "Hapus baris ini", aksi: "hapusBaris", row: i, set: [] }]
        });
      }
      if (r.kode) { if (!kodeSeen[r.kode]) { kodeSeen[r.kode] = 1; kodeAda.push(r.kode); } } else tanpaKode.push(i);
    }
    if (kodeAda.length && tanpaKode.length && !ctx.jenisDefault) {
      opts = [];
      for (k = 0; k < kodeAda.length && k < 3; k++) {
        var kd = kodeAda[k], sets = [];
        for (i = 0; i < tanpaKode.length; i++) sets.push({ scope: "row", field: "kode", row: tanpaKode[i], value: kd });
        opts.push({ label: "Semua → " + (BY_KODE[kd] ? spasiNama(BY_KODE[kd].nama) + " / " : "") + kd, set: sets });
      }
      opts.push({ label: "Biarkan kosong", set: [] });
      add({ id: "form|kode", teks: tanpaKode.length + " baris tidak punya kode barang di kertas. Samakan dengan baris lain?", pilihan: opts });
    }
    if (perluTotal && !adaTanyaHarga) {
      opts = [{ label: "Tambah baris yang terlewat", aksi: "tambah", set: [] }];
      if (ctx.ai) opts.push({ label: "Baca ulang pakai AI", aksi: "ai", set: [] });
      opts.push({ label: "Foto ulang lebih dekat", aksi: "foto", set: [] });
      opts.push({ label: "Lanjut saja, nanti saya cek", set: [] });
      add({ id: "form|total", teks: "Total di kertas " + rpf(h.totalTagihanTerbaca) + " tidak sama dengan hitungan " + rpf(h.totalTagihan) + ". Kemungkinan ada baris terlewat/salah baca.", pilihan: opts });
    }
    return out;
  }

  return {
    buatPertanyaan: buatPertanyaan,
    binarize: binarize, quality: quality,
    parseSuratJalan: parseSuratJalan, parseInvoice: parseInvoice, fromAi: fromAi,
    finalizeRow: finalizeRow, sumInvoice: sumInvoice, reconcileHarga: reconcileHarga,
    matchCustomer: matchCustomer, scoreResult: scoreResult, hitungM3: hitungM3, similarity: similarity, fmt: fmt,
    setMaster: setMaster, resolveJenis: resolveJenis, jenisDariKode: jenisDariKode, spasiNama: spasiNama, fixKode: fixKode
  };
});
