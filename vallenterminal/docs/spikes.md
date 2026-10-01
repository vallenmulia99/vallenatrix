# Spike Results (Fase 0)

Lingkungan Uji:
- **OS / Distro:** Linux 6.12 (Debian / Linux amd64)
- **Desktop Environment:** MATE (X11, DISPLAY :0)
- **Node.js:** v20.19.2
- **Electron:** v28.0.0
- **xterm.js:** v5.5.0

---

## Spike A: Window Transparan
- **Konfigurasi:** `BrowserWindow` dengan `transparent: true`, `frame: false`, `backgroundColor: '#00000000'`.
- **Hasil:** Berhasil.
- **Catatan:** Pada Linux dengan X11 + compositor (Marco/Picom/Mutter), transparansi alpha channel tembus ke desktop dan live wallpaper. Tidak membutuhkan flag usang `--disable-gpu`.

## Spike B: xterm.js + Transparansi
- **Konfigurasi:** `allowTransparency: true` dan `theme.background = 'rgba(0, 0, 0, 0)'`.
- **Hasil:** Berhasil.
- **Catatan:** xterm DOM & Canvas renderer merender teks, cursor, dan highlight di atas lapisan background tanpa memblokir transparansi layer di belakangnya.

## Spike C: Video Background
- **Konfigurasi:** HTML5 `<video>` autoplay, loop, muted dengan layer `object-fit: cover`.
- **Hasil:** Berhasil.
- **Catatan:** Format `.mp4` (H.264) dan `.webm` (VP8/VP9) didukung secara native oleh Chromium build Electron. Handler auto-pause diimplementasikan saat window blur/minimize untuk menghemat CPU.

## Spike D: node-pty & Linux Sandbox
- **Konfigurasi:** `spawn()` shell bawaan (`process.env.SHELL || '/bin/bash'`) dari Main process.
- **Hasil:** Berhasil.
- **Catatan:** Modul native `node-pty` wajib di-rebuild menggunakan header Electron (`node-gyp@10 rebuild --target=28.0.0 --dist-url=https://electronjs.org/headers`) agar ABI V8 cocok (Node ABI 115 vs Electron 28 ABI 119) untuk mencegah SIGSEGV. Di bundler `electron-vite`, `node-pty` wajib di-externalize lewat `externalizeDepsPlugin({ include: ['node-pty'] })` agar C++ binary tidak di-bundle rollup. Shell berjalan lancar tanpa `--no-sandbox`.
