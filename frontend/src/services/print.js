import { api } from "./api.js";

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function rupiah(n) {
  return "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
}

export function fmtDate(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateShort(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

async function getSignerName() {
  try {
    const s = await api.get("/settings");
    return s?.signerName || "";
  } catch (e) {
    return "";
  }
}

function openPrint(html) {
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Cetak BMS</title></head><body>${html}</body></html>`
  );
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}

// ============================================================
// CETAK SURAT JALAN (di atas kertas continuous form berlubang
// yang sudah ada cetakan tetapnya - lihat halaman Kalibrasi Cetak)
//
// "sj" boleh berupa satu objek Surat Jalan, ATAU array berisi beberapa
// Surat Jalan (misalnya hasil simpan dengan "Jumlah Surat Jalan" > 1).
// Kalau array, semua dicetak sekaligus dalam SATU kali klik "Print" /
// SATU dialog cetak browser (satu halaman kertas per Surat Jalan,
// nomornya masing-masing beda sesuai data), jadi user tidak perlu
// mencetak satu-satu lagi.
// ============================================================
export async function printSJ(sjOrList) {
  const list = Array.isArray(sjOrList) ? sjOrList : [sjOrList];
  if (!list.length) return;

  const [calib, signerName] = await Promise.all([
    api.get("/print-calib"),
    getSignerName(),
  ]);
  const c = calib.sj;
  const ox = Number(c.offsetX || 0);
  const oy = Number(c.offsetY || 0);
  const f = c.fields || {};

  const pos = (k, def) => ({
    x: Number(f[k]?.x ?? def.x) + ox,
    y: Number(f[k]?.y ?? def.y) + oy,
    size: Number(f[k]?.size ?? def.size),
  });

  const p = {
    apDari: pos("apDari", { x: 8, y: 10, size: 10 }),
    penerima: pos("penerima", { x: 8, y: 18, size: 10 }),
    no: pos("no", { x: 175, y: 30, size: 11 }),
    tanggal: pos("tanggal", { x: 175, y: 38, size: 11 }),
    jam: pos("jam", { x: 175, y: 46, size: 11 }),
    tujuan: pos("tujuan", { x: 8, y: 26, size: 10 }),
    jenis: pos("jenisBarang", { x: 8, y: 34, size: 10 }),
    nopol: pos("nopol", { x: 14, y: 62, size: 13 }),
    bak: pos("ukuranBak", { x: 90, y: 62, size: 13 }),
    m3: pos("m3", { x: 200, y: 62, size: 13 }),
    sopir: pos("sopirNama", { x: 150, y: 98, size: 11 }),
    hormat: pos("hormatKamiNama", { x: 226, y: 102, size: 11 }),
  };

  // Label ditulis di depan tiap nilai (kertas SJ tidak ada label "Nomor :",
  // "Tanggal :", dst yang tercetak duluan - jadi labelnya ikut ditulis
  // software supaya jelas kolom mana isinya apa).
  const LBL = {
    apDari: "A/P Dari",
    penerima: "Penerima",
    no: "Nomor",
    tanggal: "Tanggal",
    jam: "Jam",
    tujuan: "Tujuan",
    jenis: "Jenis Brg",
  };

  const field = (key, text, withLabel) => {
    const t = withLabel ? `${LBL[key]} : ${text || "-"}` : text;
    return `<div class="f" style="left:${p[key].x}mm;top:${p[key].y}mm;font-size:${p[key].size}pt">${esc(
      t
    )}</div>`;
  };

  const sheets = list
    .map((sj, i) => {
      const namaCustomer = sj.customer
        ? `${sj.customer.nama}${sj.customer.kode ? " / " + sj.customer.kode : ""}`
        : "-";
      const namaPenerima = sj.penerima || sj.customer?.nama || "-";
      const ukuran = `${Number(sj.panjang ?? sj.p ?? 0).toFixed(2)} - ${Number(
        sj.lebar ?? sj.l ?? 0
      ).toFixed(2)} - ${Number(sj.tinggi ?? sj.t ?? 0).toFixed(3)}`;
      const last = i === list.length - 1;

      return `<div class="sheet"${last ? "" : ' style="page-break-after:always"'}>
        ${field("apDari", namaCustomer, true)}
        ${field("penerima", namaPenerima, true)}
        ${field("no", sj.no, true)}
        ${field("tanggal", fmtDateShort(sj.tanggal), true)}
        ${field("jam", sj.jam || "", true)}
        ${field("tujuan", sj.tujuan || sj.customer?.alamat || "", true)}
        ${field("jenis", sj.jenisBarang || "", true)}
        ${field("nopol", sj.noPolisi || sj.armada?.nopol || "")}
        ${field("bak", ukuran)}
        ${field("m3", Number(sj.m3 || 0).toFixed(3))}
        ${field("sopir", sj.sopir || sj.armada?.sopir || "")}
        ${field("hormat", signerName)}
      </div>`;
    })
    .join("");

  openPrint(`
    <style>
      @page{size:${c.w}mm ${c.h}mm;margin:0}
      html,body{margin:0;padding:0;width:${c.w}mm}
      *{box-sizing:border-box}
      .sheet{position:relative;width:${c.w}mm;height:${c.h}mm;background:#fff;font-family:"Courier New",Courier,monospace;color:#111}
      .f{position:absolute;white-space:nowrap;font-family:"Courier New",Courier,monospace}
    </style>
    ${sheets}
  `);
}

export function printSJBlank() {
  openPrint(`
    <style>
      @page{size:241.3mm 108mm;margin:0}
      html,body{margin:0;padding:0;width:241.3mm;height:108mm}
      .blank{width:241.3mm;height:108mm;font:10pt Arial;padding:7mm}
      .title{text-align:center;font-size:17pt;font-weight:700;border:2px solid #111;padding:2mm;margin-bottom:4mm}
      .head{display:flex;justify-content:space-between}
      .line{border-bottom:1px solid #777;min-height:5mm}
      .grid{margin-top:4mm;border-collapse:collapse;width:100%}
      .grid td,.grid th{border:1px solid #111;padding:2mm}
      .sign{display:flex;justify-content:space-between;margin-top:16mm;text-align:center}
      .sign>div{width:30%}
      .sign .u{border-top:1px solid #111;padding-top:2mm}
    </style>
    <div class="blank">
      <div class="title">SURAT JALAN</div>
      <div class="head">
        <div>A/P Dari &amp; Penerima<div class="line" style="width:75mm"></div></div>
        <div>Nomor<div class="line" style="width:40mm"></div>Tanggal<div class="line" style="width:40mm"></div>Jam<div class="line" style="width:40mm"></div></div>
      </div>
      <div style="margin-top:4mm">Tujuan: <span class="line" style="display:inline-block;width:125mm"></span></div>
      <div style="margin-top:3mm">Jenis Barang: <span class="line" style="display:inline-block;width:85mm"></span></div>
      <table class="grid">
        <tr><th>Nomor Polisi</th><th>Ukuran Bak (P-L-T)</th><th>M3</th></tr>
        <tr><td style="height:10mm"></td><td></td><td></td></tr>
      </table>
      <div style="font-size:8pt;margin-top:2mm">
        Perhatian: Pengisian material dilakukan sesuai dengan ukuran bak mobil (rata bak).<br/>
        Kami tidak bertanggung jawab setelah material tersebut telah diterima.
      </div>
      <div class="sign">
        <div><div class="u">Yang Menerima,</div></div>
        <div><div class="u">Supir,</div></div>
        <div><div class="u">Hormat kami,</div></div>
      </div>
    </div>
  `);
}

// ============================================================
// CETAK INVOICE (di atas kop surat / letterhead PT Bintang Muara
// Sejati yang sudah tercetak - lihat halaman Kalibrasi Cetak)
// ============================================================
export async function printInvoice(inv) {
  const [calib, signerName] = await Promise.all([
    api.get("/print-calib"),
    getSignerName(),
  ]);
  const c = calib.inv;

  const rows = inv.items
    .map((it, i) => {
      const sj = it.suratJalan;
      const pltText = sj
        ? `${Number(sj.panjang ?? 0).toFixed(2)} ${Number(sj.lebar ?? 0).toFixed(
            2
          )} ${Number(sj.tinggi ?? 0).toFixed(2)}`
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
      .sheet{position:relative;width:${c.w}mm;height:${c.h}mm;padding:${top}mm 8mm 6mm ${8 + left}mm;font:10.5pt "Courier New",Courier,monospace;color:#111;line-height:1.35}
      .head{display:flex;justify-content:space-between;margin-bottom:4mm}
      .head .right{text-align:right}
      .label{font-size:9.5pt;color:#555}
      .val{font-weight:700}
      .idrow{margin:3mm 0 5mm}
      .idrow div{margin-bottom:1.5mm}
      .idrow .label{display:inline-block;width:34mm}
      .tbl{border-collapse:collapse;width:100%;font-size:9.5pt}
      .tbl th,.tbl td{border:1px solid #111;padding:1.8mm;text-align:center}
      .tbl th{background:#eee}
      .tbl td.left{text-align:left}
      .tbl td.num{text-align:right}
      .bottom{display:flex;justify-content:space-between;margin-top:3mm}
      .sign{text-align:center;margin-top:9mm;margin-left:auto;width:48mm}
      .signline{border-top:1px solid #111;padding-top:1.5mm;margin-top:14mm}
      .note{font-size:7.5pt;margin-top:2mm}
      .totalbox td{border:1px solid #111;padding:1.5mm 3mm}
    </style>
    <div class="sheet">
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
        <div>
          <b>Total M3:</b> ${totalM3.toFixed(3)}
          <div class="note"><b>Terbilang:</b> ${esc(terbilang(total))} Rupiah</div>
          ${inv.catatan ? `<div class="note"><b>Catatan:</b> ${esc(inv.catatan)}</div>` : ""}
        </div>
        <table class="tbl totalbox" style="width:62mm">
          <tr><td><b>Jumlah Total Tagihan</b></td><td class="num"><b>${rupiah(total)}</b></td></tr>
          <tr><td>Sudah Dibayar</td><td class="num">${rupiah(inv.dibayar)}</td></tr>
          <tr><td>Sisa</td><td class="num">${rupiah(inv.sisaTagihan)}</td></tr>
        </table>
      </div>
      <div class="sign">
        Jakarta, ${esc(fmtDate(inv.tanggal))}
        <div class="signline">${esc(signerName || "Hormat Kami")}</div>
      </div>
    </div>
  `);
}

function terbilang(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return "Nol";
  const s = [
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
    "Sebelas",
  ];
  const f = (x) =>
    x < 12
      ? s[x]
      : x < 20
      ? f(x - 10) + " Belas"
      : x < 100
      ? f(Math.floor(x / 10)) + " Puluh" + (x % 10 ? " " + f(x % 10) : "")
      : x < 200
      ? "Seratus" + (x % 100 ? " " + f(x % 100) : "")
      : x < 1000
      ? f(Math.floor(x / 100)) + " Ratus" + (x % 100 ? " " + f(x % 100) : "")
      : x < 2000
      ? "Seribu" + (x % 1000 ? " " + f(x % 1000) : "")
      : x < 1e6
      ? f(Math.floor(x / 1000)) + " Ribu" + (x % 1000 ? " " + f(x % 1000) : "")
      : x < 1e9
      ? f(Math.floor(x / 1e6)) + " Juta" + (x % 1e6 ? " " + f(x % 1e6) : "")
      : f(Math.floor(x / 1e9)) + " Miliar" + (x % 1e9 ? " " + f(x % 1e9) : "");
  return f(n);
}

// ============================================================
// CETAK REKAP KESELURUHAN -- laporan laba rugi (bisa beberapa divisi
// sekaligus atau satu divisi saja, sesuai filter di halaman "Rekap
// Keseluruhan"), dengan kop surat perusahaan seperti dokumen cetak
// lainnya. Tiap divisi dicetak di halaman baru kalau lebih dari satu.
// ============================================================
export function printRekapKeseluruhan(data) {
  if (!data) return;

  const periode = `${fmtDate(data.dari)} &ndash; ${fmtDate(data.sampai)}`;

  const kelompokTable = (k) => {
    const adaRincian = k.hasQty || k.rows.some((r) => r.subKategori);
    const rows = k.rows.length
      ? k.rows
          .map(
            (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${esc(r.kategori)}</td>
          ${adaRincian ? `<td>${esc(r.subKategori || "-")}</td>` : ""}
          <td class="num">${rupiah(r.nominal)}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="${adaRincian ? 4 : 3}" class="empty">Belum ada data.</td></tr>`;

    return `
      <div class="sec">
        <div class="sec-title">${esc(k.label)} <span class="tag">${k.tipe === "PENJUALAN" ? "Pendapatan" : "Pengeluaran"}</span></div>
        <table>
          <thead>
            <tr>
              <th style="width:32px">No</th>
              <th>Kategori</th>
              ${adaRincian ? "<th>Rincian</th>" : ""}
              <th class="num">Nominal</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="${adaRincian ? 3 : 2}"><b>Total ${esc(k.label)}</b></td>
              <td class="num"><b>${rupiah(k.subtotal)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  };

  const divisiSections = data.divisi
    .map(
      (d, idx) => `
    <div class="page" ${idx > 0 ? 'style="page-break-before:always"' : ""}>
      <div class="head">
        <div class="company">PT. BINTANG MUARA SEJATI</div>
        <div class="title">REKAP LAPORAN &mdash; DIVISI ${esc(d.divisi.toUpperCase())}</div>
        <div class="period">Periode ${periode}</div>
      </div>
      ${d.kelompok.map(kelompokTable).join("")}
      <div class="summary">
        <div class="srow"><span>Total Penjualan / Pendapatan</span><b>${rupiah(d.totalPenjualan)}</b></div>
        <div class="srow"><span>Total Pengeluaran</span><b>${rupiah(d.totalPengeluaran)}</b></div>
        <div class="srow final"><span>Hasil Bersih (Laba / Rugi)</span><b>${rupiah(d.labaBersih)}</b></div>
      </div>
    </div>`
    )
    .join("");

  const grandTotalBlock =
    data.divisi.length > 1
      ? `
    <div class="page" style="page-break-before:always">
      <div class="head">
        <div class="company">PT. BINTANG MUARA SEJATI</div>
        <div class="title">REKAP KESELURUHAN SEMUA DIVISI</div>
        <div class="period">Periode ${periode}</div>
      </div>
      <table>
        <thead><tr><th>Divisi</th><th class="num">Pendapatan</th><th class="num">Pengeluaran</th><th class="num">Hasil Bersih</th></tr></thead>
        <tbody>
          ${data.divisi
            .map(
              (d) => `<tr><td>${esc(d.divisi)}</td><td class="num">${rupiah(d.totalPenjualan)}</td><td class="num">${rupiah(d.totalPengeluaran)}</td><td class="num">${rupiah(d.labaBersih)}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
      <div class="summary">
        <div class="srow"><span>Total Pendapatan Seluruh Divisi</span><b>${rupiah(data.grandTotal.totalPenjualan)}</b></div>
        <div class="srow"><span>Total Pengeluaran Seluruh Divisi</span><b>${rupiah(data.grandTotal.totalPengeluaran)}</b></div>
        <div class="srow final"><span>Hasil Bersih Keseluruhan</span><b>${rupiah(data.grandTotal.labaBersih)}</b></div>
      </div>
    </div>`
      : "";

  openPrint(`
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
      .head { text-align: center; margin-bottom: 14px; }
      .company { font-weight: 800; font-size: 15px; letter-spacing: 0.02em; }
      .title { font-weight: 700; margin-top: 2px; }
      .period { color: #555; font-size: 12px; margin-top: 2px; }
      .sec { margin-bottom: 12px; }
      .sec-title { font-weight: 700; margin-bottom: 4px; }
      .tag { font-weight: 400; font-size: 10px; border: 1px solid #999; border-radius: 4px; padding: 1px 6px; margin-left: 6px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 3px 6px; font-size: 11px; }
      th { background: #f0f0f0; text-align: left; }
      .num { text-align: right; white-space: nowrap; }
      .empty { text-align: center; color: #777; padding: 8px; }
      tfoot td { background: #fafafa; }
      .summary { margin-top: 8px; max-width: 420px; margin-left: auto; }
      .srow { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #ccc; }
      .srow.final { font-size: 13px; border-bottom: none; margin-top: 2px; }
    </style>
    ${divisiSections}${grandTotalBlock}
  `);
}

export function printGrid(w, h) {
  let v = "";
  let g = "";
  for (let x = 0; x <= w; x += 5) v += `<i style="left:${x}mm"></i>`;
  for (let y = 0; y <= h; y += 5) g += `<b style="top:${y}mm"></b>`;
  openPrint(`
    <style>
      @page{size:${w}mm ${h}mm;margin:0}
      html,body{margin:0}
      .grid{position:relative;width:${w}mm;height:${h}mm}
      .grid i,.grid b{position:absolute;background:#aab4bf}
      .grid i{top:0;bottom:0;width:.15mm}
      .grid b{left:0;right:0;height:.15mm}
    </style>
    <div class="grid">${v}${g}</div>
  `);
}
