#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  printf 'Tambahkan ulang Vallenatrix ke instalasi lokal 9router.\nPenggunaan: %s [--help]\n' "$0"
  exit 0
fi
if [ "$#" -gt 0 ]; then
  echo "Opsi tidak dikenal: $1" >&2
  exit 2
fi
if ! command -v 9router >/dev/null 2>&1; then
  echo "9router belum terpasang. Jalankan installer Vallenatrix, pilih opsi 2, atau pasang 9router dulu." >&2
  exit 1
fi
node "$SCRIPT_DIR/patch-local.js"
echo "Selesai. Reload/restart 9router untuk muat kartu Vallenatrix."
