' ============================================================
' PrintSJExcel.vbs
'
' Mencetak file .xlsx (hasil tombol "📊 Export ke Excel" di aplikasi
' BMS) SECARA OTOMATIS lewat Excel, TANPA membuka Excel secara visual
' dan TANPA dialog print browser/Excel sama sekali. Page Setup (ukuran
' kertas, margin, scale 100%) yang dipakai adalah yang sudah tersimpan
' di dalam file .xlsx itu sendiri, jadi hasilnya konsisten dari print ke
' print (tidak seperti browser yang suka reset ke setting defaultnya
' sendiri tiap dialog print dibuka).
'
' CARA PAKAI DI PC PRINT (Windows XP, harus sudah ada Microsoft Excel
' terinstall):
'   1. Simpan file ini di PC print, misalnya di Desktop.
'   2. Klik kanan file ini > Send To > Desktop (create shortcut), lalu
'      pindahkan shortcut itu ke folder SendTo Windows-nya:
'      C:\Documents and Settings\<nama_user>\SendTo
'   3. Setelah itu, tiap ada file .xlsx SJ/Invoice hasil download dari
'      aplikasi, tinggal klik kanan file .xlsx itu > Send To > pilih
'      shortcut "PrintSJExcel" tadi -> otomatis kecetak, tanpa perlu
'      buka Excel atau atur apapun.
'
'   (Alternatif tanpa Send To: bisa juga drag file .xlsx langsung ke
'   atas ikon PrintSJExcel.vbs ini di Explorer.)
'
' CATATAN:
'   - Kalau nanti mau ganti printer default / jumlah rangkap, atur
'     lewat "Printers and Faxes" di Windows seperti biasa - script ini
'     ikut printer default Windows, tidak menentukan printer sendiri.
'   - Kalau file punya beberapa Surat Jalan sekaligus (beberapa sheet),
'     semuanya otomatis kecetak berurutan dalam satu proses.
' ============================================================

Dim objExcel, objWorkbook, filePath, ws

If WScript.Arguments.Count = 0 Then
    MsgBox "Drag/kirim file .xlsx ke atas script ini untuk mencetak." & vbCrLf & _
           "(klik kanan file .xlsx > Send To > PrintSJExcel)", vbExclamation, "Print BMS"
    WScript.Quit
End If

filePath = WScript.Arguments(0)

On Error Resume Next

Set objExcel = CreateObject("Excel.Application")
If Err.Number <> 0 Then
    MsgBox "Microsoft Excel tidak ditemukan di komputer ini. " & _
           "Script ini butuh Excel terinstall untuk mencetak.", vbCritical, "Print BMS"
    WScript.Quit
End If

objExcel.Visible = False
objExcel.DisplayAlerts = False

Set objWorkbook = objExcel.Workbooks.Open(filePath)
If Err.Number <> 0 Then
    MsgBox "Gagal membuka file: " & filePath & vbCrLf & Err.Description, vbCritical, "Print BMS"
    objExcel.Quit
    WScript.Quit
End If

' PENTING: cetak SELURUH workbook sebagai SATU print job (bukan
' worksheet satu-satu). Kalau di-loop per sheet, tiap sheet dikirim
' sebagai dokumen terpisah ke printer, dan banyak driver dot matrix
' akan eject/form-feed kertas di antara tiap dokumen - jadi ada jeda
' kosong di kertas continuous form padahal harusnya SJ-nya nyambung
' langsung. objWorkbook.PrintOut mengirim semua sheet sekaligus dalam
' satu job sehingga tetap nyambung.
objWorkbook.PrintOut

If Err.Number <> 0 Then
    MsgBox "Gagal mencetak: " & Err.Description, vbCritical, "Print BMS"
End If

objWorkbook.Close False
objExcel.Quit

Set objWorkbook = Nothing
Set objExcel = Nothing
