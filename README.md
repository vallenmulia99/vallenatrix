# Vallenatrix

Aplikasi terminal desktop Linux kustom dengan window transparan, dukungan wallpaper / live background (gambar & video anime), dan palet tema warna yang dapat disesuaikan.

## Fitur Utama

- **Window Transparan**: Menembus ke desktop dan wallpaper sistem secara native.
- **Background Media**: Mendukung gambar (`.png`, `.jpg`, `.webp`, `.gif`) serta video (`.mp4`, `.webm`) berulang dengan mode fit (cover, contain, fill).
- **Auto-Pause Video**: Menghemat pemakaian CPU/GPU dengan menjeda video otomatis saat window tidak aktif atau diminimize.
- **Dim & Blur Control**: Pengaturan kecerahan gelap (dim) dan blur agar teks terminal selalu kontras dan terbaca.
- **5 Tema Bawaan**:
  - `Cyber Sakura`
  - `Midnight Tokyo`
  - `Neo Evangelion`
  - `Ghibli Forest`
  - `Monochrome Ghost`
- **Shortcut & Kontrol Font**: Zoom teks cepat (`Ctrl+=`, `Ctrl+-`, `Ctrl+0`), copy/paste standar (`Ctrl+Shift+C`, `Ctrl+Shift+V`), dan toggle panel pengaturan (`Ctrl+,`).

## Instalasi

Jalankan installer di direktori proyek:

```bash
./install.sh
```

Installer akan memeriksa prasyarat Node.js (>= 18), memasang dependensi, membangun aplikasi, dan membuat symlink `~/.local/bin/vallenatrix`.

### Opsi Installer
- `./install.sh`: Instalasi & build
- `./install.sh --uninstall`: Menghapus symlink `vallenatrix`
- `./install.sh --purge`: Menghapus symlink dan data konfigurasi pengguna

## Menjalankan Aplikasi

Setelah terpasang:

```bash
# Jalankan di background (lepas dari shell)
vallenatrix

# Jalankan di foreground (untuk debug log)
vallenatrix --foreground
```

## WhatsApp Remote Agent

Pair WhatsApp with `node watools/wa-client.js connect <nomor>`, then configure `~/.vallenatrix/config.json`:

```json
{
  "platforms": {
    "whatsapp": {
      "enabled": true,
      "mode": "bot",
      "allowedUsers": ["<nomor-pengirim-dengan-kode-negara>"]
    }
  }
}
```

Restart Vallenatrix. Incoming messages from allowlisted numbers run through same agent instance as terminal and appear in terminal; agent replies to WhatsApp. Use `/stop` to interrupt. Laptop and Vallenatrix must stay online. Keep `allowedUsers` explicit; wildcard is rejected.

## Shortcut Keyboard

| Shortcut | Fungsi |
| :--- | :--- |
| `Ctrl + ,` | Buka / tutup panel pengaturan |
| `Ctrl + Shift + C` | Salin teks seleksi ke clipboard |
| `Ctrl + Shift + V` | Tempel teks dari clipboard ke shell |
| `Ctrl + =` / `Ctrl + +` | Perbesar ukuran font |
| `Ctrl + -` | Perkecil ukuran font |
| `Ctrl + 0` | Reset ukuran font ke standar (14px) |

## Struktur Repositori

```
vallenatrix/
├── README.md
├── package.json
├── install.sh
├── bin/
│   └── vallenatrix
├── vallenterminal/
│   ├── package.json
│   ├── src/
│   │   ├── main/       # Electron main process & PTY manager
│   │   ├── preload/    # Secure contextBridge API
│   │   ├── renderer/   # xterm.js, background layer, UI
│   │   └── shared/     # Tipe, schema, IPC channels
│   ├── themes/         # Preset tema JSON
│   ├── tests/          # Pengujian otomatis
│   └── docs/           # decisions.md, spikes.md, manual-test.md, perf.md
└── vallenagent/
    └── README.md       # Placeholder AI agent masa depan
```
