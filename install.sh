#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
if [ ! -f "$SCRIPT_DIR/package.json" ]; then
  INSTALL_ROOT="$HOME/.local/share/vallenatrix/source"
  if ! command -v git >/dev/null 2>&1; then
    echo "Error: Git needed to download Vallenatrix. Install Git and retry."
    exit 1
  fi
  if [ -d "$INSTALL_ROOT/.git" ]; then
    git -C "$INSTALL_ROOT" pull --ff-only
  elif [ -e "$INSTALL_ROOT" ]; then
    echo "Error: $INSTALL_ROOT exists but is not a Vallenatrix Git checkout."
    exit 1
  else
    mkdir -p "$(dirname "$INSTALL_ROOT")"
    git clone --depth 1 --branch main https://github.com/vallenmulia99/vallenatrix.git "$INSTALL_ROOT"
  fi
  exec bash "$INSTALL_ROOT/install.sh" "$@"
fi

BIN_SOURCE="$SCRIPT_DIR/bin/vallenatrix"
TARGET_DIR="$HOME/.local/bin"
TARGET_LINK="$TARGET_DIR/vallenatrix"
CONFIG_DIR="$HOME/.config/vallenterminal"
AGENT_DATA_DIR="$HOME/.vallenatrix"
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
ICON_PATH="$ICON_DIR/vallenatrix.png"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/vallenatrix.desktop"

show_help() {
  cat << EOF
Vallenatrix Installer

Penggunaan:
  ./install.sh [opsi]

Opsi:
  (tanpa opsi)       Tampilkan menu installer
  --install-vallenatrix  Pasang Vallenatrix saja
  --install-9router      Pasang 9router lalu Vallenatrix CLI
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
  rm -f "$DESKTOP_FILE" "$ICON_PATH"
  echo "Menu aplikasi dan ikon dihapus; direktori konfigurasi tetap tersimpan."
}

purge_action() {
  echo "PERINGATAN: Opsi --purge akan menghapus symlink dan seluruh data konfigurasi serta tema kustom di:"
  echo "  $CONFIG_DIR"
  echo "  $AGENT_DATA_DIR (agent config, sessions, memories, API keys)"
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
  if [ -d "$AGENT_DATA_DIR" ]; then
    rm -rf "$AGENT_DATA_DIR"
    echo "Berhasil menghapus direktori data agent: $AGENT_DATA_DIR"
  else
    echo "Direktori data agent tidak ditemukan."
  fi
  echo "Purge selesai."
}

INSTALL_MODE="${1:-}"
if [ -z "$INSTALL_MODE" ]; then
  echo "==============================================="
  echo "             Vallenatrix Installer             "
  echo "==============================================="
  echo "1) Install Vallenatrix"
  echo "2) Install 9router + Vallenatrix CLI"
  read -r -p "Pilih [1/2]: " choice
  case "$choice" in
    1) INSTALL_MODE="--install-vallenatrix" ;;
    2) INSTALL_MODE="--install-9router" ;;
    *) echo "Pilihan tidak valid."; exit 2 ;;
  esac
fi

if [ "$INSTALL_MODE" = "--install-9router" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm belum terpasang."
    exit 1
  fi
  npm i -g 9router@latest --prefer-online
  echo "9router terpasang."
  bash "$SCRIPT_DIR/setup9router/install.sh"
  echo "Vallenatrix pakai endpoint OpenAI-compatible 9router: http://127.0.0.1:20128/v1"
  INSTALL_MODE="--install-vallenatrix"
fi

if [ "$INSTALL_MODE" = "--install-vallenatrix" ]; then
  set --
elif [ "$INSTALL_MODE" = "--uninstall" ]; then
  set -- --uninstall
elif [ "$INSTALL_MODE" = "--purge" ]; then
  set -- --purge
fi

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
echo "  1. npm ci (lockfile tersedia), atau npm install (tanpa lockfile)"
echo "  2. npm run build (kompilasi TypeScript & aset frontend)"
echo "  3. Symlink ~/.local/bin/vallenatrix -> $BIN_SOURCE"
echo ""

# 4. Install dependensi
echo "[1/4] Memeriksa dan menginstal dependensi npm..."
cd "$SCRIPT_DIR"
if [ -f "$SCRIPT_DIR/package-lock.json" ]; then
  npm ci
else
  npm install
fi

# 5. Rebuild node-pty untuk ABI Electron
echo "[2/4] Melakukan build native module node-pty untuk Electron..."
npm run rebuild:pty

# 6. Build aplikasi
echo "[3/4] Membangun bundel aplikasi (vallenagent + vallenterminal)..."
npm -w vallenagent run build
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

mkdir -p "$ICON_DIR" "$DESKTOP_DIR"
install -m 644 "$SCRIPT_DIR/vallenterminal/assets/vallenatrix.png" "$ICON_PATH"
printf '[Desktop Entry]\nName=Vallenatrix\nComment=Terminal Vallenatrix\nExec="%s"\nIcon=vallenatrix\nTerminal=false\nType=Application\nCategories=Utility;TerminalEmulator;\nStartupWMClass=Vallenatrix\nActions=NewWindow;\n\n[Desktop Action NewWindow]\nName=Vallenatrix New Window\nExec="%s" --new-window\nIcon=vallenatrix\n' "$TARGET_LINK" "$TARGET_LINK" > "$DESKTOP_FILE"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi

# 8. Cek PATH
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
