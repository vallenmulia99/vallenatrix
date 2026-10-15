<div align="center">

<img src="vallenterminal/assets/vallenatrix.png" width="180" alt="Ikon Vallenatrix">

# Vallenatrix

**Terminal Linux transparan dengan live background dan AI assistant lokal.**

Dibuat dengan ☕ dan banyak rasa penasaran oleh **Vallen Mulia** · [@vallenmulia99](https://github.com/vallenmulia99)

[Fitur](#fitur) · [Instalasi](#instalasi) · [Penggunaan](#penggunaan) · [Pengembangan](#pengembangan)

</div>

---

Vallenatrix menggabungkan terminal Linux berbasis Electron dengan tampilan transparan, wallpaper gambar atau video, tema yang bisa diubah, dan assistant AI yang dapat memakai tools. Proyek ini dikembangkan sebagai ruang eksplorasi untuk desktop Linux yang personal dan workflow berbantuan AI.

## Fitur

- **Terminal transparan** yang menyatu dengan desktop Linux.
- **Wallpaper gambar dan video** dengan pilihan mode `cover`, `contain`, dan `fill`.
- **Kontrol tampilan** untuk dim, blur, ukuran font, dan tujuh tema bawaan.
- **Video lebih hemat sumber daya** karena dijeda saat jendela tidak aktif atau diminimalkan.
- **AI assistant terintegrasi** dengan tools untuk file, terminal, web, memori, skills, dan lainnya.
- **90 skill bawaan** (22 kategori) termasuk game development: Unity, Godot, Unreal, Roblox Studio, Blender.
- **9router dan provider OpenAI-compatible lain**, model bisa diganti tanpa restart.
- **Telegram gateway** dengan pairing code, allowlist, dan tombol approve/deny untuk perintah berisiko.
- **Chat dan terminal dalam satu aplikasi**, dengan status proses AI yang terlihat langsung.
- **Approval gate**: perintah shell berbahaya dan path sensitif (`.ssh`, `~/.vallenatrix`, `/etc`, ...) minta konfirmasi `y`/`n` dulu. Default `dangerous`; ubah lewat `agentApproval` di config UI atau env `VALLENATRIX_APPROVAL=all|off|dangerous`.

### Tema bawaan

`Cyber Sakura` · `Dracula` · `Midnight Tokyo` · `Neo Evangelion` · `Ghibli Forest` · `Monochrome Ghost` · `Nord Frost`

## Instalasi

### Persyaratan

- Linux dengan lingkungan desktop grafis
- Node.js 18 atau lebih baru dan npm
- Git

Clone repositori, lalu jalankan installer:

```bash
git clone https://github.com/vallenmulia99/vallenatrix.git
cd vallenatrix
./install.sh
```

Installer memasang dependensi, membangun aplikasi, menyiapkan launcher `~/.local/bin/vallenatrix`, serta mendaftarkan ikon dan menu desktop. Jika direktori tersebut belum ada di `PATH`, ikuti petunjuk yang ditampilkan installer.

Untuk menghapus launcher dan integrasi desktop tanpa menghapus data pengguna:

```bash
./install.sh --uninstall
```

Untuk menghapus instalasi beserta data pengguna, jalankan `./install.sh --purge`. Perintah ini meminta konfirmasi karena menghapus konfigurasi, sesi, memori, dan API key lokal.

## Penggunaan

```bash
vallenatrix              # Buka aplikasi
vallenatrix --foreground # Buka dengan log di terminal
```

Assistant memakai endpoint 9router lokal `http://127.0.0.1:20128/v1` secara default. Siapkan provider dan model yang sesuai melalui konfigurasi aplikasi sebelum mengirim pesan ke assistant.

### Telegram Gateway

Gateway Telegram menjalankan agent sebagai proses terpisah, sehingga tetap aktif saat jendela Vallenatrix ditutup. Siapkan bot melalui [@BotFather](https://t.me/BotFather), buka Vallenatrix, lalu jalankan perintah berikut di input terminal AI:

```text
/geteway tel token <token-dari-BotFather>
/geteway tel pair
```

Kirim `/pair <kode-6-digit>` ke bot melalui chat pribadi dalam lima menit, kemudian jalankan:

```text
/geteway tel start
/geteway tel status
```

Token tersimpan di `~/.vallenatrix/gateway/telegram.json` dengan permission privat. Gateway hanya memproses ID pengguna yang sudah dipasangkan dan chat pribadi. Untuk mencabut akses gunakan `/geteway tel revoke <user-id>`; untuk menghentikan bot gunakan `/geteway tel stop`. Token yang terlanjur terbuka dapat dicabut melalui `/revoke` di @BotFather.

Perintah dari Telegram mencakup `/new`, `/sessions`, `/resume <id>`, `/model [nama]`, `/stop`, `/status`, dan `/help`. Tool berbahaya meminta persetujuan lewat tombol di Telegram. Mode dapat diatur dari terminal dengan `/geteway tel approval dangerous|all|off`.

#### Menjalankan otomatis dengan systemd user

Simpan unit berikut sebagai `~/.config/systemd/user/vallenatrix-gateway.service` dan ganti `/path/to/vallenatrix` dengan lokasi clone:

```ini
[Unit]
Description=Vallenatrix Telegram Gateway
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/vallenatrix
ExecStart=/usr/bin/node /path/to/vallenatrix/vallenagent/dist/gateway/cli.js start
ExecStop=/usr/bin/node /path/to/vallenatrix/vallenagent/dist/gateway/cli.js stop
ExecReload=/usr/bin/node /path/to/vallenatrix/vallenagent/dist/gateway/cli.js restart

[Install]
WantedBy=default.target
```

Aktifkan dengan `systemctl --user daemon-reload` lalu `systemctl --user enable --now vallenatrix-gateway.service`. Untuk mulai otomatis setelah reboot tanpa login desktop, aktifkan linger dengan `loginctl enable-linger "$USER"`. Gateway tidak dapat menerima pesan saat laptop tidur atau mati; atur kebijakan daya agar laptop tetap menyala ketika diperlukan.

### Shortcut

| Tombol | Aksi |
| --- | --- |
| `Ctrl + ,` | Buka atau tutup pengaturan |
| `Ctrl + Shift + C` | Salin teks terpilih |
| `Ctrl + Shift + V` | Tempel teks |
| `Ctrl + =` / `Ctrl + +` | Perbesar font |
| `Ctrl + -` | Perkecil font |
| `Ctrl + 0` | Kembalikan ukuran font |
| `Ctrl + \`` atau `Ctrl + T` | Beralih ke mode shell langsung |

> Shortcut dan perilaku dapat berubah seiring pengembangan.

## Pengembangan

```bash
npm install
npm run dev       # Jalankan mode pengembangan
npm run build     # Build agent dan aplikasi desktop
npm start         # Build agent lalu jalankan aplikasi
npm test          # Jalankan test workspace
```

### Struktur proyek

```text
vallenatrix/
├── vallenagent/       # Runtime AI, tools, provider, memori, dan skills
├── vallenterminal/    # Aplikasi Electron, UI terminal, tema, dan aset
├── watools/           # WhatsApp tools pendukung
└── install.sh         # Installer Linux
```

## Catatan

Vallenatrix masih dikembangkan dan beberapa bagian dapat berubah. Laporkan bug atau saran melalui [GitHub Issues](https://github.com/vallenmulia99/vallenatrix/issues).

## Lisensi

Dirilis di bawah lisensi MIT. Lihat berkas [LICENSE](LICENSE).

<div align="center">

Made with care by **Vallen Mulia** · [GitHub](https://github.com/vallenmulia99)

</div>
