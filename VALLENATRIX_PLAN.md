# PROJECT: vallenatrix (terminal custom transparan + background anime)

Dokumen ini berdiri sendiri. Kamu (agent) tidak punya konteks proyek lain; semua yang perlu diketahui ada di sini. Baca seluruhnya sebelum menulis kode. Komunikasi dengan user dalam Bahasa Indonesia santai; istilah teknis boleh tetap Inggris.

## 0. Ringkasan

User ingin **aplikasi terminal desktop buatan sendiri** (Linux dulu) yang:
1. **Window-nya transparan**, sehingga desktop/live wallpaper di belakangnya terlihat.
2. Bisa **memasang background sendiri**: gambar (`.png/.jpg/.webp/.gif`) dan video (`.mp4/.webm`), dengan pengaturan dim/opacity/fit.
3. Punya **banyak theme** yang bisa diganti cepat.
4. Dijalankan dengan perintah **`vallenatrix`** setelah dipasang lewat **`install.sh`**.

**Scope sekarang: HANYA terminal (`vallenterminal/`).** Folder `vallenagent/` hanya dibuat sebagai **placeholder kosong** untuk masa depan (lihat 2).

**Non-goal (dilarang tanpa persetujuan user):**
- Menulis emulator terminal dari nol. Pakai xterm.js.
- Membangun AI agent, atau mengisi `vallenagent/` dengan kode apa pun.
- Cloud, akun, telemetry, auto-update dari server pihak ketiga.
- Fitur di luar daftar fase di bawah. Pet dan tab/split hanya dikerjakan jika user setuju.

**Stack yang disepakati:** Electron + TypeScript + xterm.js (`@xterm/xterm` + addon) + node-pty. Bundler/boilerplate (Electron Forge + Vite atau electron-vite) dipilih agent; catat alasan di `vallenterminal/docs/decisions.md`.

## 1. Prinsip kerja
1. **Verifikasi dulu, bangun kemudian.** Semua klaim teknis di dokumen ini adalah asumsi dari riset awal dan **belum pernah dijalankan**. Fase 0 (spike) wajib dikerjakan dan dicatat sebelum arsitektur dikunci.
2. **Satu fase, satu hasil yang bisa dicoba.** Selesaikan acceptance criteria sebelum lanjut.
3. **Stabilitas dan performa di atas fitur.** Terminal harus tetap responsif walau ada background video.
4. **Dependensi harus beralasan.** Tiap paket yang ditambah dicatat dengan alasannya di `decisions.md`.
5. **Jika ada yang tidak jalan di mesin user, berhenti dan laporkan.** Jangan disembunyikan dengan hack.
6. **Dokumentasikan batasan** (mis. "blur desktop tidak didukung di compositor X").
7. **Rapi sejak awal:** struktur folder, penamaan, dan pemisahan main/preload/renderer/shared harus konsisten (lihat 2).

## 2. Struktur repo (WAJIB diikuti)

```
vallenatrix/
├── README.md                  # cara pasang, jalankan, struktur singkat
├── package.json               # root, private; npm workspaces: ["vallenterminal"]
├── .gitignore
├── .editorconfig
├── install.sh                 # installer (lihat 3)
├── bin/
│   └── vallenatrix            # launcher (lihat 4)
├── vallenterminal/            # aplikasi terminal (dikerjakan sekarang)
│   ├── package.json
│   ├── tsconfig.json
│   ├── (konfigurasi bundler pilihan agent)
│   ├── src/
│   │   ├── main/              # window, pty, IPC handler, config, paths
│   │   ├── preload/           # contextBridge API bertipe
│   │   ├── renderer/          # xterm.js, layer background, UI pengaturan, styles
│   │   └── shared/            # tipe, schema zod (config, theme), nama channel IPC
│   ├── themes/                # theme bawaan (JSON)
│   ├── assets/                # ikon aplikasi, placeholder/gradien bawaan
│   ├── tests/
│   └── docs/                  # decisions.md, spikes.md, perf.md, manual-test.md
└── vallenagent/
    └── README.md              # placeholder: "Dicadangkan untuk AI agent. Belum ada kode."
```

Aturan struktur:
- `vallenagent/` **hanya berisi `README.md`** berisi satu paragraf placeholder. Tidak ada `package.json`, tidak ada kode, **tidak** masuk `workspaces` dan tidak ikut build/install.
- Satu file satu tanggung jawab (mis. `pty.ts` hanya urus pty, `config.ts` hanya urus config). Hindari file raksasa.
- Tipe dan schema bersama hanya di `src/shared/`. Renderer tidak boleh meng-import dari `src/main/`, dan sebaliknya.
- Dokumentasi proyek-terminal di `vallenterminal/docs/`; README root ringkas dan menunjuk ke sana.

## 3. `install.sh`
Skrip bash untuk Linux, tujuan: satu perintah memasang semuanya dan membuat perintah `vallenatrix`.

Perilaku wajib:
- `set -euo pipefail`; pesan dalam Bahasa Indonesia; berhenti dengan pesan jelas jika prasyarat tidak ada.
- Cek prasyarat: Node.js (versi minimum ditentukan agent setelah Fase 0 dan dicatat), npm, dan alat build yang dibutuhkan node-pty (mis. kompiler) jika tidak ada binary prebuilt. Jangan memasang prasyarat sistem secara diam-diam; beri tahu user apa yang kurang dan cara memasangnya.
- Langkah: `npm install` (workspace) lalu build `vallenterminal`, lalu membuat symlink `~/.local/bin/vallenatrix` ke `bin/vallenatrix` di repo.
- **Tanpa `sudo`, tanpa instalasi global npm, tanpa `curl | bash` dari sumber lain.** Satu-satunya unduhan adalah dependensi npm (termasuk binary Electron yang diunduh paket `electron`); sebelum mulai, **cetak apa yang akan diunduh dan dipasang**.
- **Idempotent:** dijalankan dua kali tidak merusak apa pun.
- Jika `~/.local/bin` tidak ada di `PATH`, beri peringatan dan tunjukkan baris yang perlu ditambahkan ke shell rc user (jangan mengubah rc otomatis).
- `./install.sh --uninstall`: hanya menghapus symlink. Menghapus data/config user hanya lewat `--purge` dan **dengan konfirmasi eksplisit** (data user = direktori config aplikasi, termasuk theme dan background yang user pasang).
- `./install.sh --help` menjelaskan semua opsi.

## 4. Perintah `vallenatrix` (`bin/vallenatrix`)
- Menemukan root repo walau dipanggil lewat symlink (resolve path asli).
- Default: menjalankan aplikasi dan **melepaskannya dari shell** (shell langsung kembali). `--foreground` menjalankan di depan dan menampilkan log (berguna untuk debug).
- Opsi: `--help`, `--version` (versi dari `package.json`), `--foreground`.
- Jika aplikasi belum di-build, cetak pesan jelas yang menyuruh menjalankan `install.sh`, bukan stack trace.
- Meneruskan exit code yang benar; tidak meninggalkan proses yatim.

## 5. FASE 0: Spike (prototipe kecil, boleh dibuang)
Empat risiko yang harus dibuktikan **di mesin user**. Catat distro, desktop environment/compositor, dan versi Electron. Hasil di `vallenterminal/docs/spikes.md` (berhasil/gagal/catatan).

**Spike A: window transparan.** `BrowserWindow` dengan `transparent: true`, `frame: false`, background `#00000000`. Uji: wallpaper (termasuk live wallpaper) tembus; resize/drag; artefak visual. Di Linux transparansi umumnya butuh compositor aktif. Dokumentasi Electron versi lama menyebut flag khusus di Linux (mis. `--enable-transparent-visuals` dengan `--disable-gpu`); **cek apakah masih berlaku di versi yang dipakai.** Jika menonaktifkan GPU diperlukan, itu bertabrakan dengan WebGL dan video, jadi ukur dampaknya dan laporkan kompromi ke user.

**Spike B: xterm.js + transparansi.** Terminal dengan `allowTransparency` dan background `rgba(0,0,0,0)` di atas gambar dan di atas video. Bandingkan renderer yang tersedia di versi terpasang (DOM, canvas, WebGL addon). **Risiko diketahui:** proyek terminal Electron lain (Hyper) pernah menonaktifkan WebGL saat butuh background transparan karena belum didukung, sementara aplikasi Electron lain memakai xterm.js + WebGL dengan overlay transparan. Jangan mengandalkan asumsi pihak lain; uji dan tetapkan renderer default plus fallback.

**Spike C: video background.** Putar `.mp4` (H.264) dan `.webm` (VP9) lewat `<video>` di belakang terminal. Cek dukungan codec di build Electron terpilih. Ukur CPU/GPU saat idle dan saat output besar. Uji pause saat window tidak fokus/minimize.

**Spike D: node-pty + sandbox Linux.** Pasang `node-pty` di Electron terpilih (modul native; mungkin perlu rebuild atau paket prebuilt). Jalankan shell, kirim input, resize. Catat prasyarat build. Di Linux, Electron sering menolak start karena konfigurasi `chrome-sandbox`; **jangan menambahkan `--no-sandbox` diam-diam.** Jika dibutuhkan, laporkan ke user dan catat konsekuensi keamanannya.

**Keluaran Fase 0:** `spikes.md` dan keputusan terkunci: versi Electron, versi minimum Node, renderer xterm default dan fallback, format video yang didukung, cara memasang node-pty. **Berhenti dan laporkan ke user jika Spike A atau B gagal**; itu inti proyek, jangan lanjut membangun di atas asumsi yang gagal.

## 6. FASE 1: MVP terminal + `install.sh` + `vallenatrix`
Satu window, satu terminal, shell default (`$SHELL`, fallback `/bin/bash`).
- Main: membuat window dan mengelola pty. Renderer: xterm.js + `FitAddon`, `WebLinksAddon`, clipboard. Komunikasi lewat IPC bertipe (preload + `contextBridge`).
- Resize window menyesuaikan kolom/baris pty. Menutup window mematikan proses pty.
- Font monospace dari config, ukuran bisa diubah (Ctrl+= / Ctrl+-). Shortcut dasar: copy/paste, clear, zoom font.
- Kerjakan `install.sh` dan `bin/vallenatrix` di fase ini supaya MVP bisa dicoba lewat perintah sebenarnya.

**Acceptance:** `./install.sh` sukses (dijalankan dua kali pun aman); `vallenatrix` membuka window dan shell interaktif; `vim`/`htop`/`less` tampil benar; resize tidak merusak layout; `exit` menutup window; tidak ada proses pty tersisa; `--uninstall` bekerja.

## 7. FASE 2: Lapisan penampilan (inti proyek)
Layer dari belakang ke depan:
1. Window transparan (OS)
2. **Background layer**: warna solid / gambar / GIF / video
3. **Overlay layer**: dim (warna + alpha) dan blur CSS opsional
4. **Terminal layer**: xterm.js dengan background transparan

Pengaturan wajib:
- Opacity window, opacity background, alpha overlay (dim) agar teks tetap terbaca.
- Mode fit: `cover`, `contain`, `stretch`.
- Video: loop, mute (default mute), **pause otomatis saat window tidak terlihat/fokus** (bisa dimatikan), batas FPS bila memungkinkan.
- File picker untuk background; file disalin ke direktori data aplikasi atau direferensikan lewat path tervalidasi. Validasi tipe dan ukuran file.
- **Blur:** CSS `backdrop-filter` hanya mengaburkan isi di dalam halaman, bukan desktop di belakang window. Blur desktop adalah fitur compositor/OS yang berbeda per platform; jangan dijanjikan, cukup dokumentasikan hasil Fase 0.
- Fallback elegan: jika transparansi window tidak didukung, tampilkan background solid dengan pesan jelas, bukan layar hitam atau crash.

**Acceptance:** wallpaper user tembus di belakang terminal; gambar dan video bisa dipasang/dilepas tanpa restart; teks terbaca di atas background ramai; video berhenti saat window di-minimize.

## 8. FASE 3: Sistem theme
- Theme = file JSON tervalidasi (zod atau setara): nama, 16 warna ANSI, foreground, cursor, selection, font, preset background (jenis, file, dim, fit).
- Disimpan di direktori data aplikasi (`app.getPath('userData')`), bukan di folder proyek. Theme bawaan dikemas di dalam aplikasi (`vallenterminal/themes/`).
- **5 theme bawaan** (variasi gelap/terang; minimal 2 bernuansa anime). **Jangan menyertakan gambar karakter berhak cipta**; pakai gradien/placeholder, user memasang gambarnya sendiri lewat file picker.
- Ganti theme tanpa restart, impor/ekspor JSON, pesan error jelas jika file rusak.

**Acceptance:** ganti theme langsung mengubah warna dan background; file theme rusak tidak membuat aplikasi crash.

## 9. FASE 4: Pengaturan dan UX
- Panel pengaturan (Ctrl+,) dan command palette sederhana untuk ganti theme/background/opacity.
- Config JSON bertipe; default aman jika file hilang atau rusak.
- Tab dan split hanya jika user meminta setelah Fase 3.

## 10. Di luar scope sekarang (jangan dikerjakan sebelum disetujui)
- **Pet:** sprite animasi ringan di pojok window, `pointer-events: none`, bisa dimatikan. Rancang event bus sederhana dari awal agar mudah disambung nanti, tapi jangan membangun pet-nya.
- **`vallenagent/`:** tetap placeholder. Nanti user akan memutuskan isinya. Siapkan saja opsi config "perintah awal" (default shell) supaya terminal kelak bisa menjalankan program lain.
- **Packaging distribusi** (AppImage/deb, rilis npm): setelah semua fase di atas stabil. Jika ada unduhan saat instalasi, wajib transparan dan memeriksa checksum.

## 11. Budget performa (diukur, bukan ditebak)
Tulis hasil ukur di `docs/perf.md` setiap fase:
- Idle tanpa video: CPU mendekati nol.
- Idle dengan video: catat CPU/GPU; harus ada opsi mematikan video atau menurunkan FPS.
- Output besar: `cat` file besar (puluhan MB) dan `yes | head -n 1000000`; UI tidak boleh membeku.
- Scrollback dibatasi default (mis. 10.000 baris) dan bisa dikonfigurasi.
- Jika video menyebabkan lag input, nonaktifkan otomatis dan beri tahu user.

## 12. Keamanan Electron (wajib sejak Fase 1)
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Renderer hanya bicara lewat IPC bertipe dari `preload`; **jangan** mengekspos `require`/`fs`/`child_process` ke renderer.
- CSP ketat; **tanpa konten remote** (tidak memuat gambar/video/skrip dari URL). Background hanya dari file lokal tervalidasi.
- Semua path dari renderer divalidasi di main process (cegah path traversal), batasi ekstensi dan ukuran.
- Pty berjalan dengan hak user biasa; jangan pernah meminta root.

## 13. Pengujian
- Unit test (Vitest atau setara): schema config/theme, validasi path, parsing pengaturan.
- Checklist manual per fase di `docs/manual-test.md`: shell dasar, aplikasi TUI (`vim`, `htop`), resize, paste besar, transparansi, ganti theme, video play/pause, tutup window tanpa proses yatim, install/uninstall.
- E2E (Playwright untuk Electron) opsional; jangan menunda fase inti untuk itu.

## 14. Aturan berhenti dan pelaporan
- Spike A atau B gagal di mesin user: **berhenti**, laporkan, tawarkan alternatif.
- Menemukan asumsi dokumen ini salah: catat di `decisions.md` dan beri tahu user.
- Di akhir tiap fase tulis ringkasan: apa yang jadi, apa yang diuji, apa yang belum bisa diverifikasi, dan hasil ukur performa.
- Dilarang: `git push`, instalasi global di mesin user di luar `~/.local/bin/vallenatrix` (lewat `install.sh`), unduhan di luar paket yang tercatat, mengubah file di luar folder proyek dan direktori config aplikasi.
