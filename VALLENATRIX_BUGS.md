# Vallenatrix — Bug Report & Fix Brief

> Dokumen ini untuk diberikan ke AI coding agent. Isinya: bug yang sudah diaudit dari kode `vallenatrix-main`, urut prioritas, lengkap dengan lokasi, bukti, dan arah fix.
>
> **Legenda:** ✅ = sudah dibuktikan dengan PoC yang dijalankan. 📖 = temuan dari baca kode (belum dijalankan, tapi logikanya jelas).

## Aturan main untuk AI yang ngerjain

1. Baca dulu `AGENTS.md` (root), `vallenagent/AGENTS.md`, `vallenterminal/AGENTS.md`.
2. **Edit minimal, YAGNI.** Jangan refactor di luar bug yang dikerjakan, jangan nambah scaffolding.
3. Per bug: **tulis test regresi dulu, pastikan MERAH**, baru fix sampai HIJAU. Taruh di `vallenagent/tests/*.test.mjs` (pakai `node --test`, import dari `../dist/...`).
4. Test harus pakai direktori sementara (`mkdtempSync`) dan env `HOME` / `VALLENATRIX_HOME` yang diisolasi, jangan nyentuh `~/.vallenatrix` asli.
5. Setelah selesai tiap kelompok: `npm -w vallenagent run build && npm -w vallenagent test`.
6. Jangan klaim "fixed" tanpa output test asli. Laporkan apa yang berubah, apa yang terverifikasi, apa yang belum.
7. Kerjakan berurutan P0 → P1 → P2. Satu commit per bug.

Catatan konteks arsitektur: tool registry (`tools.ts`) adalah **singleton global**, dan `registerBuiltinTools` cuma jalan sekali karena flag `builtinToolsRegistered`. Ini penting buat bug #13.

---

# P0 — Bisa merusak data / keamanan / bikin app mati

## BUG-01 ✅ `fuzzyReplace` strategi `unicode_normalized` ngerusak file
- **File:** `vallenagent/src/builtin_tools.ts`, Strategy 7 (~baris 192–206)
- **Masalah:** `normalizeUnicode` mengubah panjang teks (`—`→`--`, `…`→`...`, `“”`→`"`). Index `idx` dihitung di `normContentUnicode` tapi dipakai untuk `content.slice(idx, idx + oldString.length)` di teks **asli**. Kalau ada karakter unicode itu sebelum titik match, offset geser dan potongan yang salah diganti. Strategi ini juga mengabaikan `replaceAll`.
- **Bukti (PoC):**
  ```js
  fuzzyReplace('intro — dash\nconst a = “hello”;\nend', 'const a = "hello";', 'const a = "bye";')
  // hasil: "intro — dash\ncconst a = \"bye\";end"   <- huruf 'c' nyasar, newline hilang
  fuzzyReplace('x = “a”\ny = “a”', '= "a"', '= "b"', true)
  // hasil: hanya baris pertama diganti, replace_all diabaikan
  ```
- **Arah fix:** Bangun peta index normalized→original (per karakter, simpan `origIndex[]` saat normalisasi), atau normalisasi per-baris lalu cocokkan berbasis baris dan ganti blok baris asli. Hormati `replaceAll`. Kalau mapping nggak bisa dipastikan, **throw error** daripada nulis file yang salah.
- **Test:** konten dengan `—`/`…`/kutip melengkung SEBELUM target; assert file hasil persis sesuai ekspektasi; plus case `replaceAll`.

## BUG-02 ✅ Strategi `whitespace_normalized` memakai `includes()` → hapus teks di sekitarnya
- **File:** `builtin_tools.ts`, Strategy 3 (~baris 109–126), kondisi `windowWs === oldWs || windowWs.includes(oldWs)`
- **Masalah:** Kalau `old_string` cuma sebagian dari satu baris, **seluruh baris** (window) ikut diganti.
- **Bukti:**
  ```js
  fuzzyReplace('function f() {\n  return  foo(1)  +  bar(2);\n}\n', 'foo(1) + bar(2)', 'X')
  // hasil: "function f() {\nX\n}\n"   <- 'return' dan ';' hilang
  ```
- **Arah fix:** Hapus `includes`, wajib equality (`windowWs === oldWs`). Kalau memang mau match substring dalam baris, lakukan replace di level karakter dengan regex whitespace-fleksibel yang dibangun dari `old_string`, bukan ganti seluruh window.
- **Test:** case di atas harus menghasilkan `return X;` (atau error), bukan menghapus `return`.

## BUG-03 ✅ `fuzzyReplace` dengan `old_string` kosong
- **File:** `builtin_tools.ts` awal `fuzzyReplace` + handler `patch`
- **Bukti:**
  ```js
  fuzzyReplace('abc', '', 'X', true)   // "aXbXc"  <- file dirusak total
  fuzzyReplace('abc', '', 'X', false)  // "Xabc"   <- nyisip di awal file
  ```
  Model sering ngirim `old_string` kosong kalau bingung.
- **Arah fix:** Di awal `fuzzyReplace`: `if (!oldString) throw new Error('old_string must not be empty')`.
- **Test:** keduanya throw, file tidak berubah.

## BUG-04 ✅ `read_file` baca seluruh file ke memori → crash proses
- **File:** `builtin_tools.ts`, handler `read_file` (~baris 354: `readFileSync(fullPath, 'utf-8')` lalu `.split('\n')`)
- **Bukti:** `read_file` ke `/dev/zero` → `terminate called after throwing an instance of 'std::bad_alloc'` (proses mati). Di Electron berarti **seluruh app mati**. File log/video/binary besar punya efek sama.
- **Arah fix:** `statSync` dulu; kalau bukan regular file → error; kalau `size` > batas (mis. 10 MB) → baca streaming per baris dengan `readline` hanya sampai `offset+limit`, atau tolak dengan hint. Deteksi binary (ada byte `\0` di 8 KB pertama) → error "binary file".
- **Catatan terkait 📖:** tool `terminal` (`builtin_tools.ts` ~baris 686–687) menumpuk `stdout += chunk` tanpa batas. `yes` selama 120 detik bisa OOM. Tambahkan cap (mis. simpan head+tail, drop sisanya, atau kill proses kalau > N MB).
- **Test:** file sparse 2 GB / `/dev/zero` tidak boleh crash; return error terstruktur. Test cap output terminal dengan `yes | head -c 200000000`-style (timeout kecil).

## BUG-05 ✅ `NODE_TLS_REJECT_UNAUTHORIZED = '0'` diset global
- **File:** `builtin_tools.ts` di `web_search` (~800), `web_extract` (~865), `image_generate` (~1087)
- **Masalah:** Setting env itu bersifat **proses-wide dan permanen**. Setelah salah satu tool dipanggil, SEMUA koneksi HTTPS di proses (termasuk request ke provider yang bawa `Authorization: Bearer <api_key>`) berhenti verifikasi sertifikat → MITM bisa curi token. Node juga ngeluarin warning (terbukti di PoC).
- **Arah fix:** Hapus ketiga baris itu. Kalau memang ada alasan (cert error di mesin tertentu), jadikan opt-in per-request (mis. `undici.Agent({ connect: { rejectUnauthorized: false } })` hanya untuk tool tersebut, dan hanya kalau user set flag di config), **bukan** mutasi `process.env`.
- **Test:** setelah memanggil handler tiga tool itu, `process.env.NODE_TLS_REJECT_UNAUTHORIZED` harus `undefined`. (Stub `fetch` biar nggak butuh network.)

## BUG-06 ✅ Double-submit → dua `chat()` jalan bareng → history rusak
- **File:** `vallenagent/src/agent.ts` (`chat`), `vallenterminal/src/main/index.ts` (handler `AGENT_CHAT`), `renderer/main.ts` (`sendChatMessage`)
- **Masalah:** Tidak ada lock. Input chat tidak di-disable saat agent jalan, handler IPC juga tidak serialisasi. Dua pesan beruntun menghasilkan urutan history:
  `system > user > user > assistant[tool_calls] > tool(call_1) ...` — tool result dan user message saling menyela. Provider yang ketat soal alternation akan balas HTTP 400, dan session jadi korup tersimpan di disk.
- **Bukti (PoC, fake provider):** provider melihat `system > user > user > assistant[tool_calls] > tool(call_1)`.
- **Arah fix (minimal):**
  1. Di `AIAgent`: tambah `private busy: Promise<unknown> = Promise.resolve()` dan serialisasi `chat()` (antrian), atau lempar error `Agent is busy` bila sedang jalan. Pilih salah satu dan konsisten.
  2. Di renderer: disable `chatInput` + tombol kirim selama `await chatAgent`, kecuali slash command `/stop`.
  3. `/stop` harus tetap bisa lewat saat agent busy (jangan ikut antrian).
- **Test:** dua `chat()` paralel dengan fake provider; assert history akhir selalu terurut valid (tiap `assistant.tool_calls` langsung diikuti `tool` dengan id yang cocok) dan tidak ada dua `user` beruntun akibat race.

## BUG-07 ✅ `install.sh` tidak build `vallenagent`
- **File:** `install.sh` (~baris 117), `package.json` root (script `build`)
- **Masalah:** Installer & script `build` root hanya menjalankan `npm -w vallenterminal run build`. `vallenagent/dist/` ada di `.gitignore`. Main process memuat `require('.../vallenagent/dist/index.js')` (index.ts ~baris 195). Di fresh clone + `./install.sh`, chat AI langsung error `Cannot find module`. `AGENTS.md` sendiri bilang harus build keduanya.
- **Arah fix:** di `install.sh` tambah `npm -w vallenagent run build` sebelum build terminal; ubah script root `build` jadi `npm -w vallenagent run build && npm -w vallenterminal run build`; `start`/`dev` sebaiknya memastikan agent sudah ter-build. Opsional: `bin/vallenatrix` cek `vallenagent/dist/index.js` ada dan kasih pesan jelas kalau tidak.
- **Test/verifikasi:** clone bersih → `./install.sh` → pastikan `vallenagent/dist/index.js` ada.

---

# P1 — Bug fungsional yang sering kena user

## BUG-08 ✅ Provider error → pesan user menumpuk di history
- **File:** `agent.ts`, blok `catch` di `chat()` (rollback hanya menangani `assistant.tool_calls`)
- **Bukti:** provider gagal 3× lalu sukses → provider melihat `user:halo, user:halo, user:tolong bantu, user:sekarang`. Model akan menjawab semuanya sekaligus; sebagian provider menolak consecutive user.
- **Arah fix:** Di `catch`, kalau tidak ada progress (tidak ada assistant message baru sejak `startHistoryLen`), `splice` pesan user yang baru ditambahkan (rollback ke panjang sebelum `chat`). Kalau sudah ada progress tool, pertahankan tapi pastikan semua tool_calls tertutup.
- **Test:** provider throw → panggil `chat()` lagi sukses → history berisi tepat satu pesan user baru.

## BUG-09 ✅ Respons 200 tanpa `choices` → error cryptic
- **File:** `providers.ts` (~baris 87) & `agent.ts` (`response.choices[0]`)
- **Masalah:** Gateway (9router/OpenRouter-style) sering balas 200 dengan body `{ "error": {...} }` saat rate limit. Hasilnya: `Cannot read properties of undefined (reading '0')`.
- **Arah fix:** Di provider: setelah `response.json()`, kalau `!data.choices?.length` → `throw new Error('Provider returned no choices: ' + JSON.stringify(data.error ?? data).slice(0,500))`. Tambah `AbortSignal.timeout(...)` supaya fetch tidak menggantung selamanya, dan normalisasi trailing slash di `baseURL`.
- **Test:** fake `fetch` return `{error:{message:'rate limited'}}` → error yang mengandung `rate limited`.

## BUG-10 ✅ `terminal.cwd` ke-pin di config.json + api_key plaintext 0644
- **File:** `vallenagent/src/config.ts` (`DEFAULT_CONFIG.terminal.cwd = process.cwd()`, `saveConfig` menulis `current.terminal`)
- **Bukti:** `setProviderToken` sekali dari `/tmp` → `config.json` berisi `"terminal":{"cwd":"/tmp"}`. Launch berikutnya dari `/home/claude` tetap membaca `/tmp`. File berisi `api_key` dengan mode `644`.
- **Arah fix:**
  1. Jangan pernah persist `terminal.cwd` (hapus dari objek yang ditulis; cwd itu state runtime).
  2. `writeFileSync(configPath, ..., { mode: 0o600 })` dan `chmodSync` kalau file sudah ada.
  3. `loadConfig` di cabang `catch` return `structuredClone(DEFAULT_CONFIG)` (sekarang mengembalikan objek global yang bisa ke-mutasi), dan jangan menimpa config rusak tanpa backup (`.bak`).
- **Test:** simpan config dari cwd A, `chdir` ke B, `loadConfig().terminal.cwd === B`. Cek mode file `0o600`.

## BUG-11 ✅ Tanggal di system prompt salah (UTC) untuk zona waktu non-UTC
- **File:** `agent.ts`, `buildSystemPrompt`: `dateStr = now.toISOString().split('T')[0]` (UTC) tapi `timeStr = now.toTimeString()` (lokal).
- **Bukti:** `TZ=Asia/Jakarta`, jam 02:30 WIB → prompt bilang `Current Date: 2026-10-01 02:30:00` padahal hari lokalnya 2 Oktober.
- **Arah fix:** bangun tanggal lokal (`getFullYear/getMonth/getDate`) atau pakai `toLocaleDateString('sv-SE')`; sertakan nama timezone.
- **Test:** mock `Date` + `TZ=Asia/Jakarta`.

## BUG-12 ✅ `browser_exec` melaporkan `exit_code: 0` saat timeout
- **File:** `builtin_tools.ts` handler `browser_exec` (~baris 1144: `exit_code: err?.code ?? 0`)
- **Bukti:** `time.sleep(5)` dengan `timeout_s:1` → `exit_code: 0`. `execute_code` benar (124).
- **Arah fix:** pakai `toExitCode(err)` seperti `execute_code`; set `timed_out` bila `err.killed || err.signal`. Idealnya refactor kedua tool lewat satu helper (hanya kalau minimal).
- **Test:** timeout → `exit_code 124`, `timed_out true`.

## BUG-13 ✅ `memory` tool: `remove`/`replace` tanpa `old_text` menghapus entry pertama; batch tidak atomic
- **File:** `vallenagent/src/memory.ts` (`batch` ~108–139, `remove`/`replace` ~76–106)
- **Bukti:**
  - `batch([{action:'remove'}])` dengan entry A, B → A terhapus diam-diam (`includes('')` selalu true).
  - `remove('', ...)` pada store berisi satu entry → entry hilang.
  - `batch([add memory ok, add user 2000 chars])` → return `success:false` tapi memory sudah tertulis ke disk (`["keep","NEW-MEM"]`).
- **Arah fix:** tolak `oldText` kosong di `replace`/`remove`/`batch` (error jelas). Di `batch`: hitung semua hasil di memori, validasi **kedua** limit, baru tulis keduanya (atau tidak sama sekali). Op yang tidak ketemu harus dilaporkan di hasil, bukan diam.
- **Test:** tiga skenario di atas.

## BUG-14 ✅ Guard `isSubagent` itu dead code + semua tool nempel ke agent pertama
- **File:** `builtin_tools.ts` (`if (builtinToolsRegistered) return`, `if (!isSubagent) {...delegate_task...}`), `agent.ts` (konstruktor / delegasi)
- **Masalah:** Tool didaftarkan **sekali** pakai store/skillLoader/delegasi milik agent pertama. Akibatnya: (a) subagent tetap punya `delegate_task` → bisa spawn subagent lagi tanpa batas kedalaman (biaya & loop liar); (b) agent kedua (mis. subagent, atau instance baru) memakai memory/todo/skills milik instance pertama; (c) test di repo tampak lulus karena hanya membuat satu set.
- **Bukti:** `new AIAgent({isSubagent:true})` → `registry.get('delegate_task')` tetap ada.
- **Arah fix (minimal):** Jangan bergantung pada flag global untuk binding store. Opsi sederhana: pass-through `ToolContext` (`context.agent` / `context.stores`) sehingga handler memakai store dari agent yang sedang memanggil, dan cek `context.isSubagent` / depth di handler `delegate_task` (tolak bila `depth >= 1`). Hindari rewrite besar registry.
- **Test:** subagent memanggil `delegate_task` → ditolak. Dua agent dengan memory dir berbeda tidak saling menulis ke store lawan.

## BUG-15 ✅ `VALLENATRIX_HOME` hanya berlaku untuk config.json
- **File:** `memory.ts`, `session.ts`, `config.ts` (default skills path), `builtin_tools.ts` (`skill_manage`, `truncateOutput` scratch, `image_generate`, system prompt "Scratch Dir")
- **Bukti:** dengan `VALLENATRIX_HOME` di-set, `config.json` ke folder itu tapi `memories/` tetap ke `~/.vallenatrix`.
- **Arah fix:** satu helper `getVallenatrixHome()` (sudah ada di `config.ts`) dipakai semua tempat. `skill_manage` harus menulis ke path yang sama dengan yang di-load `SkillLoader` (`config.skills.paths[0]`), kalau tidak skill baru tidak muncul. Hati-hati circular import (taruh helper di modul kecil sendiri bila perlu).
- **Test:** set `VALLENATRIX_HOME` ke tmp; semua artefak (memories, sessions, skills, scratch) berada di bawahnya.

## BUG-16 ✅ `clarify` dan `manage_connections` mengembalikan klaim palsu
- **File:** `builtin_tools.ts` (`clarify` ~936, `manage_connections` ~1170)
- **Masalah:** `clarify` return `"Presented clarification questions to the user."` padahal tidak ada yang ditampilkan dan loop agent lanjut jalan, model mengira sudah bertanya. `manage_connections` hardcode `9router: connected` walau service mati. Ini melanggar aturan "Zero Fabrication" di `vallenagent/AGENTS.md`.
- **Arah fix:**
  - `clarify`: setelah tool ini dipanggil, **hentikan turn** dan kembalikan pertanyaan ke UI sebagai respons agent (mis. flag `needsUserInput` yang dibaca `agent.chat` untuk break loop), atau minimal pesan hasil yang jujur (`"Questions NOT delivered; ask them in your final answer and stop."`).
  - `manage_connections`: cek nyata (`fetch` ke `${baseURL}/models` dengan timeout pendek, `existsSync(.git)` di `workingDir` bukan `process.cwd()`).
- **Test:** 9router mati → status bukan `connected`.

---

# P2 — Robustness / polish

## BUG-17 📖 Tracking cwd di tool `terminal` rusak di distro yang `/bin/sh` = bash
- **File:** `builtin_tools.ts` ~baris 673: `echo "\n__VALLEN_CWD__=$(pwd)"`
- **Masalah:** Di dash `\n` diinterpretasi. Di bash (Arch/Fedora/dll, `sh` → bash) **tidak** → output literal `\n__VALLEN_CWD__=/path` (terkonfirmasi lewat tes `bash` sebagai `sh`), marker tidak ketemu, cwd tracking mati dan sampah nempel di output tiap command.
- **Arah fix:** `printf '\n__VALLEN_CWD__=%s\n' "$(pwd)"` (portabel). Pertimbangkan juga: stdout/stderr digabung dengan urutan benar, dan command yang berakhir `exit`/`exec` tidak merusak parsing.
- **Test:** jalankan dengan shell `bash` dan `dash`.

## BUG-18 📖 `/stop` tidak bisa membatalkan pekerjaan yang sedang jalan
- **File:** `agent.ts` (`interrupt`, return di awal loop), `providers.ts`, `builtin_tools.ts` terminal
- **Masalah:** Flag cuma dicek di awal iterasi / antar tool. Fetch ke provider (tanpa `AbortController`) dan command `terminal` (sampai 120 s) tetap jalan sampai selesai. Return interrupt juga tidak menyimpan session.
- **Arah fix:** `AbortController` per turn → dipass ke `provider.chat` (`signal`) dan ke tool (kill process group). Simpan session saat interrupt.
- **Test:** provider fake yang `await` lama; `interrupt()` harus membuat `chat()` selesai < 1 detik.

## BUG-19 📖 Tidak ada kompaksi context; bar "context %" menyesatkan
- **File:** `agent.ts`
- **Masalah:** History tumbuh tanpa batas; `contextWindow = 1_048_576` hardcode. Begitu melewati window model aktual (mis. model 200k lewat 9router), setiap pesan berikutnya 400 sampai user `/new`. `totalTokens += usage.total_tokens` dijumlah **tiap iterasi** (prompt dihitung berulang) sehingga persen konteks di status bar tidak mewakili pemakaian sebenarnya.
- **Arah fix:** pakai `prompt_tokens` iterasi terakhir untuk indikator konteks; tambah guard sederhana: kalau estimasi melewati ambang, pruning agresif / ringkas pesan lama; error provider "context length" ditangani dengan pesan jelas. (Jaga minimal, jangan bikin sistem memory baru.)

## BUG-20 📖 Hal-hal kecil yang layak dibereskan sekalian
- `Ctrl+Shift+V` di-disable total (`renderer/main.ts` ~329) padahal README bilang bisa paste ke shell di mode PTY → izinkan paste saat `isDirectPtyMode`.
- Shortcut zoom `Ctrl+-`/`Ctrl+0` dan `Ctrl+T` ikut mencegat tombol saat di mode PTY → di mode PTY teruskan ke shell.
- Slider settings memanggil `saveConfig` (tulis sync ke disk) di tiap event `input` → debounce.
- `web_search` ngembaliin hasil palsu `"Search completed"` saat parsing gagal / kena captcha (tanpa cek `res.ok`) → return error jelas.
- `web_extract` tidak punya timeout/limit ukuran, dan bisa diarahkan ke `127.0.0.1`/metadata (SSRF via prompt injection) → tambah timeout, batas byte, dan blokir private IP (atau konfirmasi).
- `resetSession()` tidak mengosongkan `todoStore` → todo sesi lama bocor ke sesi baru.
- `resumeSession()` memanggil `setModel()` yang **menyimpan** model ke config global sebagai efek samping.
- Subagent menyimpan session ke `~/.vallenatrix/sessions` (muncul di `/sessions`) → jangan simpan untuk `isSubagent`.
- Model dropdown di UI default ke opsi pertama HTML, lalu pesan pertama memanggil `agent.setModel(dropdown)` → model terpersisten bisa tertimpa diam-diam; sinkronkan dropdown dengan model aktif saat init.
- `/token <key>` ter-echo ke scrollback terminal (kelihatan di screen share) → mask.
- Nudge `"Your response was empty..."` / `"Act now..."` permanen masuk history dan guard pakai counter `iterations` global → jadikan counter lokal dan jangan simpan nudge.
- Regex `promisePattern` (`^let me ...`) bisa salah kena jawaban final pendek yang sah.
- README bilang 5 tema, repo punya 7; `/help` hardcode "59 skills"/"12 toolset" → hitung dinamis.
- `bin/vallenatrix` memaksa `LIBVA_DRIVER_NAME=i965` (driver tidak ada di GPU modern); `--replace-terminal` melakukan `kill -HUP "$PPID"` yang bisa membunuh parent yang bukan terminal.
- `install.sh` hardcode `--arch=x64` di `rebuild:pty` → gagal di arm64.

---

# Urutan pengerjaan yang disarankan

| Batch | Bug | Alasan |
|---|---|---|
| 1 | 01, 02, 03 | Satu fungsi (`fuzzyReplace`), satu file test, risiko data loss tertinggi |
| 2 | 04, 05 | Crash & keamanan, perubahan kecil |
| 3 | 06, 08, 09 | Stabilitas loop agent / history |
| 4 | 07 | Build & instalasi |
| 5 | 10, 11, 12, 13, 15 | Config, waktu, exit code, memory |
| 6 | 14, 16 | Desain registry / honesty tools |
| 7 | 17–20 | Robustness & polish |

## Format laporan akhir yang diminta dari AI

Untuk tiap BUG: `status` (fixed / partial / skipped + alasan), file yang diubah, nama test baru, dan output asli `npm -w vallenagent test`. Kalau ada bug yang ternyata tidak valid setelah dicek, bilang jelas beserta buktinya, jangan dipaksakan.
