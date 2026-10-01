#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
BIN_SOURCE="$SCRIPT_DIR/bin/vallenatrix"
TARGET_DIR="$HOME/.local/bin"
TARGET_LINK="$TARGET_DIR/vallenatrix"
CONFIG_DIR="$HOME/.config/vallenterminal"

show_help() {
  cat << EOF
Vallenatrix Installer

Penggunaan:
  ./install.sh [opsi]

Opsi:
  (tanpa opsi)       Pasang dependensi, build project, dan buat symlink ~/.local/bin/vallenatrix
  --uninstall        Hapus symlink vallenatrix dari ~/.local/bin (data konfigurasi tetap aman)
  --purge            Hapus symlink serta data konfigurasi pengguna ($CONFIG_DIR) dengan konfirmasi
  --help, -h         Tampilkan bantuan ini
EOF
}

uninstall_action() {
  echo "Menjalankan proses uninstall vallenatrix..."
  if [ -L "$TARGET_LINK" ] || [ -f "$TARGET_LINK" ]; then
    rm -f "$TARGET_LINK"
    echo "Berhasil menghapus symlink: $TARGET_LINK"
  else
    echo "Symlink $TARGET_LINK tidak ditemukan. Tidak ada yang dihapus."
  fi
  echo "Uninstall selesai. Direktori konfigurasi Anda tetap tersimpan."
}

purge_action() {
  echo "PERINGATAN: Opsi --purge akan menghapus symlink dan seluruh data konfigurasi serta tema kustom di:"
  echo "  $CONFIG_DIR"
  read -r -p "Ketik 'YA' untuk mengonfirmasi penghapusan permanen: " confirmation
  if [ "$confirmation" != "YA" ]; then
    echo "Penghapusan dibatalkan."
    exit 0
  fi

  uninstall_action

  if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    echo "Berhasil menghapus direktori konfigurasi: $CONFIG_DIR"
  else
    echo "Direktori konfigurasi tidak ditemukan."
  fi
  echo "Purge selesai."
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  show_help
  exit 0
elif [ "${1:-}" = "--uninstall" ]; then
  uninstall_action
  exit 0
elif [ "${1:-}" = "--purge" ]; then
  purge_action
  exit 0
elif [ -n "${1:-}" ]; then
  echo "Opsi tidak dikenal: $1"
  echo "Jalankan './install.sh --help' untuk melihat daftar opsi."
  exit 1
fi

echo "==============================================="
echo "        Memulai Instalasi Vallenatrix          "
echo "==============================================="

# 1. Cek prasyarat: Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js belum terpasang di sistem."
  echo "Silakan pasang Node.js (minimum v18.0.0):"
  echo "  sudo apt install nodejs (atau gunakan nvm / fnm)"
  exit 1
fi

NODE_MAJOR=$(node -v | sed -E 's/v([0-9]+).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Versi Node.js yang terdeteksi ($(node -v)) terlalu lawas."
  echo "Vallenatrix membutuhkan Node.js v18 atau lebih baru."
  exit 1
fi

# 2. Cek prasyarat: npm
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm belum terpasang di sistem."
  echo "Silakan pasang npm:"
  echo "  sudo apt install npm"
  exit 1
fi

# 3. Informasikan paket yang akan dipasang
echo "Pemeriksaan sistem berhasil: Node $(node -v), npm v$(npm -v)."
echo "Instalasi akan menjalankan:"
echo "  1. npm install (dependensi xterm, electron, electron-vite, node-pty)"
echo "  2. npm run build (kompilasi TypeScript & aset frontend)"
echo "  3. Symlink ~/.local/bin/vallenatrix -> $BIN_SOURCE"
echo ""

# 4. Install dependensi
echo "[1/4] Memeriksa dan menginstal dependensi npm..."
cd "$SCRIPT_DIR"
npm install

# 5. Rebuild node-pty untuk ABI Electron
echo "[2/4] Melakukan build native module node-pty untuk Electron..."
npm run rebuild:pty

# 6. Build aplikasi
echo "[3/4] Membangun bundel aplikasi (vallenterminal)..."
npm -w vallenterminal run build

# 7. Setup symlink ~/.local/bin/vallenatrix
echo "[4/4] Menyiapkan perintah launcher..."
mkdir -p "$TARGET_DIR"
chmod +x "$BIN_SOURCE"

if [ -L "$TARGET_LINK" ] || [ -f "$TARGET_LINK" ]; then
  rm -f "$TARGET_LINK"
fi

ln -s "$BIN_SOURCE" "$TARGET_LINK"
echo "Symlink berhasil dibuat: $TARGET_LINK -> $BIN_SOURCE"

# 7. Cek PATH
if [[ ":$PATH:" != *":$TARGET_DIR:"* ]]; then
  echo ""
  echo "Pemberitahuan: Direktori $TARGET_DIR belum ada di PATH shell Anda."
  echo "Agar perintah 'vallenatrix' bisa dipanggil langsung dari mana saja, tambahkan baris berikut ke ~/.bashrc (atau ~/.zshrc):"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi

echo "==============================================="
echo "      Instalasi Vallenatrix Selesai!           "
echo "==============================================="
echo "Untuk menjalankan, gunakan perintah:"
echo "  vallenatrix"
echo "Atau jalankan langsung: $TARGET_LINK"
echo "Untuk debug di foreground: vallenatrix --foreground"
