// print.js
// Port dari frontend/src/services/print.js (aplikasi Vue), logikanya
// PERSIS SAMA (posisi field, ukuran kertas, dsb ikut data kalibrasi yang
// sama dari /api/print-calib) supaya hasil cetakan dari PC gudang identik
// dengan yang sudah dikalibrasi di aplikasi utama. Ditulis ulang tanpa
// optional chaining "?." / object spread "..." supaya jalan di Firefox 52 ESR.
//
// Catatan penting soal PC Windows XP + printer dot matrix continuous form:
// window.open() + document.write() + window.print() adalah API browser yang
// sudah ada sejak lama sekali, jadi ini bagian paling aman dari sisi
// kompatibilitas. Yang perlu dicek di lapangan adalah apakah driver
// printer dot matrix-nya masih terpasang & jadi default printer di PC itu.

function fmtDateShortPrint(v) {
  if (!v) return "-";
  var d = new Date(v);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtDatePrint(v) {
  if (!v) return "-";
  var d = new Date(v);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function getSignerName() {
  return api.get("/settings")
    .then(function (s) { return (s && s.signerName) ? s.signerName : ""; })
    .catch(function () { return ""; });
}

function openPrint(html) {
  var w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Cetak BMS</title></head><body>' + html + '</body></html>');
  w.document.close();
  w.focus();
  setTimeout(function () { w.print(); }, 250);
}

// ============================================================
// CETAK SURAT JALAN (di atas kertas continuous form berlubang yang
// sudah ada cetakan tetapnya - posisi field ikut Kalibrasi Cetak yang
// sudah diatur di aplikasi utama)
//
// "sjOrList" boleh satu objek Surat Jalan, ATAU array berisi beberapa
// Surat Jalan sekaligus (misalnya hasil simpan dengan "Jumlah Surat
// Jalan" > 1: kalau isi 1 ya tercetak 1, kalau isi 5 ya tercetak 5,
// dst - mengikuti jumlah yang dimasukkan). Semua dicetak dalam SATU
// kali klik tombol Cetak / SATU dialog print browser (tidak perlu
// klik cetak satu per satu lagi), masing-masing halaman nomornya
// beda sesuai data.
// ============================================================
function printSJ(sjOrList) {
  var list = isArrayPrint(sjOrList) ? sjOrList : [sjOrList];
  if (!list.length) return Promise.resolve();

  return Promise.all([api.get("/print-calib"), getSignerName()]).then(function (results) {
    var calib = results[0];
    var signerName = results[1];
    var c = calib.sj;
    var ox = Number(c.offsetX || 0);
    var oy = Number(c.offsetY || 0);
    var f = c.fields || {};

    function pos(k, defX, defY, defSize) {
      var fk = f[k] || {};
      return {
        x: Number(fk.x !== undefined ? fk.x : defX) + ox,
        y: Number(fk.y !== undefined ? fk.y : defY) + oy,
        size: Number(fk.size !== undefined ? fk.size : defSize)
      };
    }

    var p = {
      apDari: pos("apDari", 8, 10, 10),
      penerima: pos("penerima", 8, 18, 10),
      no: pos("no", 175, 30, 11),
      tanggal: pos("tanggal", 175, 38, 11),
      jam: pos("jam", 175, 46, 11),
      tujuan: pos("tujuan", 8, 26, 10),
      jenis: pos("jenisBarang", 8, 34, 10),
      nopol: pos("nopol", 14, 62, 13),
      bak: pos("ukuranBak", 90, 62, 13),
      m3: pos("m3", 200, 62, 13),
      sopir: pos("sopirNama", 150, 98, 11),
      hormat: pos("hormatKamiNama", 226, 102, 11)
    };

    // Label yang ditulis di depan tiap nilai (kertas SJ tidak ada label
    // "Nomor :", "Tanggal :", dst tercetak - jadi labelnya ikut ditulis
    // software supaya jelas kolom mana isinya apa, sama seperti contoh
    // yang diminta).
    var LBL = {
      apDari: "A/P Dari",
      penerima: "Penerima",
      no: "Nomor",
      tanggal: "Tanggal",
      jam: "Jam",
      tujuan: "Tujuan",
      jenis: "Jenis Brg"
    };

    function field(key, text, withLabel) {
      var t = withLabel ? (LBL[key] + " : " + (text || "-")) : text;
      return '<div class="f" style="left:' + p[key].x + 'mm;top:' + p[key].y + 'mm;font-size:' + p[key].size + 'pt">' + escapeHtml(t) + '</div>';
    }

    var sheetsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var sj = list[i];
      var namaCustomer = sj.customer
        ? (sj.customer.nama + (sj.customer.kode ? (" / " + sj.customer.kode) : ""))
        : "-";
      var namaPenerima = sj.penerima || (sj.customer ? sj.customer.nama : "") || "-";
      var panjang = Number(sj.panjang || 0);
      var lebar = Number(sj.lebar || 0);
      var tinggi = Number(sj.tinggi || 0);
      var ukuran = (panjang > 0 || lebar > 0 || tinggi > 0) ? (panjang.toFixed(2) + " - " + lebar.toFixed(2) + " - " + tinggi.toFixed(3)) : "";
      var tujuanText = sj.tujuan || (sj.customer ? sj.customer.alamat : "") || "";
      var isLast = (i === list.length - 1);

      sheetsHtml +=
        '<div class="sheet"' + (isLast ? "" : ' style="page-break-after:always"') + '>' +
        field("apDari", namaCustomer, true) +
        field("penerima", namaPenerima, true) +
        field("no", sj.no, true) +
        field("tanggal", fmtDateShortPrint(sj.tanggal), true) +
        field("jam", sj.jam || "", true) +
        field("tujuan", tujuanText, true) +
        field("jenis", sj.jenisBarang || "", true) +
        field("nopol", sj.noPolisi || (sj.armada ? sj.armada.nopol : "") || "") +
        field("bak", ukuran) +
        field("m3", Number(sj.m3 || 0) > 0 ? Number(sj.m3).toFixed(3) : "") +
        field("sopir", sj.sopir || (sj.armada ? sj.armada.sopir : "") || "") +
        field("hormat", signerName) +
        '</div>';
    }

    openPrint(
      '<style>' +
      '@page{size:' + c.w + 'mm ' + c.h + 'mm;margin:0}' +
      'html,body{margin:0;padding:0;width:' + c.w + 'mm}' +
      '*{box-sizing:border-box}' +
      '.sheet{position:relative;width:' + c.w + 'mm;height:' + c.h + 'mm;background:#fff;font-family:"Courier New",Courier,monospace;color:#111}' +
      '.f{position:absolute;white-space:nowrap;font-family:"Courier New",Courier,monospace}' +
      '</style>' +
      sheetsHtml
    );
  });
}

// Firefox 52 ESR/XP-safe check (hindari Array.isArray jika perlu, tapi
// Array.isArray sudah didukung sejak lama jadi aman dipakai langsung).
function isArrayPrint(v) {
  return Object.prototype.toString.call(v) === "[object Array]";
}

// ============================================================
// CETAK INVOICE (di atas kop surat / letterhead yang sudah tercetak -
// posisi ikut Kalibrasi Cetak yang sama)
// ============================================================
function printInvoice(inv) {
  return Promise.all([api.get("/print-calib"), getSignerName()]).then(function (results) {
    var calib = results[0];
    var signerName = results[1];
    var c = calib.inv;

    var rowsHtml = "";
    for (var i = 0; i < inv.items.length; i++) {
      var it = inv.items[i];
      var sj = it.suratJalan;
      var pltText = sj
        ? (Number(sj.panjang || 0).toFixed(2) + " " + Number(sj.lebar || 0).toFixed(2) + " " + Number(sj.tinggi || 0).toFixed(2))
        : (it.qty + " " + (it.satuan || ""));
      var m3Text = sj ? Number(sj.m3 || 0).toFixed(3) : Number(it.qty).toFixed(3);

      rowsHtml += '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + (sj ? escapeHtml(fmtDateShortPrint(sj.tanggal)) : "-") + '</td>' +
        '<td>' + (sj ? escapeHtml(sj.no) : "-") + '</td>' +
        '<td>' + (sj ? escapeHtml(sj.sopir || (sj.armada ? sj.armada.sopir : "") || "") : "") + '</td>' +
        '<td class="left">' + (sj ? escapeHtml(sj.tujuan) : escapeHtml(it.keterangan)) + '</td>' +
        '<td>' + escapeHtml(pltText) + '</td>' +
        '<td>' + m3Text + '</td>' +
        '<td class="num">' + rupiah(it.hargaSatuan) + '</td>' +
        '<td class="num">' + rupiah(it.qty * it.hargaSatuan) + '</td>' +
        '</tr>';
    }

    var total = inv.total !== undefined ? inv.total : 0;
    var totalM3 = 0;
    for (var j = 0; j < inv.items.length; j++) {
      totalM3 += Number(inv.items[j].suratJalan ? inv.items[j].suratJalan.m3 : 0) || 0;
    }
    var top = Number(c.topMargin || 36) + Number(c.offsetY || 0);
    var left = Number(c.offsetX || 0);
    var custNama = inv.customer ? inv.customer.nama : "";
    var custAlamat = inv.customer ? inv.customer.alamat : "";
    var custKode = inv.customer ? inv.customer.kode : "-";

    openPrint(
      '<style>' +
      '@page{size:' + c.w + 'mm ' + c.h + 'mm;margin:0}' +
      'html,body{margin:0;padding:0;width:' + c.w + 'mm;height:' + c.h + 'mm}' +
      '.sheet{position:relative;width:' + c.w + 'mm;height:' + c.h + 'mm;padding:' + top + 'mm 8mm 6mm ' + (8 + left) + 'mm;font:10.5pt "Courier New",Courier,monospace;color:#111;line-height:1.35}' +
      '.head{display:flex;justify-content:space-between;margin-bottom:4mm}' +
      '.head .right{text-align:right}' +
      '.label{font-size:9.5pt;color:#555}' +
      '.val{font-weight:700}' +
      '.idrow{margin:3mm 0 5mm}' +
      '.idrow div{margin-bottom:1.5mm}' +
      '.idrow .label{display:inline-block;width:34mm}' +
      '.tbl{border-collapse:collapse;width:100%;font-size:9.5pt}' +
      '.tbl th,.tbl td{border:1px solid #111;padding:1.8mm;text-align:center}' +
      '.tbl th{background:#eee}' +
      '.tbl td.left{text-align:left}' +
      '.tbl td.num{text-align:right}' +
      '.bottom{display:flex;justify-content:space-between;margin-top:3mm}' +
      '.sign{text-align:center;margin-top:9mm;margin-left:auto;width:48mm}' +
      '.signline{border-top:1px solid #111;padding-top:1.5mm;margin-top:14mm}' +
      '.note{font-size:7.5pt;margin-top:2mm}' +
      '.totalbox td{border:1px solid #111;padding:1.5mm 3mm}' +
      '</style>' +
      '<div class="sheet">' +
      '<div class="head">' +
      '<div><div class="label">Kepada Yth</div><div class="val">' + escapeHtml(custNama) + '</div><div>' + escapeHtml(custAlamat) + '</div></div>' +
      '<div class="right"><div class="label">Halaman</div><div class="val">' + escapeHtml(inv.halaman !== undefined ? inv.halaman : 1) + '</div>' +
      '<div class="label" style="margin-top:2mm">No. Invoice</div><div class="val">' + escapeHtml(inv.no) + '</div>' +
      '<div class="label" style="margin-top:2mm">Tanggal</div><div class="val">' + escapeHtml(fmtDateShortPrint(inv.tanggal)) + '</div></div>' +
      '</div>' +
      '<div class="idrow">' +
      '<div><span class="label">Kode Customer</span> : <b>' + escapeHtml(custKode || "-") + '</b></div>' +
      '<div><span class="label">Nama Customer</span> : <b>' + escapeHtml(custNama || "-") + '</b></div>' +
      '<div><span class="label">Alamat</span> : <b>' + escapeHtml(custAlamat || "-") + '</b></div>' +
      '</div>' +
      '<table class="tbl">' +
      '<tr><th>No</th><th>Tgl Kirim</th><th>No SJ</th><th>Sopir</th><th>Alamat Kirim</th><th>P L T</th><th>M3</th><th>Harga</th><th>Jumlah</th></tr>' +
      rowsHtml +
      '</table>' +
      '<div class="bottom">' +
      '<div><b>Total M3:</b> ' + totalM3.toFixed(3) +
      '<div class="note"><b>Terbilang:</b> ' + escapeHtml(terbilang(total)) + ' Rupiah</div>' +
      (inv.catatan ? ('<div class="note"><b>Catatan:</b> ' + escapeHtml(inv.catatan) + '</div>') : "") +
      '</div>' +
      '<table class="tbl totalbox" style="width:62mm">' +
      '<tr><td><b>Jumlah Total Tagihan</b></td><td class="num"><b>' + rupiah(total) + '</b></td></tr>' +
      '<tr><td>Sudah Dibayar</td><td class="num">' + rupiah(inv.dibayar) + '</td></tr>' +
      '<tr><td>Sisa</td><td class="num">' + rupiah(inv.sisaTagihan) + '</td></tr>' +
      '</table>' +
      '</div>' +
      '<div class="sign">Jakarta, ' + escapeHtml(fmtDatePrint(inv.tanggal)) +
      '<div class="signline">' + escapeHtml(signerName || "Hormat Kami") + '</div></div>' +
      '</div>'
    );
  });
}

// Kertas kosong (blanko) Surat Jalan - dipakai di halaman Kalibrasi Cetak
// untuk mencocokkan kertas yang BELUM ada cetakan tetapnya. Kalau kertas
// kamu SUDAH ada cetakan judul "SURAT JALAN" dsb bawaan pabrik, cukup pakai
// "Cetak Contoh Data" saja (jangan pakai blanko ini) supaya tidak dobel.
function printSJBlank() {
  openPrint(
    '<style>' +
    '@page{size:241.3mm 108mm;margin:0}' +
    'html,body{margin:0;padding:0;width:241.3mm;height:108mm}' +
    '.blank{width:241.3mm;height:108mm;font:10pt Arial;padding:7mm}' +
    '.title{text-align:center;font-size:17pt;font-weight:700;border:2px solid #111;padding:2mm;margin-bottom:4mm}' +
    '.head{display:flex;justify-content:space-between}' +
    '.line{border-bottom:1px solid #777;min-height:5mm}' +
    '.grid{margin-top:4mm;border-collapse:collapse;width:100%}' +
    '.grid td,.grid th{border:1px solid #111;padding:2mm}' +
    '.sign{display:flex;justify-content:space-between;margin-top:16mm;text-align:center}' +
    '.sign>div{width:30%}' +
    '.sign .u{border-top:1px solid #111;padding-top:2mm}' +
    '</style>' +
    '<div class="blank">' +
    '<div class="title">SURAT JALAN</div>' +
    '<div class="head">' +
    '<div>A/P Dari &amp; Penerima<div class="line" style="width:75mm"></div></div>' +
    '<div>Nomor<div class="line" style="width:40mm"></div>Tanggal<div class="line" style="width:40mm"></div>Jam<div class="line" style="width:40mm"></div></div>' +
    '</div>' +
    '<div style="margin-top:4mm">Tujuan: <span class="line" style="display:inline-block;width:125mm"></span></div>' +
    '<div style="margin-top:3mm">Jenis Barang: <span class="line" style="display:inline-block;width:85mm"></span></div>' +
    '<table class="grid">' +
    '<tr><th>Nomor Polisi</th><th>Ukuran Bak (P-L-T)</th><th>M3</th></tr>' +
    '<tr><td style="height:10mm"></td><td></td><td></td></tr>' +
    '</table>' +
    '<div style="font-size:8pt;margin-top:2mm">' +
    'Perhatian: Pengisian material dilakukan sesuai dengan ukuran bak mobil (rata bak).<br/>' +
    'Kami tidak bertanggung jawab setelah material tersebut telah diterima.' +
    '</div>' +
    '<div class="sign">' +
    '<div><div class="u">Yang Menerima,</div></div>' +
    '<div><div class="u">Supir,</div></div>' +
    '<div><div class="u">Hormat kami,</div></div>' +
    '</div>' +
    '</div>'
  );
}

// Kotak bantu grid 5mm - dicetak di atas kertas asli untuk mengukur posisi
// (pakai penggaris) sebelum mengisi angka X/Y di halaman Kalibrasi Cetak.
function printGrid(w, h) {
  var v = "", g = "";
  for (var x = 0; x <= w; x += 5) v += '<i style="left:' + x + 'mm"></i>';
  for (var y = 0; y <= h; y += 5) g += '<b style="top:' + y + 'mm"></b>';
  openPrint(
    '<style>' +
    '@page{size:' + w + 'mm ' + h + 'mm;margin:0}' +
    'html,body{margin:0}' +
    '.grid{position:relative;width:' + w + 'mm;height:' + h + 'mm}' +
    '.grid i,.grid b{position:absolute;background:#aab4bf}' +
    '.grid i{top:0;bottom:0;width:.15mm}' +
    '.grid b{left:0;right:0;height:.15mm}' +
    '</style>' +
    '<div class="grid">' + v + g + '</div>'
  );
}

function terbilang(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return "Nol";
  var s = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"];
  function f(x) {
    if (x < 12) return s[x];
    if (x < 20) return f(x - 10) + " Belas";
    if (x < 100) return f(Math.floor(x / 10)) + " Puluh" + (x % 10 ? " " + f(x % 10) : "");
    if (x < 200) return "Seratus" + (x % 100 ? " " + f(x % 100) : "");
    if (x < 1000) return f(Math.floor(x / 100)) + " Ratus" + (x % 100 ? " " + f(x % 100) : "");
    if (x < 2000) return "Seribu" + (x % 1000 ? " " + f(x % 1000) : "");
    if (x < 1e6) return f(Math.floor(x / 1000)) + " Ribu" + (x % 1000 ? " " + f(x % 1000) : "");
    if (x < 1e9) return f(Math.floor(x / 1e6)) + " Juta" + (x % 1e6 ? " " + f(x % 1e6) : "");
    return f(Math.floor(x / 1e9)) + " Miliar" + (x % 1e9 ? " " + f(x % 1e9) : "");
  }
  return f(n);
}
