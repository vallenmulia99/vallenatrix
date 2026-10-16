# Manual Testing Checklist

Gunakan checklist ini untuk memverifikasi fitur Vallenatrix:

## 1. Pemasangan & Perintah
- [x] Jalankan `./install.sh` tanpa sudo; symlink `~/.local/bin/vallenatrix` berhasil dibuat.
- [x] Jalankan `vallenatrix --version` mencetak versi.
- [x] Jalankan `vallenatrix --help` mencetak dokumentasi penggunaan.
- [x] Jalankan `./install.sh --uninstall` menghapus symlink dengan bersih.

## 2. Resume Sesi
- [ ] Jalankan `/sessions`, lalu `/resume` tanpa argumen; sesi paling baru harus dilanjutkan.
- [ ] Jalankan `/resume latest`; sesi paling baru yang sama harus dilanjutkan.
- [ ] Tanpa sesi tersimpan, kedua perintah menampilkan `No saved sessions to resume.`

## 3. Window & Shell Interaktif
- [x] Menjalankan `vallenatrix` membuka window frameless dengan titlebar kustom.
- [x] Prompt shell default muncul dan menerima input keyboard.
- [x] Perintah TUI seperti `vim`, `nano`, `htop`, atau `less` berjalan dengan layout yang tepat.
- [x] Mengubah ukuran window (drag sudut/tepi) otomatis menyesuaikan jumlah kolom dan baris xterm.
- [x] Mengetik `exit` di shell otomatis menutup window tanpa meninggalkan proses pty yatim (`ps aux | grep node-pty`).

## 3. Visual & Background
- [x] Window transparan menampilkan desktop di belakangnya.
- [x] Buka panel pengaturan dengan tombol ⚙ di titlebar atau shortcut `Ctrl+,`.
- [x] Mengubah tema warna (mis. Cyber Sakura, Midnight Tokyo, Neo Evangelion) langsung mengubah palet warna.
- [x] Memilih file gambar (`.png`, `.jpg`, `.gif`) menampilkan background di belakang teks terminal.
- [x] Memilih file video (`.mp4`, `.webm`) memutar video berulang (loop) secara senyap.
- [x] Slider Dim Gelap mengatur tingkat kecerahan agar teks tetap kontras dan terbaca.
- [x] Video otomatis pause saat window diminimize atau kehilangan fokus (jika opsi aktif).

## 4. Shortcut & Clipboard
- [x] `Ctrl+Shift+C` meng-copy teks yang dipilih ke clipboard sistem.
- [x] `Ctrl+Shift+V` mem-paste teks clipboard ke dalam terminal.
- [x] `Ctrl+=` memperbesar ukuran font.
- [x] `Ctrl+-` memperkecil ukuran font.
- [x] `Ctrl+0` mereset ukuran font ke 14px.

## 5. Agent Chat & Approval
- [ ] Kirim pesan agent; token streaming tampil bertahap dan jawaban akhir berada di response box.
- [ ] Jalankan tool berisiko; agent menunggu `y`/`n`, approval timeout menolak otomatis.
- [ ] Buka dua terminal, picu approval pada keduanya, lalu balas di tab pemilik prompt; jawaban tidak boleh menyetujui/menolak prompt terminal lain.
- [ ] Jalankan `/stop` saat model berpikir dan saat tool berjalan; turn berhenti tanpa menutup aplikasi.
- [ ] Jalankan `/auto safe`, `/auto off`, dan `/auto on`; status serta perilaku konfirmasi sesuai definisi command.

## 6. Sessions, Planning & Runtime
- [ ] Jalankan `/sessions`, `/resume latest`, dan `/resume` tanpa argumen; sesi terbaru pulih dengan model dan working directory yang sesuai.
- [ ] Jalankan `/session clearall`; pembatalan mempertahankan sesi, konfirmasi menghapusnya.
- [ ] Jalankan `/plan <task>`; plan tersimpan dan tidak ada implementasi file proyek di turn yang sama. `/plans` menampilkan hasilnya.
- [ ] Jalankan `/health`; status gateway dibedakan dari kondisi runtime lain.
- [ ] Jalankan self-review dengan `gateway.background_review: true`; hasil tanpa perubahan tetap senyap, perubahan nyata menunjukkan item yang disimpan.
