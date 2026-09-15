// Integrasi Google Drive -- dipakai supaya file dokumen kelengkapan aset
// (STNK, KIR, Invoice, SIA, dst di menu Armada/Kapal/Alat Berat) TIDAK
// disimpan di disk lokal server. Disk hosting gratisan (Railway/Render dst)
// sifatnya EPHEMERAL -- bisa hilang tiap kali service di-redeploy/restart.
// Dengan ini, waktu user upload file seperti biasa lewat form, filenya
// otomatis dikirim ke folder Google Drive yang sudah ditentukan, dan yang
// disimpan di database cuma link-nya.
//
// KENAPA PAKAI OAUTH2 (bukan Service Account)?
// Service Account punya kuota penyimpanan 0 byte. Kalau akun Drive tujuan
// adalah Gmail biasa (bukan Google Workspace / tidak ada Shared Drive),
// Service Account akan GAGAL upload dengan error "Service Accounts do not
// have storage quota". Makanya di sini kita otentikasi pakai akun Gmail
// kamu sendiri lewat OAuth2 -- file yang di-upload jadi "milik" akun Gmail
// itu (pakai kuota 15GB gratisnya), bukan milik robot.
//
// SETUP YANG DIBUTUHKAN (sekali saja):
// 1. Buka https://console.cloud.google.com -> buat/pilih project -> aktifkan
//    "Google Drive API".
// 2. Ke "APIs & Services" > "OAuth consent screen":
//    - User Type: External -> Create
//    - Isi App name (bebas), User support email, Developer contact email
//    - Scopes: skip / next saja
//    - Test users: TAMBAHKAN email Gmail kamu sendiri di sini (wajib,
//      karena app belum "Published" / masih mode testing)
// 3. Ke "APIs & Services" > "Credentials" -> "+ CREATE CREDENTIALS" ->
//    "OAuth client ID" -> Application type: "Desktop app" -> Create.
//    Catat CLIENT_ID dan CLIENT_SECRET yang muncul.
// 4. Jalankan sekali script backend/scripts/getGoogleRefreshToken.js (lihat
//    file itu untuk caranya) buat dapetin REFRESH_TOKEN. Ini cuma dilakukan
//    SEKALI di komputer kamu, hasilnya di-copy ke .env server.
// 5. Buat 1 folder khusus di Google Drive kamu (mis. "BMS - Dokumen Aset"),
//    ambil ID folder-nya dari URL:
//    https://drive.google.com/drive/folders/<FOLDER_ID_DI_SINI>
// 6. Isi 4 env var di .env (lihat .env.example):
//    - GOOGLE_OAUTH_CLIENT_ID
//    - GOOGLE_OAUTH_CLIENT_SECRET
//    - GOOGLE_OAUTH_REFRESH_TOKEN
//    - GOOGLE_DRIVE_DOKUMEN_FOLDER_ID
import { google } from "googleapis";
import { Readable } from "stream";

const FOLDER_ID = process.env.GOOGLE_DRIVE_DOKUMEN_FOLDER_ID;

let oauthClient = null;
function getAuth() {
  if (oauthClient) return oauthClient;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Kredensial Google Drive (OAuth2) belum diisi di .env -- butuh " +
        "GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN. " +
        "Lihat panduan di backend/src/services/googleDrive.js"
    );
  }

  oauthClient = new google.auth.OAuth2(clientId, clientSecret);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  return oauthClient;
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
