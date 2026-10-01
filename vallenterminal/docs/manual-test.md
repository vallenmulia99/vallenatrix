# Manual Testing Checklist

Gunakan checklist ini untuk memverifikasi fitur Vallenatrix:

## 1. Pemasangan & Perintah
- [x] Jalankan `./install.sh` tanpa sudo; symlink `~/.local/bin/vallenatrix` berhasil dibuat.
- [x] Jalankan `vallenatrix --version` mencetak versi.
- [x] Jalankan `vallenatrix --help` mencetak dokumentasi penggunaan.
- [x] Jalankan `./install.sh --uninstall` menghapus symlink dengan bersih.

## 2. Window & Shell Interaktif
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
