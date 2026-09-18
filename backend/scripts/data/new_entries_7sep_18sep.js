// Data BARU (belum pernah ditranskrip sebelumnya) hasil baca 13 foto buku
// catatan tambahan (dikirim ulang user krn versi sebelumnya kurang jelas),
// mencakup tanggal 7-18 September 2026, untuk:
//   - Cold Diesel: semua tanggal 7-18 Sept (sebelumnya CUMA sampai 6 Sept
//     yang ada di uang_jalan_6sep-18sep_DRAFT_perlu_dicek.csv)
//   - Tronton: tanggal 7-12 Sept (sebelumnya cuma 1 baris ringkasan kasar
//     "2026-09-08 s/d 2026-09-13" di CSV draft, sekarang dipecah per hari)
//
// PERINGATAN: tulisan tangan di buku ini banyak yang buram/coret-coret.
// Nominal breakdown & sebagian nama sopir adalah PERKIRAAN berdasarkan pola
// yang paling sering muncul di baris² yang jelas (Cold Diesel: kombinasi
// ~16.000-24.000 x2 + Solar 73.000 = sekitar Rp113.000/Rp121.000 per unit;
// Tronton: Uang Jalan ~1.500.000 + Pembelian Material bervariasi).
// confidence: "SEDANG" kalau nama sopir & angka besar (Pembelian Material)
// cukup jelas terbaca, "RENDAH" kalau benar-benar cuma perkiraan pola.
// SEMUA baris di file ini WAJIB dicek ulang oleh user ke buku aslinya -
// sesuai instruksi user "masukin aja dulu, nanti kalau salah diedit".

export const NEW_COLD_DIESEL = [
  // ===== 7 September =====
  { tanggal: "2026-09-07", sopir: "Wartono", ujs: 113000, ujsKet: "Bangka/Cilegon + Solar (perkiraan)", material: null, tujuan: "Lim -> Rawa Buaya", confidence: "RENDAH" },
  { tanggal: "2026-09-07", sopir: "Ipul", ujs: 113000, ujsKet: "Bangka/Cilegon + Solar (perkiraan)", material: 2035000, tujuan: "New Jaya / Malu 14", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Nanang", ujs: 113000, ujsKet: "Bangka/Cilegon + Solar (perkiraan)", material: 2140000, tujuan: "Farid -> Kb Jeruk / Mmu 14", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Kariadi", ujs: 113000, ujsKet: "Bangka/Cilegon + Solar (perkiraan)", material: 2074000, tujuan: "Alam 14", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Edi", ujs: 113000, ujsKet: "Bangka/Split/Cilegon + Solar (perkiraan)", material: null, tujuan: "Rnu -> Kb Gading / Muiz -> Pluit / Rnu -> Permata", confidence: "RENDAH" },
  { tanggal: "2026-09-07", sopir: "Yanto", ujs: 113000, ujsKet: "Split/Bandah/Cilegon + Solar (perkiraan)", material: null, tujuan: "Muiz -> Pluit / Rnu -> Halim / Rnu -> Riverton", confidence: "RENDAH" },
  { tanggal: "2026-09-07", sopir: "Rudi", ujs: 113000, ujsKet: "Cilegon/Bangka/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Kb Gading / Titop -> Bahari (x2)", confidence: "RENDAH" },

  // ===== 8 September =====
  { tanggal: "2026-09-08", sopir: "Ipul", ujs: 113000, ujsKet: "Bangka/Bangka/Cilegon + Solar (perkiraan)", material: 2035000, tujuan: "New Jaya", confidence: "SEDANG" },
  { tanggal: "2026-09-08", sopir: "Nanang", ujs: 113000, ujsKet: "Bangka + Solar (perkiraan)", material: 2140000, tujuan: "Farid -> Sebyan / Mmu 14", confidence: "SEDANG" },
  { tanggal: "2026-09-08", sopir: "Kariadi", ujs: 113000, ujsKet: "Bangka/Bangka/Cilegon + Solar (perkiraan)", material: 2074000, tujuan: "Alam 14 / Mou -> Mmp", confidence: "SEDANG" },

  // ===== 9 September =====
  { tanggal: "2026-09-09", sopir: "Ipul", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Sahar Toto", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Kariadi", ujs: 113000, ujsKet: "perkiraan pola", material: 1780000, tujuan: "Sahabat -> Nik / Pasar -> Pulo Maju", confidence: "SEDANG" },
  { tanggal: "2026-09-09", sopir: "Yumi", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan / Muiz -> Pluit", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Wartono", ujs: 113000, ujsKet: "perkiraan pola", material: 2030000, tujuan: "Rnu -> Rowutan", confidence: "SEDANG" },
  { tanggal: "2026-09-09", sopir: "Dargo", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Rudi", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan / Rnu -> Perjaan", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Edi", ujs: 113000, ujsKet: "perkiraan pola", material: 1734000, tujuan: "Muiz -> Pluit", confidence: "SEDANG" },
  { tanggal: "2026-09-09", sopir: "Alex", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Patar -> Pademangan / Farid -> Kb Jeruk", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Parno", ujs: 145000, ujsKet: "Rental ke-15 + ke-16 (breakdown asli)", material: null, tujuan: "-", confidence: "SEDANG" },

  // ===== 10 September =====
  { tanggal: "2026-09-10", sopir: "Kariadi", ujs: 210000, ujsKet: "Bangka/Abu Batu + Solar (perkiraan)", material: 2130000, tujuan: "S baru 2, Alam Jaya Ib Bandara", confidence: "SEDANG" },
  { tanggal: "2026-09-10", sopir: "Wartono", ujs: 121000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: 2010000, tujuan: "Alam 14, Bangka", confidence: "SEDANG" },
  { tanggal: "2026-09-10", sopir: "Ipul", ujs: 113000, ujsKet: "Split/Bangka + Solar (perkiraan)", material: 1990000, tujuan: "S Hari 2, New Jaya", confidence: "SEDANG" },
  { tanggal: "2026-09-10", sopir: "Nanang", ujs: 121000, ujsKet: "Cilegon/Abu Batu + Solar (perkiraan)", material: null, tujuan: "Berkat Leb Jera", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Wartono", ujs: 113000, ujsKet: "baris kedua, perkiraan pola", material: 1990000, tujuan: "Malu 14", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Dargo", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Mau -> Ib Huly", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Edi", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Yanto", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Rudi", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "S Hari -> Cilodug", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Alex", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Aceng", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Farid -> Kb Nrun", confidence: "RENDAH" },

  // ===== 11 September =====
  { tanggal: "2026-09-11", sopir: "Ipul", ujs: 300000, ujsKet: "1.09jt/1.89jt Solar (perkiraan)", material: 1890000, tujuan: "Alam 14 / New Jaya / Malu 14", confidence: "SEDANG" },
  { tanggal: "2026-09-11", sopir: "Wartono", ujs: 100000, ujsKet: "Bangka + Solar (perkiraan)", material: 2070000, tujuan: "Alam 14", confidence: "SEDANG" },
  { tanggal: "2026-09-11", sopir: "Alex", ujs: 113000, ujsKet: "Split/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan (x2)", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Nanang", ujs: 113000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan / Rnu -> Rowutan Pon", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Edi", ujs: 113000, ujsKet: "Bangka/Split/Cilegon + Solar (perkiraan)", material: null, tujuan: "Rnu -> Kb Gading / Muiz -> Pluit / Rnu -> Performa", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Dargo", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Iskak", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Aceng", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Yanto", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },

  // ===== 12 September =====
  { tanggal: "2026-09-12", sopir: "Parno", ujs: 90000, ujsKet: "Rental ke-17 + ke-18", material: 1460000, tujuan: "-", confidence: "SEDANG" },
  { tanggal: "2026-09-12", sopir: "Yumi", ujs: 220000, ujsKet: "Basi + Solar (perkiraan)", material: null, tujuan: "Bolro -> 500.000", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Ipul", ujs: 190000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: 1890000, tujuan: "Alam 14 / New Jaya", confidence: "SEDANG" },
  { tanggal: "2026-09-12", sopir: "Wartono", ujs: 113000, ujsKet: "perkiraan pola", material: 2070000, tujuan: "Alam 14", confidence: "SEDANG" },
  { tanggal: "2026-09-12", sopir: "Alex", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan (x2)", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Dargo", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan / Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Edi", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Iskak", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Aceng", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Yanto", ujs: 113000, ujsKet: "perkiraan pola", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },

  // ===== 13 September =====
  { tanggal: "2026-09-13", sopir: "Nanang", ujs: 121000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: null, tujuan: "Alam 14", confidence: "RENDAH" },
  { tanggal: "2026-09-13", sopir: "Alex", ujs: 121000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-13", sopir: "Dargo", ujs: 121000, ujsKet: "Bangka/Cilegon + Solar (perkiraan)", material: null, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-13", sopir: "Yanto", ujs: 121000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Gading Sengon / Rnu -> Gading Coro", confidence: "RENDAH" },
  { tanggal: "2026-09-13", sopir: "Yumi", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Gading Sengon", confidence: "RENDAH" },

  // ===== 14 September =====
  { tanggal: "2026-09-14", sopir: "Aceng", ujs: 113000, ujsKet: "Split/Bangka + Solar (perkiraan)", material: null, tujuan: "S Hari 2 / Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-14", sopir: "Ipul", ujs: 97000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-14", sopir: "Iskak", ujs: 97000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-14", sopir: "Wartono", ujs: 97000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan", confidence: "RENDAH" },
  { tanggal: "2026-09-14", sopir: "Edi", ujs: 121000, ujsKet: "Cilegon/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Halim / Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-14", sopir: "Yanto", ujs: 121000, ujsKet: "Bangka/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Halim / Rnu -> Kb Gading", confidence: "RENDAH" },

  // ===== 15 September =====
  { tanggal: "2026-09-15", sopir: "Iskak", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: 1899000, tujuan: "Alam 14", confidence: "SEDANG" },
  { tanggal: "2026-09-15", sopir: "Ipul", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: 1880000, tujuan: "Alam 14", confidence: "SEDANG" },
  { tanggal: "2026-09-15", sopir: "Wartono", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: 1960000, tujuan: "Malu 14", confidence: "SEDANG" },
  { tanggal: "2026-09-15", sopir: "Nanang", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: 2040000, tujuan: "Malu 14", confidence: "SEDANG" },
  { tanggal: "2026-09-15", sopir: "Aceng", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: 2200000, tujuan: "Alam 14", confidence: "RENDAH" },
  { tanggal: "2026-09-15", sopir: "Edi", ujs: 113000, ujsKet: "Bangka/Split + Solar (perkiraan)", material: null, tujuan: "Alam 14 -> Deen Mngn / Rnu -> Sampr", confidence: "RENDAH" },
  { tanggal: "2026-09-15", sopir: "Alex", ujs: 113000, ujsKet: "Split/Cilegon + Solar (perkiraan)", material: null, tujuan: "Alam 14 -> Deen Mngn / Rnu -> Sampn", confidence: "RENDAH" },
  { tanggal: "2026-09-15", sopir: "Yanto", ujs: 89000, ujsKet: "Split/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan / Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-15", sopir: "Dargo", ujs: 89000, ujsKet: "Cilegon/Bangka + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan / Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-15", sopir: "Yumi", ujs: 89000, ujsKet: "Cilegon/Cilegon + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan / Rnu -> Perjuma", confidence: "RENDAH" },
  { tanggal: "2026-09-15", sopir: "Parno", ujs: 90000, ujsKet: "Rental ke-21 + ke-22", material: null, tujuan: "-", confidence: "SEDANG" },

  // ===== 16 September =====
  { tanggal: "2026-09-16", sopir: "Ipul", ujs: 113000, ujsKet: "Bangka/Cilegon + Solar (perkiraan) - baris 1", material: 195000, tujuan: "New Jaya, Bam -> Rangas Neli", confidence: "RENDAH" },
  { tanggal: "2026-09-16", sopir: "Ipul", ujs: 121000, ujsKet: "Cilegon/Bangka + Cilegon (perkiraan) - baris 2", material: 180000, tujuan: "S Hari 2, Aneka 14, Cum -> Cimatot", confidence: "RENDAH" },
  { tanggal: "2026-09-16", sopir: "Iskak", ujs: 105000, ujsKet: "Bangka/Bangka/Cilegon + Solar (perkiraan)", material: 190000, tujuan: "S Hari Yanto, Aneka 14, Cum -> Cimatot", confidence: "RENDAH" },
  { tanggal: "2026-09-16", sopir: "Dargo", ujs: 129000, ujsKet: "Cilegon/Bangka/Cilegon/Cilegon + Solar (perkiraan)", material: null, tujuan: "Shantel -> Shafy / Titop Halim / Rnu -> Cililitan / Kar -> Pon Prima", confidence: "RENDAH" },
  { tanggal: "2026-09-16", sopir: "Wartono", ujs: 121000, ujsKet: "Bangka/Cilegon/Sirdam + Solar (perkiraan)", material: 180000, tujuan: "S Hari 2 / Rnu -> Kb Gading / Rnu -> Chhui", confidence: "RENDAH" },
  { tanggal: "2026-09-16", sopir: "Edi", ujs: 113000, ujsKet: "Cilegon/Cilegon/Split/Cilegon + Solar (perkiraan)", material: null, tujuan: "Rnu -> Kb Gading (x2) / Rnu -> Perjuang / Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-16", sopir: "Yumi", ujs: 89000, ujsKet: "Bandaran/Cilegon/Cilegon/Bandaran + Solar (perkiraan)", material: null, tujuan: "Lim -> Rawa Buaya / Rnu -> Gading Batat / Rnu -> Cililitan / Rnu -> Kb Gading", confidence: "RENDAH" },

  // ===== 17 September =====
  { tanggal: "2026-09-17", sopir: "Kariadi", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Aneka 14", confidence: "RENDAH" },
  { tanggal: "2026-09-17", sopir: "Nanang", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Maju Jaya / Lim -> Kb Baru", confidence: "RENDAH" },
  { tanggal: "2026-09-17", sopir: "Aceng", ujs: 89000, ujsKet: "Bangka + Solar (perkiraan)", material: null, tujuan: "Alam Hari -> Kb Bawang / Rnu -> Boruton", confidence: "RENDAH" },

  // ===== 18 September =====
  { tanggal: "2026-09-18", sopir: "Kariadi", ujs: 113000, ujsKet: "Bangka/Sirdam + Solar (perkiraan)", material: 2130000, tujuan: "Alam 14, Lim -> Ib Halu", confidence: "SEDANG" },
  { tanggal: "2026-09-18", sopir: "Wartono", ujs: 113000, ujsKet: "Bangka/Sirdam + Solar (perkiraan)", material: 2090000, tujuan: "New Jaya, Lim -> Ib Halu", confidence: "SEDANG" },
  { tanggal: "2026-09-18", sopir: "Edi", ujs: 113000, ujsKet: "Cilegon/Limosin + Solar (perkiraan)", material: null, tujuan: "Alam Hari -> Kb Bawang, Rnu -> Boruton", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Ipul", ujs: 121000, ujsKet: "Split/Bangka/Sirdam + Solar (perkiraan)", material: 2040000, tujuan: "Maju 14, Aneka 14, Lim -> Ib Halus", confidence: "SEDANG" },
  { tanggal: "2026-09-18", sopir: "Yanto", ujs: 89000, ujsKet: "Split/Limosin + Solar (perkiraan)", material: null, tujuan: "S Hari -> Kb Bawang, Rnu -> Ib Halu", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Aceng", ujs: 113000, ujsKet: "Sirdam/Sirdam + Solar (perkiraan)", material: null, tujuan: "Lim -> Ib Halu, Lim -> Ib Halus", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Alex", ujs: 113000, ujsKet: "Cilegon/Limosin + Solar (perkiraan)", material: null, tujuan: "Lim -> Kemayoran, Ranu -> Ancol", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Dargo", ujs: 113000, ujsKet: "Bangka/Bangka/Limosin + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowhoda, Rnu -> Kb Gading, Rnu -> Cililitan", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Yumi", ujs: 113000, ujsKet: "Split/Cilegon/Limosin + Solar (perkiraan)", material: null, tujuan: "Sahabat -> Jauzol, Lim -> Kemayoran", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Rudi", ujs: 113000, ujsKet: "Bangka/Limosin + Solar (perkiraan)", material: null, tujuan: "Rnu -> Rowutan (x2)", confidence: "RENDAH" },
  { tanggal: "2026-09-18", sopir: "Parno", ujs: 90000, ujsKet: "Rental ke-23 + ke-24", material: null, tujuan: "-", confidence: "SEDANG" },
];

export const NEW_TRONTON = [
  // ===== 7 September =====
  { tanggal: "2026-09-07", sopir: "Yadi", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 1800000, tujuan: "Bram -> Rusun Pulogadung", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Pandi", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 1800000, tujuan: "Bram -> Rusun P.Gadung", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Miskun", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: 1800000, tujuan: "PKL", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Anto", ujs: 1500000, ujsKet: "Split (perkiraan)", material: 5260000, tujuan: "PKL", confidence: "SEDANG" },
  { tanggal: "2026-09-07", sopir: "Purnomo", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: 1800000, tujuan: "PKL", confidence: "SEDANG" },

  // ===== 8 September =====
  { tanggal: "2026-09-08", sopir: "Yadi", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: 2000000, tujuan: "Bram -> Depan", confidence: "RENDAH" },
  { tanggal: "2026-09-08", sopir: "Pandi", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: null, tujuan: "PKL", confidence: "RENDAH" },
  { tanggal: "2026-09-08", sopir: "Anto", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 3887000, tujuan: "PKL", confidence: "RENDAH" },
  { tanggal: "2026-09-08", sopir: "Miskun", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: null, tujuan: "PKL", confidence: "RENDAH" },

  // ===== 9 September =====
  { tanggal: "2026-09-09", sopir: "Yadi", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: null, tujuan: "PKL", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Anto", ujs: 1500000, ujsKet: "Abu Batu (perkiraan)", material: 3887000, tujuan: "PKL", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Tajri", ujs: 1700000, ujsKet: "Kalimantan (perkiraan)", material: null, tujuan: "Meru -> Bangau", confidence: "RENDAH" },
  { tanggal: "2026-09-09", sopir: "Purnomo", ujs: 1500000, ujsKet: "Cilegon (perkiraan)", material: null, tujuan: "PKL", confidence: "RENDAH" },

  // ===== 10 September =====
  { tanggal: "2026-09-10", sopir: "Yadi", ujs: 1700000, ujsKet: "Scrub (perkiraan)", material: 1500000, tujuan: "Bram -> Depan", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Pandi", ujs: 1700000, ujsKet: "Scrub (perkiraan)", material: 1500000, tujuan: "Bram -> Depan", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Anto", ujs: 1700000, ujsKet: "Batu Belah (perkiraan)", material: 4660000, tujuan: "Bram -> Depan", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Purnomo", ujs: 1700000, ujsKet: "Batu Belah (perkiraan)", material: 5020000, tujuan: "Bram -> Depan", confidence: "RENDAH" },
  { tanggal: "2026-09-10", sopir: "Tajri", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 1800000, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },

  // ===== 11 September =====
  { tanggal: "2026-09-11", sopir: "Aceng", ujs: 2000000, ujsKet: "Bangka (perkiraan)", material: 9570000, tujuan: "PKL", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Tajri", ujs: 1500000, ujsKet: "Bangka (perkiraan)", material: 1000000, tujuan: "Bram -> Rusun Pulogadung", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Yadi", ujs: 1700000, ujsKet: "Batu Belah (perkiraan)", material: 4980000, tujuan: "Bram -> Depan", confidence: "RENDAH" },
  { tanggal: "2026-09-11", sopir: "Pandi", ujs: 1700000, ujsKet: "Batu Belah (perkiraan)", material: 5030000, tujuan: "Bram -> Depan", confidence: "RENDAH" },

  // ===== 12 September =====
  { tanggal: "2026-09-12", sopir: "Pandi", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 1800000, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Yadi", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 1800000, tujuan: "Rnu -> Kb Gading", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Anto", ujs: 1500000, ujsKet: "Split (perkiraan)", material: 5260000, tujuan: "PKL", confidence: "RENDAH" },
  { tanggal: "2026-09-12", sopir: "Purnomo", ujs: 1500000, ujsKet: "Batu Belah (perkiraan)", material: 1800000, tujuan: "PKL", confidence: "RENDAH" },
];
