# Vallenatrix ↔ Hermes: Gap Analysis & Upgrade Plan

Hasil banding langsung `hermes-agent-main/` (referensi) vs project utama Vallenatrix.
Semua angka dari pengukuran nyata di repo ini, bukan perkiraan.

## Ringkas: kenapa Hermes lebih kuat di task besar

Model TIDAK salah, dan bukan modelnya yang bikin pinter. Yang bikin pinter itu
**loop, kompaksi, pengaman, dan bukti** yang menahan agent tetap benar di
pekerjaan panjang. Empat penyebab utama:

1. **Kompaksi konteks 6.273 baris (6 file) vs ~90 baris di Vallenatrix.** Hermes
   punya `context_engine`, `micro_compaction`, `native_compaction`,
   `context_compressor` bertahap dengan telemetry + retry. Vallenatrix meringkas
   pakai fungsi lokal tanpa LLM (`buildSummaryLines`) — detail hilang, agent
   "lupa" langkah sebelumnya.
2. **Turn recovery 2.130 baris (3 file) vs TIDAK ADA.** Hermes pulih dari error
   transport/401/encoding di tengah turn, strip gambar, refetch kredensial, lalu
   lanjut. Vallenatrix: satu error → turn mati, kerja hilang.
3. **Verification ledger 1.053 baris (3 file) vs TIDAK ADA (kini sudah ada versi
   minimal).** Hermes mencatat bukti nyata (command + hasil test) dan mendorong
   agent memverifikasi sebelum mengaku selesai.
4. **Prompt caching 3.420 baris (5 file; 28 file pakai `cache_control`) vs 0.**
   Hermes menjaga prefix stabil + breakpoint cache, jadi blok raksasa
   (skill/tools/riwayat) tidak dibayar ulang tiap iterasi. Vallenatrix mengirim
   ulang semuanya tanpa caching.

## Biaya prompt tetap per iterasi (terukur)

Ukur sendiri: `node tools/measure_prompt_cost.mjs`

| Item | Nilai |
|---|---|
| Tool dikirim tiap iterasi | 19 |
| Schema tools (JSON nyata) | 11.500 char (~2.875 token) |
| Skill ter-index | 91 skill / 14 kategori, 8.389 char (~2.098 token) |
| **Total tetap** | **~4.973 token per iterasi** |
| Duplikat profil vs bundled | 60 skill (loader membuang, tidak dikirim) |
| Tanpa kategori | 58 skill (profil user rata, tidak ada folder kategori) |

Riwayat percakapan **belum** dihitung di atas — itu tumbuh tiap iterasi dan
justru bagian terbesar di kerja panjang.

## Gap konfigurasi (SUDAH DIPERBAIKI)

| Key | Sebelum | Sesudah | Alasan |
|---|---|---|---|
| `context_windows` | tidak diset | `ag/gemini-3.8-flash-medium: 200000` | agent menebak 128k → kompaksi di ambang salah |
| `default_context_window` | tidak diset | 128000 | fallback model tak terdaftar |
| `max_output_tokens` | tidak diset (16.384) | 32768 | output panjang tidak terpotong |
| `temperature` | tidak diset | 0.2 | 0–0.3 stabil untuk coding |
| `max_tokens_per_turn` | 50.000 | 200000 | budget output per turn |

Template: `vallenagent/config.example.json`
Backup config lama: `~/.vallenatrix/config.json.bak-*`

## Tabel gap per subsistem

| Subsistem | Hermes | Vallenatrix | Dampak |
|---|---|---|---|
| context compressor | 6 file / 6.273 b | 1 fungsi | konteks hilang di kerja panjang |
| varian compaction | 6 file / 1.908 b | — | tidak ada kompaksi adaptif |
| turn recovery | 3 file / 2.130 b | TIDAK ADA | turn gagal = kerja hilang |
| retry/fallback | 6 file / 524 b | 1 file / 291 b | provider goyang = berhenti |
| verification | 3 file / 1.053 b | **1 file / 168 b (baru)** | agent bisa mengaku selesai tanpa bukti |
| prompt build + cache | 5 file / 3.420 b | TIDAK ADA | tiap iterasi bayar penuh |
| approval/secret | 10 file / 4.871 b | 1 file / 110 b | permukaan risiko lebih luas |
| delegation | 9 file / 4.424 b | 1 file / 1.095 b | tak ada background/`output_schema` |
| session search | 1 file / 800 b | TIDAK ADA | tidak bisa mengingat kerja lama |
| cron | 43 file / 18.955 b | TIDAK ADA | tidak ada kerja terjadwal |
| LSP | 11 file / 3.392 b | TIDAK ADA | tidak ada diagnosa tipe |
| memory | 2 file / 1.205 b | 1 file / 286 b | memori dangkal |

## Yang sudah bagus (jangan dibuang)

- Patch engine 9-tier (`exact` … `similarity_match`) — setara Hermes.
- System prompt byte-stable per sesi (komentar "cache safety" sudah ada) → modal untuk caching.
- Task continuity: goal checklist, nudge "premature final", status incomplete.
- Safety: approval mode, path sensitif, pairing Telegram SHA-256 + `timingSafeEqual`.
- Unik: terminal transparan Electron, wallpaper, pet, `gameDevMode`, `/gamedev`.
- 90 skill bawaan, 22 kategori, termasuk jalur game dev (Unity/Godot/Unreal/Roblox/Blender).

## Status pengerjaan

### Selesai

- **P0-1** Konfigurasi: `context_windows`, `default_context_window`,
  `max_output_tokens`, `temperature` diisi + template `config.example.json`.
- **P0-2** Alat ukur: `tools/measure_prompt_cost.mjs` (pakai SkillLoader & registry
  asli, ada self-check).
- **P1-3** **Verification ledger** (`vallenagent/src/verification.ts`): mencatat
  command verifikasi + exit code + ringkasan hasil, di-inject ke prompt, dan
  mendorong agent sekali kalau ada file berubah tapi belum ada bukti.
  6 test baru di `tests/verification_ledger.test.mjs`.
- **Referensi** `hermes-agent-main/` di-`.gitignore` (261 MB, jangan pernah naik ke remote).

### Belum (urutan usulan)

4. **Kompaksi berjenjang dengan LLM** — ringkas blok lama pakai model murah
   (auxiliary) alih-alih `buildSummaryLines`; simpan ringkasan ke disk agar bisa
   di-recall. Ini perbaikan terbesar yang tersisa.
5. **Turn recovery minimal** — simpan progres saat provider error di tengah turn,
   auto-retry sekali dengan konteks terkompaksi, jangan matikan turn.
6. **Prompt caching** — tandai prefix stabil (system + tools + skill index)
   sebagai cacheable bila provider mendukung `cache_control`.
7. **Ringkas index skill di prompt** — profil user datar (58 skill tanpa
   kategori); pertimbangkan index ringkas (nama + 1 frasa) untuk menekan ~2k token.
8. **Session search** — index sesi lama + tool `session_search`.
9. **LSP** — diagnosa tipe setelah patch supaya agent tahu kesalahannya sendiri.
10. **Opsional**: cron/scheduler, delegation background + `output_schema`, kanban.

## Verifikasi

- `npm -w vallenagent test` → 198/198 pass.
- `npm -w vallenterminal test` → 25/25 pass.
- `npm run typecheck` → agent + terminal bersih.
- `node tools/measure_prompt_cost.mjs` → jalan, angka di atas.
