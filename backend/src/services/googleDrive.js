// Integrasi Google Drive -- dipakai supaya file dokumen kelengkapan aset
// (STNK, KIR, Invoice, SIA, dst di menu Armada/Kapal/Alat Berat) TIDAK
// disimpan di disk lokal server. Disk hosting gratisan (Railway/Render dst)
// sifatnya EPHEMERAL -- bisa hilang tiap kali service di-redeploy/restart.
// Dengan ini, waktu user upload file seperti biasa lewat form, filenya
// otomatis dikirim ke folder Google Drive yang sudah ditentukan, dan yang
// disimpan di database cuma link-nya.
//
// SETUP YANG DIBUTUHKAN (sekali saja):
// 1. Buka https://console.cloud.google.com -> buat/pilih project -> aktifkan
//    "Google Drive API".
// 2. Bikin Service Account (IAM & Admin > Service Accounts), buat key baru
//    tipe JSON, lalu download credential-nya.
// 3. Buka Google Drive, bikin 1 folder khusus (mis. "BMS - Dokumen Aset"),
//    lalu SHARE folder itu ke alamat email service account
//    (formatnya: xxxx@xxxx.iam.gserviceaccount.com) dengan akses "Editor".
// 4. Ambil ID folder itu dari URL-nya:
//    https://drive.google.com/drive/folders/<FOLDER_ID_DI_SINI>
// 5. Isi 3 env var di .env (lihat .env.example):
//    - GOOGLE_SERVICE_ACCOUNT_EMAIL
//    - GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
//    - GOOGLE_DRIVE_DOKUMEN_FOLDER_ID
//    (atau, kalau lebih gampang, taruh file JSON credential-nya di server
//    lalu isi GOOGLE_SERVICE_ACCOUNT_KEY_FILE dengan path-nya, tidak perlu
//    pecah jadi 2 env var email+private key).
//
// CATATAN KUOTA: Service Account itu "akun robot" yang kuota Drive-nya numpang
// ke pemilik folder kalau foldernya di "My Drive" biasa (limit 15GB gratis
// dari akun Google yang share folder). Kalau dokumennya banyak & lama-lama
// mau lebih dari itu, sebaiknya foldernya dipindah ke Shared Drive (perlu
// Google Workspace) yang kuotanya organisasi, bukan per-akun.
import { google } from "googleapis";
import { Readable } from "stream";

const FOLDER_ID = process.env.GOOGLE_DRIVE_DOKUMEN_FOLDER_ID;

function getAuth() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (keyFile) {
    return new google.auth.GoogleAuth({
      keyFile,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Private key dari Google biasanya multi-baris dengan "\n" literal kalau
  // ditaruh di .env satu baris -- perlu diubah balik jadi newline asli.
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "Kredensial Google Drive belum diisi di .env (GOOGLE_SERVICE_ACCOUNT_EMAIL + " +
        "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, atau GOOGLE_SERVICE_ACCOUNT_KEY_FILE)."
    );
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: key },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

let driveClient = null;
function getDrive() {
  if (!driveClient) driveClient = google.drive({ version: "v3", auth: getAuth() });
  return driveClient;
}

// Upload buffer (hasil multer memoryStorage, lihat middleware/upload.js) ke
// folder Drive yang sudah ditentukan. Filenya dibuat bisa dibuka siapa pun
// yang PUNYA LINK-nya (bukan disebar publik ke pencarian, link-nya acak &
// cuma muncul di panel dokumen BMS), supaya staff bisa langsung klik lihat
// tanpa harus login akun Google kantor dulu.
export async function uploadBufferToDrive(buffer, filename, mimeType) {
  if (!FOLDER_ID) {
    throw new Error("GOOGLE_DRIVE_DOKUMEN_FOLDER_ID belum diisi di .env");
  }
  const drive = getDrive();

  const res = await drive.files.create({
    requestBody: { name: filename, parents: [FOLDER_ID] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: "id, webViewLink",
  });

  const fileId = res.data.id;

  await drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
  });

  return {
    id: fileId,
    viewUrl: res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
  };
}

// Dipanggil waktu file diganti/dihapus dari baris dokumen, supaya file lama
// di Drive ikut kebersihin (tidak numpuk terus-terusan).
export async function deleteFromDrive(fileId) {
  if (!fileId) return;
  try {
    await getDrive().files.delete({ fileId });
  } catch (e) {
    // Kalau file-nya sudah kehapus manual dari Drive / ID sudah tidak valid,
    // jangan sampai proses hapus/ganti dokumen di aplikasi ikut gagal.
    console.error("Gagal hapus file Google Drive:", fileId, e.message);
  }
}
