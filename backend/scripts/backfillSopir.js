// Pindahkan nama sopir lama (teks bebas di Armada & SuratJalan) ke master Sopir.
//
// Pakai (dari folder backend, SETELAH `npx prisma migrate deploy`):
//   node scripts/backfillSopir.js            -> DRY RUN, cuma menampilkan rencana
//   node scripts/backfillSopir.js --apply    -> benar-benar menulis ke database
//
// Aman dijalankan berulang: hanya mengisi sopirId yang masih kosong, dan
// tidak membuat sopir ganda kalau namanya sudah ada di master.
// TIDAK mengubah kolom teks `sopir` lama, dan TIDAK mengubah komisi/biaya
// Surat Jalan lama (tetap 0 -- isi manual kalau perlu).
import "dotenv/config";
import prisma from "../src/prismaClient.js";

const APPLY = process.argv.includes("--apply");

// "  budi   S " -> "budi s" (dipakai untuk mengelompokkan ejaan yang mirip)
const key = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const clean = (s) => String(s || "").trim().replace(/\s+/g, " ");

async function main() {
  const armada = await prisma.armada.findMany({
    where: { sopirId: null, sopir: { not: null } },
    select: { id: true, sopir: true, jenis: true },
  });
  const sj = await prisma.suratJalan.findMany({
    where: { sopirId: null, sopir: { not: null } },
    select: { id: true, sopir: true },
  });

  // Kelompokkan per nama (tanpa membedakan huruf besar/kecil & spasi ganda)
  const groups = new Map(); // key -> { spellings: Map(ejaan -> jumlah), jenis: Set }
  const add = (name, jenis) => {
    const k = key(name);
    if (!k) return;
    if (!groups.has(k)) groups.set(k, { spellings: new Map(), jenis: new Set() });
    const g = groups.get(k);
    const c = clean(name);
    g.spellings.set(c, (g.spellings.get(c) || 0) + 1);
    if (jenis) g.jenis.add(String(jenis).toLowerCase());
  };
  armada.forEach((a) => add(a.sopir, a.jenis));
  sj.forEach((s) => add(s.sopir, null));

  // Sopir yang sudah ada di master (supaya tidak dobel)
  const existing = await prisma.sopir.findMany();
  const byKey = new Map(existing.map((s) => [key(s.nama), s]));

  console.log(APPLY ? "== MODE APPLY ==" : "== DRY RUN (tambahkan --apply untuk menulis) ==");
  console.log(`Armada tanpa sopirId: ${armada.length} | Surat Jalan tanpa sopirId: ${sj.length}`);
  console.log(`Nama sopir unik ditemukan: ${groups.size}\n`);

  let created = 0;
  for (const [k, g] of groups) {
    // ejaan yang paling sering dipakai jadi nama resmi
    const nama = [...g.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Tebakan tipe dari jenis kendaraan; SILAKAN dikoreksi di menu Sopir.
    const isTronton = [...g.jenis].some((j) => j.includes("tronton"));
    const tipe = isTronton ? "TRONTON" : "COLD_DIESEL";
    const komisiDefault = isTronton ? 50000 : 0;

    let s = byKey.get(k);
    if (!s) {
      console.log(`+ Sopir baru: ${nama} [${tipe}] komisi default ${komisiDefault}` +
        (g.spellings.size > 1 ? `  (ejaan digabung: ${[...g.spellings.keys()].join(" | ")})` : ""));
      if (APPLY) {
        s = await prisma.sopir.create({ data: { nama, tipe, komisiDefault, aktif: true } });
        byKey.set(k, s);
      }
      created++;
    }
    if (APPLY && s) {
      const ids = (rows) => rows.filter((r) => key(r.sopir) === k).map((r) => r.id);
      await prisma.armada.updateMany({ where: { id: { in: ids(armada) } }, data: { sopirId: s.id } });
      await prisma.suratJalan.updateMany({ where: { id: { in: ids(sj) } }, data: { sopirId: s.id } });
    }
  }

  console.log(`\nSopir baru dibuat: ${created}${APPLY ? "" : " (belum ditulis, dry run)"}`);
  console.log("Setelah apply: cek menu Sopir, koreksi tipe & komisi default yang tebakannya salah.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
