// print.js
// Port dari frontend/src/services/print.js (aplikasi Vue), logikanya
// tetap menggunakan data kalibrasi dari /api/print-calib.
//
// Penting:
// - Ukuran kertas TIDAK di-hardcode untuk Surat Jalan dan Invoice.
// - Ukuran tetap diambil dari menu Kalibrasi Cetak:
//      calib.sj.w / calib.sj.h
//      calib.inv.w / calib.inv.h
// - Posisi field Surat Jalan tetap mengikuti fields dari kalibrasi.
// - offsetX dan offsetY tetap berfungsi.
// - Banyak Surat Jalan tetap bisa dicetak dalam SATU dialog print.
// - Tidak ada logika utama yang dihapus.


// ============================================================
// FORMAT TANGGAL PENDEK
// ============================================================

function fmtDateShortPrint(v) {
  if (!v) return "-";

  var d = new Date(v);

  return d.toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    }
  );
}


// ============================================================
// FORMAT TANGGAL PANJANG
// ============================================================

function fmtDatePrint(v) {
  if (!v) return "-";

  var d = new Date(v);

  return d.toLocaleDateString(
    "id-ID",
    {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  );
}


// ============================================================
// AMBIL NAMA PENANDATANGAN
// ============================================================

function getSignerName() {
  return api.get("/settings")
    .then(function (s) {
      return (s && s.signerName)
        ? s.signerName
        : "";
    })
    .catch(function () {
      return "";
    });
}


// ============================================================
// BUKA WINDOW CETAK
//
// CSS dasar di sini hanya untuk normalisasi popup.
// CSS ukuran kertas dan layout utama tetap dibuat oleh
// printSJ(), printInvoice(), printSJBlank(), atau printGrid().
// ============================================================

function openPrint(html) {

  var w = window.open(
    "",
    "_blank",
    "width=1000,height=800"
  );

  if (!w) return;


  w.document.write(

    '<!doctype html>' +

    '<html>' +

    '<head>' +

    '<meta charset="utf-8">' +

    '<title>Cetak BMS</title>' +

    '<style>' +

    // Hilangkan margin bawaan browser.
    '@page{' +
      'margin:0;' +
    '}' +

    'html,body{' +
      'margin:0;' +
      'padding:0;' +
    '}' +

    '*{' +
      'box-sizing:border-box;' +
    '}' +

    // Font fallback yang aman untuk Windows lama.
    // Courier New tetap dipakai karena kemungkinan besar tersedia
    // di Windows XP / Windows lama.
    'body{' +
      'font-family:"Courier New",Courier,monospace;' +
      'font-kerning:none;' +
      'text-rendering:auto;' +
    '}' +

    '</style>' +

    '</head>' +

    '<body>' +

    html +

    '</body>' +

    '</html>'
  );


  w.document.close();

  w.focus();


  setTimeout(function () {
    w.print();
  }, 250);
}


// ============================================================
// CETAK SURAT JALAN
//
// "sjOrList" boleh:
// - satu Surat Jalan
// - array beberapa Surat Jalan
//
// Jika jumlah Surat Jalan lebih dari 1:
// semua masuk dalam SATU dialog print.
//
// Ukuran kertas:
// mengikuti c.w dan c.h dari /api/print-calib.
//
// Posisi field:
// mengikuti c.fields.
// ============================================================

function printSJ(sjOrList) {

  var list = isArrayPrint(sjOrList)
    ? sjOrList
    : [sjOrList];


  if (!list.length) {
    return Promise.resolve();
  }


  return Promise.all([
    api.get("/print-calib"),
    getSignerName()
  ])
  .then(function (results) {


    var calib = results[0];

    var signerName = results[1];


    var c = calib.sj;


    var ox = Number(c.offsetX || 0);

    var oy = Number(c.offsetY || 0);


    var f = c.fields || {};


    // --------------------------------------------------------
    // AMBIL POSISI DARI KALIBRASI
    //
    // Jika posisi field sudah ada di menu kalibrasi:
    // pakai posisi tersebut.
    //
    // Jika belum ada:
    // gunakan default.
    //
    // offsetX / offsetY tetap ditambahkan.
    // --------------------------------------------------------

    function pos(k, defX, defY, defSize) {

      var fk = f[k] || {};


      return {

        x:

          Number(
            fk.x !== undefined
              ? fk.x
              : defX
          ) + ox,


        y:

          Number(
            fk.y !== undefined
              ? fk.y
              : defY
          ) + oy,


        size:

          Number(
            fk.size !== undefined
              ? fk.size
              : defSize
          )

      };
    }


    // --------------------------------------------------------
    // POSISI DEFAULT SURAT JALAN
    //
    // Posisi ini hanya dipakai jika field belum tersimpan
    // di menu Kalibrasi Cetak.
    //
    // Jadi jika kamu sudah mengatur:
    // c.fields.nopol.x
    // c.fields.nopol.y
    // dst...
    //
    // nilai dari menu kalibrasi yang dipakai.
    // --------------------------------------------------------

    var p = {


      apDari:

        pos(
          "apDari",
          8,
          10,
          10
        ),


      penerima:

        pos(
          "penerima",
          8,
          18,
          10
        ),


      no:

        pos(
          "no",
          175,
          30,
          11
        ),


      tanggal:

        pos(
          "tanggal",
          175,
          38,
          11
        ),


      jam:

        pos(
          "jam",
          175,
          46,
          11
        ),


      tujuan:

        pos(
          "tujuan",
          8,
          26,
          10
        ),


      jenis:

        pos(
          "jenisBarang",
          8,
          34,
          10
        ),


      nopol:

        pos(
          "nopol",
          14,
          62,
          13
        ),


      bak:

        pos(
          "ukuranBak",
          90,
          62,
          13
        ),


      m3:

        pos(
          "m3",
          200,
          62,
          13
        ),


      sopir:

        pos(
          "sopirNama",
          150,
          98,
          11
        ),


      hormat:

        pos(
          "hormatKamiNama",
          226,
          102,
          11
        )

    };


    // --------------------------------------------------------
    // LABEL SURAT JALAN
    // --------------------------------------------------------

    var LBL = {

      apDari:
        "A/P Dari",

      penerima:
        "Penerima",

      no:
        "Nomor",

      tanggal:
        "Tanggal",

      jam:
        "Jam",

      tujuan:
        "Tujuan",

      jenis:
        "Jenis Brg"

    };


    // --------------------------------------------------------
    // CETAK SATU FIELD
    //
    // Untuk field yang memakai label:
    //
    // A/P Dari : xxx
    //
    // Untuk field tanpa label:
    //
    // hanya isi datanya.
    // --------------------------------------------------------

    function field(key, text, withLabel) {


      var t = withLabel

        ? (

            LBL[key] +

            " : " +

            (text || "-")

          )

        : text;


      return (

        '<div class="f sj-field" style="' +

        'left:' +
        p[key].x +
        'mm;' +

        'top:' +
        p[key].y +
        'mm;' +

        'font-size:' +
        p[key].size +
        'pt;' +

        '">' +

        escapeHtml(t) +

        '</div>'

      );

    }


    // --------------------------------------------------------
    // BUAT SEMUA HALAMAN SURAT JALAN
    // --------------------------------------------------------

    var sheetsHtml = "";


    for (
      var i = 0;
      i < list.length;
      i++
    ) {


      var sj = list[i];


      var namaCustomer =

        sj.customer

          ? (

              sj.customer.nama +

              (

                sj.customer.kode

                  ? (
                      " / " +
                      sj.customer.kode
                    )

                  : ""

              )

            )

          : "-";


      var namaPenerima =

        sj.penerima ||

        (

          sj.customer

            ? sj.customer.nama

            : ""

        ) ||

        "-";


      var panjang =
        Number(sj.panjang || 0);


      var lebar =
        Number(sj.lebar || 0);


      var tinggi =
        Number(sj.tinggi || 0);


      var ukuran =

        (

          panjang > 0 ||

          lebar > 0 ||

          tinggi > 0

        )

          ? (

              panjang.toFixed(2) +

              " - " +

              lebar.toFixed(2) +

              " - " +

              tinggi.toFixed(3)

            )

          : "";


      var tujuanText =

        sj.tujuan ||

        (

          sj.customer

            ? sj.customer.alamat

            : ""

        ) ||

        "";


      var isLast =

        i === list.length - 1;


      sheetsHtml +=


        '<div class="sheet sj-sheet"' +


        (

          isLast

            ? ""

            : (
                ' style="page-break-after:always;' +
                'break-after:page;"'
              )

        ) +


        '>' +


        field(
          "apDari",
          namaCustomer,
          true
        ) +


        field(
          "penerima",
          namaPenerima,
          true
        ) +


        field(
          "no",
          sj.no,
          true
        ) +


        field(
          "tanggal",
          fmtDateShortPrint(sj.tanggal),
          true
        ) +


        field(
          "jam",
          sj.jam || "",
          true
        ) +


        field(
          "tujuan",
          tujuanText,
          true
        ) +


        field(
          "jenis",
          sj.jenisBarang || "",
          true
        ) +


        field(

          "nopol",

          sj.noPolisi ||

          (

            sj.armada

              ? sj.armada.nopol

              : ""

          ) ||

          ""

        ) +


        field(
          "bak",
          ukuran
        ) +


        field(

          "m3",

          Number(sj.m3 || 0) > 0

            ? Number(sj.m3).toFixed(3)

            : ""

        ) +


        field(

          "sopir",

          sj.sopir ||

          (

            sj.armada

              ? sj.armada.sopir

              : ""

          ) ||

          ""

        ) +


        field(
          "hormat",
          signerName
        ) +


        '</div>';

    }


    // --------------------------------------------------------
    // SATU WINDOW / SATU DIALOG PRINT
    // --------------------------------------------------------

    openPrint(


      '<style>' +


      '@page{' +

        'size:' +
        c.w +
        'mm ' +
        c.h +
        'mm;' +

        'margin:0;' +

      '}' +


      'html,body{' +

        'margin:0;' +

        'padding:0;' +

        'width:' +
        c.w +
        'mm;' +

      '}' +


      '*{' +

        'box-sizing:border-box;' +

      '}' +


      '.sj-sheet{' +

        'position:relative;' +

        'width:' +
        c.w +
        'mm;' +

        'height:' +
        c.h +
        'mm;' +

        'min-height:' +
        c.h +
        'mm;' +

        'max-height:' +
        c.h +
        'mm;' +

        'overflow:hidden;' +

        'background:#fff;' +

        // Tetap memakai Courier New agar aman
        // di Windows XP / Firefox ESR.
        'font-family:"Courier New",Courier,monospace;' +

        // Sedikit direnggangkan.
        'letter-spacing:0.15pt;' +

        'color:#111;' +

      '}' +


      '.sj-field{' +

        'position:absolute;' +

        'white-space:nowrap;' +

        'font-family:"Courier New",Courier,monospace;' +

        // Tidak terlalu besar agar tidak mengubah
        // lebar koordinat field secara drastis.
        'letter-spacing:0.15pt;' +

        'line-height:1.2;' +

        'font-kerning:none;' +

      '}' +


      '</style>' +


      sheetsHtml

    );

  });

}


// ============================================================
// CEK ARRAY
// ============================================================

function isArrayPrint(v) {

  return Object.prototype.toString.call(v)

    === "[object Array]";

}


// ============================================================
// CETAK INVOICE
//
// Ukuran kertas tetap:
// c.w dan c.h dari Kalibrasi Cetak.
//
// topMargin tetap dipakai.
// offsetX dan offsetY tetap dipakai.
//
// Tujuan perbaikan:
// - Mengurangi kemungkinan pecah 2 halaman.
// - Membuat tabel memenuhi area lebar invoice.
// - Font lebih lega.
// - Tidak memakai ukuran kertas hardcode.
// ============================================================

function printInvoice(inv) {


  return Promise.all([

    api.get("/print-calib"),

    getSignerName()

  ])
  .then(function (results) {


    var calib =
      results[0];


    var signerName =
      results[1];


    var c =
      calib.inv;


    var rowsHtml = "";


    // --------------------------------------------------------
    // BUAT BARIS INVOICE
    // --------------------------------------------------------

    for (
      var i = 0;
      i < inv.items.length;
      i++
    ) {


      var it =
        inv.items[i];


      var sj =
        it.suratJalan;


      var pltText =

        sj

          ? (

              Number(
                sj.panjang || 0
              ).toFixed(2) +

              " " +

              Number(
                sj.lebar || 0
              ).toFixed(2) +

              " " +

              Number(
                sj.tinggi || 0
              ).toFixed(2)

            )

          : (

              it.qty +

              " " +

              (
                it.satuan || ""
              )

            );


      var m3Text =

        sj

          ? Number(
              sj.m3 || 0
            ).toFixed(3)

          : Number(
              it.qty
            ).toFixed(3);


      rowsHtml +=


        '<tr>' +


        '<td class="col-no">' +

        (i + 1) +

        '</td>' +


        '<td class="col-tgl">' +

        (

          sj

            ? escapeHtml(
                fmtDateShortPrint(
                  sj.tanggal
                )
              )

            : "-"

        ) +

        '</td>' +


        '<td class="col-sj">' +

        (

          sj

            ? escapeHtml(
                sj.no
              )

            : "-"

        ) +

        '</td>' +


        '<td class="col-sopir">' +

        (

          sj

            ? escapeHtml(

                sj.sopir ||

                (

                  sj.armada

                    ? sj.armada.sopir

                    : ""

                ) ||

                ""

              )

            : ""

        ) +

        '</td>' +


        '<td class="left col-alamat">' +

        (

          sj

            ? escapeHtml(
                sj.tujuan
              )

            : escapeHtml(
                it.keterangan
              )

        ) +

        '</td>' +


        '<td class="col-plt">' +

        escapeHtml(
          pltText
        ) +

        '</td>' +


        '<td class="col-m3">' +

        m3Text +

        '</td>' +


        '<td class="num col-harga">' +

        rupiah(
          it.hargaSatuan
        ) +

        '</td>' +


        '<td class="num col-jumlah">' +

        rupiah(
          it.qty *
          it.hargaSatuan
        ) +

        '</td>' +


        '</tr>';

    }


    // --------------------------------------------------------
    // TOTAL
    // --------------------------------------------------------

    var total =

      inv.total !== undefined

        ? inv.total

        : 0;


    var totalM3 =
      0;


    for (
      var j = 0;
      j < inv.items.length;
      j++
    ) {


      totalM3 +=


        Number(

          inv.items[j].suratJalan

            ? inv.items[j]
                .suratJalan
                .m3

            : 0

        ) ||

        0;

    }


    // --------------------------------------------------------
    // POSISI AWAL INVOICE
    //
    // topMargin tetap dari Kalibrasi Cetak.
    //
    // Kamu sebelumnya mengukur:
    // 3,3 cm dari atas = 33 mm.
    //
    // Jadi jika di Kalibrasi Cetak topMargin = 33,
    // kode ini otomatis memakai 33 mm.
    // --------------------------------------------------------

    var top =

      Number(
        c.topMargin || 33
      ) +

      Number(
        c.offsetY || 0
      );


    var left =

      Number(
        c.offsetX || 0
      );


    var custNama =

      inv.customer

        ? inv.customer.nama

        : "";


    var custAlamat =

      inv.customer

        ? inv.customer.alamat

        : "";


    var custKode =

      inv.customer

        ? inv.customer.kode

        : "-";


    // --------------------------------------------------------
    // CETAK INVOICE
    // --------------------------------------------------------

    openPrint(


      '<style>' +


      '@page{' +

        'size:' +
        c.w +
        'mm ' +
        c.h +
        'mm;' +

        'margin:0;' +

      '}' +


      'html,body{' +

        'margin:0;' +

        'padding:0;' +

        'width:' +
        c.w +
        'mm;' +

        'height:' +
        c.h +
        'mm;' +

        'overflow:hidden;' +

      '}' +


      '*{' +

        'box-sizing:border-box;' +

      '}' +


      // ------------------------------------------------------
      // SHEET INVOICE
      // ------------------------------------------------------

      '.invoice-sheet{' +

        'position:relative;' +

        'width:' +
        c.w +
        'mm;' +

        'height:' +
        c.h +
        'mm;' +

        'min-height:' +
        c.h +
        'mm;' +

        'max-height:' +
        c.h +
        'mm;' +

        'overflow:hidden;' +

        // Atas mengikuti kalibrasi.
        'padding:' +

          top +
          'mm ' +

          '4mm ' +

          '4mm ' +

          (4 + left) +
          'mm;' +

        // Font dibuat sedikit lebih lega.
        'font-family:"Courier New",Courier,monospace;' +

        'font-size:9.5pt;' +

        'letter-spacing:0.12pt;' +

        'line-height:1.45;' +

        'font-kerning:none;' +

        'color:#111;' +

      '}' +


      // ------------------------------------------------------
      // HEADER
      // ------------------------------------------------------

      '.invoice-head{' +

        'display:flex;' +

        'justify-content:space-between;' +

        'align-items:flex-start;' +

        'width:100%;' +

        'margin:0 0 2mm 0;' +

      '}' +


      '.invoice-head-left{' +

        'width:58%;' +

        'padding-right:2mm;' +

      '}' +


      '.invoice-head-right{' +

        'width:42%;' +

        'text-align:right;' +

      '}' +


      '.label{' +

        'font-size:8.5pt;' +

        'line-height:1.35;' +

        'letter-spacing:0.08pt;' +

      '}' +


      '.val{' +

        'font-weight:700;' +

        'font-size:9.5pt;' +

        'letter-spacing:0.12pt;' +

        'line-height:1.4;' +

      '}' +


      // ------------------------------------------------------
      // IDENTITAS CUSTOMER
      // ------------------------------------------------------

      '.idrow{' +

        'margin:1.5mm 0 2mm 0;' +

        'font-size:8.8pt;' +

        'line-height:1.4;' +

      '}' +


      '.idrow div{' +

        'margin-bottom:0.8mm;' +

      '}' +


      '.idrow .label{' +

        'display:inline-block;' +

        'width:30mm;' +

      '}' +


      // ------------------------------------------------------
      // TABEL
      //
      // table-layout:fixed memastikan tabel menggunakan
      // seluruh lebar area invoice dan tidak melebar sendiri.
      // ------------------------------------------------------

      '.tbl{' +

        'border-collapse:collapse;' +

        'border-spacing:0;' +

        'width:100%;' +

        'max-width:100%;' +

        'table-layout:fixed;' +

        'font-family:"Courier New",Courier,monospace;' +

        'font-size:7.6pt;' +

        'line-height:1.3;' +

        'letter-spacing:0.04pt;' +

      '}' +


      '.tbl th,.tbl td{' +

        'border:1px solid #111;' +

        'padding:1mm 0.6mm;' +

        'vertical-align:middle;' +

        'text-align:center;' +

        'overflow:hidden;' +

        'word-wrap:break-word;' +

        'overflow-wrap:break-word;' +

      '}' +


      '.tbl th{' +

        'font-weight:700;' +

        'line-height:1.25;' +

      '}' +


      '.tbl td.left{' +

        'text-align:left;' +

      '}' +


      '.tbl td.num{' +

        'text-align:right;' +

        'white-space:nowrap;' +

      '}' +


      // Lebar kolom agar tabel memenuhi seluruh kertas.
      '.col-no{' +
        'width:4%;' +
      '}' +

      '.col-tgl{' +
        'width:10%;' +
      '}' +

      '.col-sj{' +
        'width:10%;' +
      '}' +

      '.col-sopir{' +
        'width:10%;' +
      '}' +

      '.col-alamat{' +
        'width:17%;' +
      '}' +

      '.col-plt{' +
        'width:10%;' +
      '}' +

      '.col-m3{' +
        'width:6%;' +
      '}' +

      '.col-harga{' +
        'width:16%;' +
      '}' +

      '.col-jumlah{' +
        'width:17%;' +
      '}' +


      // ------------------------------------------------------
      // BAGIAN BAWAH
      // ------------------------------------------------------

      '.bottom{' +

        'display:flex;' +

        'justify-content:space-between;' +

        'align-items:flex-start;' +

        'gap:3mm;' +

        'margin-top:2mm;' +

        'width:100%;' +

        'font-size:8pt;' +

        'line-height:1.4;' +

      '}' +


      '.bottom-left{' +

        'width:52%;' +

        'min-width:0;' +

      '}' +


      '.bottom-right{' +

        'width:48%;' +

      '}' +


      '.note{' +

        'font-size:7.4pt;' +

        'line-height:1.4;' +

        'margin-top:1mm;' +

        'word-wrap:break-word;' +

      '}' +


      // ------------------------------------------------------
      // TOTAL BOX
      // ------------------------------------------------------

      '.totalbox{' +

        'width:100%;' +

        'font-size:7.6pt;' +

      '}' +


      '.totalbox td{' +

        'border:1px solid #111;' +

        'padding:1mm 1.5mm;' +

      '}' +


      // ------------------------------------------------------
      // TANDA TANGAN
      //
      // Margin dibuat lebih pendek agar tidak mendorong
      // konten menjadi halaman kedua.
      // ------------------------------------------------------

      '.sign{' +

        'text-align:center;' +

        'margin-top:3mm;' +

        'margin-left:auto;' +

        'width:45mm;' +

        'font-size:8.5pt;' +

        'line-height:1.4;' +

      '}' +


      '.signline{' +

        'border-top:1px solid #111;' +

        'padding-top:1mm;' +

        'margin-top:8mm;' +

        'min-height:4mm;' +

      '}' +


      // ------------------------------------------------------
      // PRINT SAFETY
      //
      // Mencegah sheet invoice pecah secara normal menjadi
      // halaman kedua karena page-break CSS.
      // ------------------------------------------------------

      '@media print{' +

        'html,body{' +

          'width:' +
          c.w +
          'mm!important;' +

          'height:' +
          c.h +
          'mm!important;' +

          'overflow:hidden!important;' +

        '}' +

        '.invoice-sheet{' +

          'page-break-after:avoid;' +

          'break-after:avoid;' +

          'page-break-inside:avoid;' +

          'break-inside:avoid;' +

        '}' +

        '.tbl{' +

          'page-break-inside:avoid;' +

          'break-inside:avoid;' +

        '}' +

      '}' +


      '</style>' +


      '<div class="invoice-sheet">' +


      // ------------------------------------------------------
      // HEADER INVOICE
      // ------------------------------------------------------

      '<div class="invoice-head">' +


      '<div class="invoice-head-left">' +


      '<div class="label">' +
      'Kepada Yth' +
      '</div>' +


      '<div class="val">' +

      escapeHtml(
        custNama
      ) +

      '</div>' +


      '<div>' +

      escapeHtml(
        custAlamat
      ) +

      '</div>' +


      '</div>' +


      '<div class="invoice-head-right">' +


      '<div class="label">' +
      'Halaman' +
      '</div>' +


      '<div class="val">' +

      escapeHtml(

        inv.halaman !== undefined

          ? inv.halaman

          : 1

      ) +

      '</div>' +


      '<div class="label" style="margin-top:1mm">' +

      'No. Invoice' +

      '</div>' +


      '<div class="val">' +

      escapeHtml(
        inv.no
      ) +

      '</div>' +


      '<div class="label" style="margin-top:1mm">' +

      'Tanggal' +

      '</div>' +


      '<div class="val">' +

      escapeHtml(

        fmtDateShortPrint(
          inv.tanggal
        )

      ) +

      '</div>' +


      '</div>' +


      '</div>' +


      // ------------------------------------------------------
      // IDENTITAS CUSTOMER
      // ------------------------------------------------------

      '<div class="idrow">' +


      '<div>' +

      '<span class="label">' +

      'Kode Customer' +

      '</span> : <b>' +

      escapeHtml(
        custKode || "-"
      ) +

      '</b>' +

      '</div>' +


      '<div>' +

      '<span class="label">' +

      'Nama Customer' +

      '</span> : <b>' +

      escapeHtml(
        custNama || "-"
      ) +

      '</b>' +

      '</div>' +


      '<div>' +

      '<span class="label">' +

      'Alamat' +

      '</span> : <b>' +

      escapeHtml(
        custAlamat || "-"
      ) +

      '</b>' +

      '</div>' +


      '</div>' +


      // ------------------------------------------------------
      // TABEL
      // ------------------------------------------------------

      '<table class="tbl">' +


      '<tr>' +

      '<th class="col-no">' +
      'No' +
      '</th>' +

      '<th class="col-tgl">' +
      'Tgl Kirim' +
      '</th>' +

      '<th class="col-sj">' +
      'No SJ' +
      '</th>' +

      '<th class="col-sopir">' +
      'Sopir' +
      '</th>' +

      '<th class="col-alamat">' +
      'Alamat Kirim' +
      '</th>' +

      '<th class="col-plt">' +
      'P L T' +
      '</th>' +

      '<th class="col-m3">' +
      'M3' +
      '</th>' +

      '<th class="col-harga">' +
      'Harga' +
      '</th>' +

      '<th class="col-jumlah">' +
      'Jumlah' +
      '</th>' +

      '</tr>' +


      rowsHtml +


      '</table>' +


      // ------------------------------------------------------
      // BAGIAN TOTAL
      // ------------------------------------------------------

      '<div class="bottom">' +


      '<div class="bottom-left">' +


      '<b>Total M3:</b> ' +

      totalM3.toFixed(3) +


      '<div class="note">' +

      '<b>Terbilang:</b> ' +

      escapeHtml(
        terbilang(total)
      ) +

      ' Rupiah' +

      '</div>' +


      (

        inv.catatan

          ? (

              '<div class="note">' +

              '<b>Catatan:</b> ' +

              escapeHtml(
                inv.catatan
              ) +

              '</div>'

            )

          : ""

      ) +


      '</div>' +


      '<div class="bottom-right">' +


      '<table class="tbl totalbox">' +


      '<tr>' +

      '<td>' +

      '<b>Jumlah Total Tagihan</b>' +

      '</td>' +


      '<td class="num">' +

      '<b>' +

      rupiah(total) +

      '</b>' +

      '</td>' +


      '</tr>' +


      '<tr>' +

      '<td>' +
      'Sudah Dibayar' +
      '</td>' +


      '<td class="num">' +

      rupiah(
        inv.dibayar
      ) +

      '</td>' +


      '</tr>' +


      '<tr>' +

      '<td>' +
      'Sisa' +
      '</td>' +


      '<td class="num">' +

      rupiah(
        inv.sisaTagihan
      ) +

      '</td>' +


      '</tr>' +


      '</table>' +


      '</div>' +


      '</div>' +


      // ------------------------------------------------------
      // TANDA TANGAN
      // ------------------------------------------------------

      '<div class="sign">' +


      'Jakarta, ' +


      escapeHtml(

        fmtDatePrint(
          inv.tanggal
        )

      ) +


      '<div class="signline">' +


      escapeHtml(

        signerName ||
        "Hormat Kami"

      ) +


      '</div>' +


      '</div>' +


      '</div>'

    );

  });

}


// ============================================================
// CETAK BLANKO SURAT JALAN
//
// Fungsi tetap dipertahankan.
// ============================================================

function printSJBlank() {


  openPrint(


    '<style>' +


    '@page{' +

      'size:241.3mm 108mm;' +

      'margin:0;' +

    '}' +


    'html,body{' +

      'margin:0;' +

      'padding:0;' +

      'width:241.3mm;' +

      'height:108mm;' +

    '}' +


    '.blank{' +

      'width:241.3mm;' +

      'height:108mm;' +

      'font-family:Arial,sans-serif;' +

      'font-size:10pt;' +

      'line-height:1.4;' +

      'padding:7mm;' +

      'overflow:hidden;' +

    '}' +


    '.title{' +

      'text-align:center;' +

      'font-size:17pt;' +

      'font-weight:700;' +

      'border:2px solid #111;' +

      'padding:2mm;' +

      'margin-bottom:4mm;' +

    '}' +


    '.head{' +

      'display:flex;' +

      'justify-content:space-between;' +

    '}' +


    '.line{' +

      'border-bottom:1px solid #777;' +

      'min-height:5mm;' +

    '}' +


    '.grid{' +

      'margin-top:4mm;' +

      'border-collapse:collapse;' +

      'width:100%;' +

    '}' +


    '.grid td,.grid th{' +

      'border:1px solid #111;' +

      'padding:2mm;' +

    '}' +


    '.sign{' +

      'display:flex;' +

      'justify-content:space-between;' +

      'margin-top:16mm;' +

      'text-align:center;' +

    '}' +


    '.sign>div{' +

      'width:30%;' +

    '}' +


    '.sign .u{' +

      'border-top:1px solid #111;' +

      'padding-top:2mm;' +

    '}' +


    '</style>' +


    '<div class="blank">' +


    '<div class="title">' +

    'SURAT JALAN' +

    '</div>' +


    '<div class="head">' +


    '<div>' +

    'A/P Dari &amp; Penerima' +

    '<div class="line" style="width:75mm"></div>' +

    '</div>' +


    '<div>' +

    'Nomor' +

    '<div class="line" style="width:40mm"></div>' +

    'Tanggal' +

    '<div class="line" style="width:40mm"></div>' +

    'Jam' +

    '<div class="line" style="width:40mm"></div>' +

    '</div>' +


    '</div>' +


    '<div style="margin-top:4mm">' +

    'Tujuan: ' +


    '<span class="line" ' +

    'style="display:inline-block;width:125mm">' +

    '</span>' +


    '</div>' +


    '<div style="margin-top:3mm">' +

    'Jenis Barang: ' +


    '<span class="line" ' +

    'style="display:inline-block;width:85mm">' +

    '</span>' +


    '</div>' +


    '<table class="grid">' +


    '<tr>' +

    '<th>' +
    'Nomor Polisi' +
    '</th>' +

    '<th>' +
    'Ukuran Bak (P-L-T)' +
    '</th>' +

    '<th>' +
    'M3' +
    '</th>' +

    '</tr>' +


    '<tr>' +

    '<td style="height:10mm"></td>' +

    '<td></td>' +

    '<td></td>' +

    '</tr>' +


    '</table>' +


    '<div style="font-size:8pt;margin-top:2mm">' +

    'Perhatian: Pengisian material dilakukan sesuai dengan ukuran bak mobil (rata bak).' +

    '<br/>' +

    'Kami tidak bertanggung jawab setelah material tersebut telah diterima.' +

    '</div>' +


    '<div class="sign">' +


    '<div>' +

    '<div class="u">' +

    'Yang Menerima,' +

    '</div>' +

    '</div>' +


    '<div>' +

    '<div class="u">' +

    'Supir,' +

    '</div>' +

    '</div>' +


    '<div>' +

    '<div class="u">' +

    'Hormat kami,' +

    '</div>' +

    '</div>' +


    '</div>' +


    '</div>'

  );

}


// ============================================================
// CETAK KOTAK BANTU KALIBRASI
//
// X = jarak dari kiri dalam mm
// Y = jarak dari atas dalam mm
//
// Garis:
// - setiap 1 mm
// - lebih tebal setiap 5 mm
// - paling tebal setiap 10 mm
//
// Angka:
// 0, 10, 20, 30, dst
// ============================================================

function printGrid(w, h) {


  var lines = "";

  var labels = "";


  w = Number(w || 0);

  h = Number(h || 0);


  // ----------------------------------------------------------
  // GARIS VERTIKAL
  // ----------------------------------------------------------

  for (
    var x = 0;
    x <= w;
    x++
  ) {


    var vClass =
      "mm1";


    if (
      x % 10 === 0
    ) {

      vClass =
        "mm10";

    }

    else if (
      x % 5 === 0
    ) {

      vClass =
        "mm5";

    }


    lines +=

      '<div class="vline ' +

      vClass +

      '" style="left:' +

      x +

      'mm"></div>';

  }


  // ----------------------------------------------------------
  // GARIS HORIZONTAL
  // ----------------------------------------------------------

  for (
    var y = 0;
    y <= h;
    y++
  ) {


    var hClass =
      "mm1";


    if (
      y % 10 === 0
    ) {

      hClass =
        "mm10";

    }

    else if (
      y % 5 === 0
    ) {

      hClass =
        "mm5";

    }


    lines +=

      '<div class="hline ' +

      hClass +

      '" style="top:' +

      y +

      'mm"></div>';

  }


  // ----------------------------------------------------------
  // ANGKA X = DARI KIRI
  // ----------------------------------------------------------

  for (
    var lx = 0;
    lx <= w;
    lx += 10
  ) {


    labels +=

      '<div class="xlabel" ' +

      'style="left:' +

      lx +

      'mm">' +

      lx +

      '</div>';

  }


  // ----------------------------------------------------------
  // ANGKA Y = DARI ATAS
  // ----------------------------------------------------------

  for (
    var ly = 0;
    ly <= h;
    ly += 10
  ) {


    labels +=

      '<div class="ylabel" ' +

      'style="top:' +

      ly +

      'mm">' +

      ly +

      '</div>';

  }


  // ----------------------------------------------------------
  // CETAK GRID
  // ----------------------------------------------------------

  openPrint(


    '<style>' +


    '@page{' +

      'size:' +

      w +

      'mm ' +

      h +

      'mm;' +

      'margin:0;' +

    '}' +


    'html,body{' +

      'margin:0;' +

      'padding:0;' +

      'width:' +

      w +

      'mm;' +

      'height:' +

      h +

      'mm;' +

      'overflow:hidden;' +

    '}' +


    '*{' +

      'box-sizing:border-box;' +

    '}' +


    '.print-grid{' +

      'position:relative;' +

      'width:' +

      w +

      'mm;' +

      'height:' +

      h +

      'mm;' +

      'overflow:hidden;' +

      'font-family:Arial,sans-serif;' +

      'background:#fff;' +

    '}' +


    // --------------------------------------------------------
    // GARIS VERTIKAL
    // --------------------------------------------------------

    '.vline{' +

      'position:absolute;' +

      'top:0;' +

      'bottom:0;' +

      'z-index:1;' +

    '}' +


    '.vline.mm1{' +

      'width:0.08mm;' +

      'background:#dddddd;' +

    '}' +


    '.vline.mm5{' +

      'width:0.15mm;' +

      'background:#999999;' +

    '}' +


    '.vline.mm10{' +

      'width:0.25mm;' +

      'background:#333333;' +

    '}' +


    // --------------------------------------------------------
    // GARIS HORIZONTAL
    // --------------------------------------------------------

    '.hline{' +

      'position:absolute;' +

      'left:0;' +

      'right:0;' +

      'z-index:1;' +

    '}' +


    '.hline.mm1{' +

      'height:0.08mm;' +

      'background:#dddddd;' +

    '}' +


    '.hline.mm5{' +

      'height:0.15mm;' +

      'background:#999999;' +

    '}' +


    '.hline.mm10{' +

      'height:0.25mm;' +

      'background:#333333;' +

    '}' +


    // --------------------------------------------------------
    // ANGKA X
    // --------------------------------------------------------

    '.xlabel{' +

      'position:absolute;' +

      'top:1mm;' +

      'transform:translateX(-50%);' +

      'font-size:7pt;' +

      'font-weight:bold;' +

      'line-height:1;' +

      'background:#fff;' +

      'padding:0.3mm 0.6mm;' +

      'z-index:10;' +

      'white-space:nowrap;' +

    '}' +


    // --------------------------------------------------------
    // ANGKA Y
    // --------------------------------------------------------

    '.ylabel{' +

      'position:absolute;' +

      'left:1mm;' +

      'transform:translateY(-50%);' +

      'font-size:7pt;' +

      'font-weight:bold;' +

      'line-height:1;' +

      'background:#fff;' +

      'padding:0.3mm 0.6mm;' +

      'z-index:10;' +

      'white-space:nowrap;' +

    '}' +


    '</style>' +


    '<div class="print-grid">' +


    lines +


    labels +


    '</div>'

  );

}


// ============================================================
// TERBILANG
// ============================================================

function terbilang(n) {


  n = Math.round(
    Number(n) || 0
  );


  if (
    n === 0
  ) {

    return "Nol";

  }


  var s = [

    "",

    "Satu",

    "Dua",

    "Tiga",

    "Empat",

    "Lima",

    "Enam",

    "Tujuh",

    "Delapan",

    "Sembilan",

    "Sepuluh",

    "Sebelas"

  ];


  function f(x) {


    if (
      x < 12
    ) {

      return s[x];

    }


    if (
      x < 20
    ) {

      return

        f(x - 10) +

        " Belas";

    }


    if (
      x < 100
    ) {

      return

        f(
          Math.floor(x / 10)
        ) +

        " Puluh" +

        (

          x % 10

            ? (
                " " +
                f(x % 10)
              )

            : ""

        );

    }


    if (
      x < 200
    ) {

      return

        "Seratus" +

        (

          x % 100

            ? (
                " " +
                f(x % 100)
              )

            : ""

        );

    }


    if (
      x < 1000
    ) {

      return

        f(
          Math.floor(x / 100)
        ) +

        " Ratus" +

        (

          x % 100

            ? (
                " " +
                f(x % 100)
              )

            : ""

        );

    }


    if (
      x < 2000
    ) {

      return

        "Seribu" +

        (

          x % 1000

            ? (
                " " +
                f(x % 1000)
              )

            : ""

        );

    }


    if (
      x < 1000000
    ) {

      return

        f(
          Math.floor(x / 1000)
        ) +

        " Ribu" +

        (

          x % 1000

            ? (
                " " +
                f(x % 1000)
              )

            : ""

        );

    }


    if (
      x < 1000000000
    ) {

      return

        f(
          Math.floor(x / 1000000)
        ) +

        " Juta" +

        (

          x % 1000000

            ? (
                " " +
                f(x % 1000000)
              )

            : ""

        );

    }


    return

      f(
        Math.floor(
          x / 1000000000
        )
      ) +

      " Miliar" +

      (

        x % 1000000000

          ? (
              " " +
              f(x % 1000000000)
            )

          : ""

      );

  }


  return f(n);

}