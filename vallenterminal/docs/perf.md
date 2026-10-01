# Performance Metrics & Budget

Target dan pengujian performa Vallenatrix:

| Kondisi | Target | Catatan Implementasi |
| :--- | :--- | :--- |
| **Idle (tanpa video)** | CPU < 1% | Rendering pasif; xterm.js dan Chromium tidak memicu frame redraw saat tidak ada input. |
| **Idle (dengan video)** | CPU < 5% | Hardware acceleration decoding video aktif; video otomatis di-pause saat window tidak aktif. |
| **Output Besar (`cat` / `find`)** | UI tetap responsif | xterm.js buffer memproses chunk data via IPC streaming tanpa memblokir thread event loop utama. |
| **Batas Scrollback** | 10.000 baris | Membatasi konsumsi memori RAM agar tetap stabil pada sesi terminal jangka panjang. |
| **Waktu Startup** | < 1 detik | Electron-vite memproduksi bundle minimalis tanpa library UI berat (React/Vue tidak digunakan; DOM native). |
