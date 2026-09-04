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
    // CETAK FIELD "TUJUAN"
    //
    // "Tujuan" bisa berupa alamat panjang, dan posisinya sebaris
    // dengan kolom Nomor/Tanggal/Jam di kanan atas. Field lain aman
    // pakai nowrap, tapi Tujuan kalau dibiarkan nowrap teksnya bakal
    // memanjang terus ke kanan dan menabrak kolom Nomor/Tanggal/Jam.
    // Jadi di sini Tujuan dibuat wrap (turun ke bawah), lebarnya
    // dibatasi supaya berhenti sebelum kolom itu.
    // --------------------------------------------------------

    function fieldTujuan(text) {

      var t =
        LBL.tujuan +
        " : " +
        (text || "-");

      var maxWidth =
        Math.max(
          40,
          p.no.x - p.tujuan.x - 6
        );

      return (

        '<div class="f sj-field sj-field-wrap" style="' +

        'left:' +
        p.tujuan.x +
        'mm;' +

        'top:' +
        p.tujuan.y +
        'mm;' +

        'font-size:' +
        p.tujuan.size +
        'pt;' +

        'width:' +
        maxWidth +
        'mm;' +

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


        fieldTujuan(
          tujuanText
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


      '.sj-field-wrap{' +

        'white-space:normal;' +

        'word-break:break-word;' +

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

async function printInvoice(inv) {
  const [calib, signerName] = await Promise.all([
    api.get("/print-calib"),
    getSignerName(),
  ]);
  const c = calib.inv;

  const rows = inv.items
    .map((it, i) => {
      const sj = it.suratJalan;
      const pltText = sj
        ? `${Number(sj.panjang ?? 0).toFixed(2)} ${Number(sj.lebar ?? 0).toFixed(2)} ${Number(sj.tinggi ?? 0).toFixed(2)}`
        : `${it.qty} ${it.satuan || ""}`;
      const m3Text = sj ? Number(sj.m3 || 0).toFixed(3) : Number(it.qty).toFixed(3);

      return `<tr>
        <td>${i + 1}</td>
        <td>${sj ? esc(fmtDateShort(sj.tanggal)) : "-"}</td>
        <td>${sj ? esc(sj.no) : "-"}</td>
        <td>${sj ? esc(sj.sopir || sj.armada?.sopir || "") : ""}</td>
        <td class="left">${sj ? esc(sj.tujuan) : esc(it.keterangan)}</td>
        <td>${esc(pltText)}</td>
        <td>${m3Text}</td>
        <td class="num">${rupiah(it.hargaSatuan)}</td>
        <td class="num">${rupiah(it.qty * it.hargaSatuan)}</td>
      </tr>`;
    })
    .join("");

  const total = inv.total ?? inv.items.reduce((s, i) => s + i.qty * i.hargaSatuan, 0);
  const totalM3 = inv.items.reduce((s, it) => s + Number(it.suratJalan?.m3 || 0), 0);
  const top = Number(c.topMargin || 36) + Number(c.offsetY || 0);
  const left = Number(c.offsetX || 0);

  openPrint(`
    <style>
      @page{size:${c.w}mm ${c.h}mm;margin:0}
      html,body{margin:0;padding:0;width:${c.w}mm;height:${c.h}mm}
      .sheet{position:relative;width:${c.w}mm;height:${c.h}mm;padding:${top}mm 8mm 6mm ${8 + left}mm;font:13pt "Courier New",Courier,monospace;color:#111;line-height:1.4;letter-spacing:.08mm}
      .title{text-align:center;font-size:16pt;font-weight:700;letter-spacing:.3mm;margin-bottom:4mm}
      .head{display:flex;justify-content:space-between;margin-bottom:4mm}
      .head .right{text-align:right}
      .label{font-size:11pt;color:#555}
      .val{font-weight:700}
      .idrow{margin:3mm 0 5mm}
      .idrow div{margin-bottom:1.5mm}
      .idrow .label{display:inline-block;width:38mm}
      .tbl{border-collapse:collapse;width:100%;font-size:12pt}
      .tbl th,.tbl td{border:1px solid #111;padding:1.8mm;text-align:center}
      .tbl th{background:#eee}
      .tbl td.left{text-align:left}
      .tbl td.num{text-align:right;white-space:nowrap}
      .bottom{display:flex;justify-content:space-between;align-items:flex-start;margin-top:3mm;gap:3mm}
      .bottom-left{width:52%}
      .bottom-right{width:40%;margin-left:60%}
      .note{font-size:10pt;margin-top:2mm;line-height:1.45}
      .totalbox{width:100%;font-size:11pt}
      .totalbox td{border:1px solid #111;padding:1.5mm 2.5mm}
      .totalbox .amount{font-size:13pt}
      .sign{text-align:center;margin-top:9mm;margin-left:auto;width:48mm;font-size:11pt}
      .signline{border-top:1px solid #111;padding-top:1.5mm;margin-top:14mm}
    </style>
    <div class="sheet">
      <div class="title">INVOICE</div>
      <div class="head">
        <div>
          <div class="label">Kepada Yth</div>
          <div class="val">${esc(inv.customer?.nama || "")}</div>
          <div>${esc(inv.customer?.alamat || "")}</div>
        </div>
        <div class="right">
          <div class="label">Halaman</div>
          <div class="val">${esc(inv.halaman ?? 1)}</div>
          <div class="label" style="margin-top:2mm">No. Invoice</div>
          <div class="val">${esc(inv.no)}</div>
          <div class="label" style="margin-top:2mm">Tanggal</div>
          <div class="val">${esc(fmtDateShort(inv.tanggal))}</div>
        </div>
      </div>
      <div class="idrow">
        <div><span class="label">Kode Customer</span> : <b>${esc(inv.customer?.kode || "-")}</b></div>
        <div><span class="label">Nama Customer</span> : <b>${esc(inv.customer?.nama || "-")}</b></div>
        <div><span class="label">Alamat</span> : <b>${esc(inv.customer?.alamat || "-")}</b></div>
      </div>
      <table class="tbl">
        <tr>
          <th>No</th><th>Tgl Kirim</th><th>No SJ</th><th>Sopir</th><th>Alamat Kirim</th>
          <th>P L T</th><th>M3</th><th>Harga</th><th>Jumlah</th>
        </tr>
        ${rows}
      </table>
      <div class="bottom">
        <div class="bottom-left">
          <b>Total M3:</b> ${totalM3.toFixed(3)}
          <div class="note"><b>Terbilang:</b> ${esc(terbilang(total))} Rupiah</div>
          ${inv.catatan ? `<div class="note"><b>Catatan:</b> ${esc(inv.catatan)}</div>` : ""}
        </div>
        <div class="bottom-right">
          <table class="tbl totalbox">
            <tr><td><b>Jumlah Total Tagihan</b></td><td class="num amount"><b>${rupiah(total)}</b></td></tr>
          </table>
        </div>
      </div>
      <div class="sign">
        Jakarta, ${esc(fmtDate(inv.tanggal))}
        <div class="signline">${esc(signerName || "Hormat Kami")}</div>
      </div>
    </div>
  `);
}

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