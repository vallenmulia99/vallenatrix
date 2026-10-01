# Architecture & Technology Decisions

## 1. Bundler: Electron-Vite
- **Pilihan:** `electron-vite` (Vite 5 + Rollup)
- **Alasan:**
  - Konfigurasi terpusat dan pemisahan yang bersih antara `main`, `preload`, dan `renderer`.
  - Waktu build sangat cepat (< 5 detik untuk full build).
  - TypeScript terintegrasi tanpa perlu konfigurasi Babel atau Webpack yang rumit.
  - Native ESM support dan SSR bundle yang rapi untuk process main.

## 2. Terminal Core: @xterm/xterm
- **Pilihan:** `@xterm/xterm` v5.5.0 dengan `@xterm/addon-fit` dan `@xterm/addon-web-links`.
- **Alasan:**
  - Mendukung `allowTransparency: true` dan warna background `rgba(0,0,0,0)`.
  - Ekosistem standar industri untuk terminal berbasis web.
  - Addon-fit menangani resize kolom dan baris secara dinamis menyesuaikan ukuran window.

## 3. PTY Engine: node-pty
- **Pilihan:** `node-pty` v1.0.0.
- **Alasan:**
  - PTY native Linux yang stabil, mendukung shell interaktif (bash/zsh/fish) dan aplikasi berbasis curses/TUI (`vim`, `htop`, `nano`, `less`).
  - Dijalankan di proses Main; tidak pernah diekspos langsung ke Renderer.

## 4. Keamanan dan Isolasi IPC
- **Pilihan:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- **Alasan:**
  - Mencegah eksekusi arbitrary code jika ada input teks yang berbahaya.
  - Semua operasi file dan pty ditangani di Main process dan diverifikasi sebelum dieksekusi.
  - Media background dilayani lewat custom standard protocol `vallen-media://` dengan validasi ekstensi dan batas ukuran file (maks 500MB).
