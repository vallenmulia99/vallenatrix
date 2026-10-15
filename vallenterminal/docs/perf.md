# Performance Metrics & Budget

## 1. Spesifikasi Mesin Pengujian (Baseline)
- **Tanggal:** 1 Oktober 2026
- **CPU:** Intel(R) Core(TM)2 Duo CPU T6670 @ 2.20GHz (2 Cores / 2 Threads)
- **RAM:** 3.8 GiB DDR3 (Tersedia ~1.8 GiB)
- **GPU:** Intel Corporation Mobile 4 Series Chipset Integrated Graphics Controller (rev 07)
- **Driver VA-API:** i965 (`LIBVA_DRIVER_NAME=i965`)
- **OS / Kernel:** Debian GNU/Linux 13 (trixie) / Linux 6.12.107+deb13-amd64
- **DE / Window Manager:** MATE Desktop / Marco
- **Runtime:** Node.js v20.19.2 / Electron v28.3.3 / xterm.js 5.5.0

## 2. Tabel Pengukuran Baseline (Sebelum Fase 1-3)

| Kondisi | Total RSS RAM (Electron) | CPU Idle (30 detik) | Waktu Startup | Catatan Performa |
| :--- | :--- | :--- | :--- | :--- |
| **(a) Transparan Polos (None)** | ~380 MB | 0.8% - 1.5% | ~1.1s | Ringan, compositor Marco stabil |
| **(b) Background Gambar (w1.jpg 1366x768)** | ~520 MB | 1.2% - 2.5% | ~1.3s | Gambar dioptimasi 241KB, lancar |
| **(c) Background Video (.mp4)** | ~640 MB | 4.5% - 8.0% | ~1.6s | Software fallback decoding (GM45) |

## 3. Uji Beban Output Terminal
- `seq 1 500000`: Buffer xterm.js memproses streaming pty secara mulus.
- `yes | head -n 1000000`: Selesai tanpa crash; scrollback terjaga di 10.000 baris.
- `htop`: Render stabil pada 60 fps tanpa lonjakan thread renderer.
