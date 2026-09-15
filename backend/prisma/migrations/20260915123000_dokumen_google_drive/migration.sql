-- File dokumen (STNK/KIR/Invoice/SIA/dst) sekarang diupload ke Google
-- Drive, bukan disk lokal server (disk hosting gratisan sifatnya
-- EPHEMERAL/sementara). Kolom "file" lama dipertahankan buat dokumen yang
-- sudah kadung diupload sebelumnya (legacy), upload BARU akan mengisi
-- driveFileId & driveViewUrl.
ALTER TABLE "Dokumen" ADD COLUMN "driveFileId" TEXT;
ALTER TABLE "Dokumen" ADD COLUMN "driveViewUrl" TEXT;
