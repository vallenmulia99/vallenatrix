# Vallenatrix — Bug Report

Hasil audit `vallenatrix-main.zip` (vallenagent + vallenterminal + bin/install + watools).

**Legenda**
- ✅ **VERIFIED**: sudah direproduksi dengan menjalankan kode (dist hasil transpile, stub `gray-matter`).
- 👁 **CODE-READ**: ditemukan dari membaca kode, belum dijalankan.
- Sisi Electron (vallenterminal) tidak bisa dibuild di sandbox (tanpa network/node_modules), jadi sebagian besar bertanda 👁.

**Baseline test**: `npm -w vallenagent test` → 40 test, **27 pass, 13 fail**. Satu fail (`conversation_history`) karena butuh server 9router, jadi 12 fail valid:
`agent_skill_preload`, `web_extract blocks bracketed IPv6 loopback`, `web_extract blocks redirects to loopback`, `gateway_runner_isolation`, `gateway_session_permissions`, `session directory and files are private`, `memory directory and files are private`, `skill_manage blocks create traversal`, `skill_view blocks arbitrary and symlinked linked-file reads`, `skill_manage blocks linked file traversal`, `skill matching uses tags and triggers`, `a model switch during tool turn applies only to next turn`.

---

## 🔴 CRITICAL

### C1 ✅ Tool registry rusak permanen setelah background review gagal
- **File**: `vallenagent/src/agent.ts` → `spawnBackgroundReview()`; `vallenagent/src/tools.ts` → `filterTools/clearFilter`
- **Masalah**: `registry.filterTools(toolWhitelist)` mengubah state **global singleton**. `registry.clearFilter()` dipanggil setelah `await reviewAgent.chat(...)` tanpa `try/finally`. Kalau review throw (9router mati, 429, timeout), filter tidak pernah dibersihkan.
- **Repro**: tool sebelum chat = 19, sesudah satu review gagal = 6 (`read_file, search_files, memory, skills_list, skill_view, skill_manage`). `terminal`, `write_file`, `patch`, `web_*`, `execute_code` hilang sampai restart.
- **Juga**: selagi review jalan (async), turn utama berikutnya ikut ter-filter (race).
- **Fix hint**: jangan pakai filter global; pass whitelist per-agent/per-call ke `getOpenAISchemas()` dan `execute()`; minimal bungkus `try/finally`.

### C2 ✅ Background review tidak pernah melihat percakapan
- **File**: `background_review.ts` → `spawnBackgroundReview(conversationSnapshot, ...)`
- **Masalah**: parameter `conversationSnapshot` tidak dipakai. `agentFactory` hanya menerima prompt statis, jadi review agent menganalisis "percakapan" yang tidak dia punya, dan tetap jalan setiap turn (buang token + bikin `new AIAgent` tiap turn).
- **Fix hint**: kirim snapshot ke review agent sebagai konteks, atau matikan fitur sampai benar.

### C3 ✅ `terminal` crash / hang kalau `workdir` tidak ada
- **File**: `builtin_tools.ts` → tool `terminal` (`spawn('/bin/sh', ...)`)
- **Masalah**: tidak ada `proc.on('error')`. `cwd` yang tidak ada → event `error` (ENOENT) tidak tertangani → **uncaught exception** (di Electron main = dialog error/crash), dan Promise tidak pernah resolve.
- **Repro**: `registry.execute('terminal', {command:'echo hi', workdir:'/tidak/ada'})` → `UNCAUGHT EXCEPTION ENOENT spawn /bin/sh`.
- **Fix hint**: validasi `workdir` (existsSync + isDirectory), pasang `proc.on('error', ...)` yang resolve JSON error.

### C4 ✅ History compaction mengirim pesan `tool` yatim + menghilangkan tugas user
- **File**: `agent.ts` → `compactHistory()` (dipanggil dalam loop saat `history.length > 20`)
- **Masalah**:
  1. Memotong di tengah pasangan `assistant(tool_calls)` ↔ `tool`. Tail bisa dimulai dengan role `tool` tanpa assistant pemiliknya → provider OpenAI-compatible membalas HTTP 400.
  2. Pesan user yang memulai turn ikut terkompaksi jadi `User: "<120 char pertama>"` → agent lupa detail tugas di tengah loop panjang.
  3. Hanya `summaries.slice(0, 15)` (yang paling lama) yang disimpan; summary lama di-summarize ulang dan makin terpotong.
- **Repro**: loop 14 iterasi × 2 tool call → `orphan tool message {call:8, id:'t5a'}`; kalimat di ujung prompt user hilang.
- **Fix hint**: potong hanya di batas turn (jangan pisahkan assistant+tool group), jangan pernah kompaksi user message turn aktif.

### C5 ✅ Parser streaming SSE salah di beberapa kasus
- **File**: `providers.ts` → `OpenAICompatibleProvider.chat()` (cabang stream)
- **Masalah** (semua direproduksi dengan server lokal):
  1. Hanya menerima prefix `data: ` (dengan spasi). `data:{...}` (valid per spec) diabaikan → konten kosong.
  2. Sisa `buffer` setelah stream selesai tidak diproses → chunk terakhir tanpa `\n` hilang (`"AB"` jadi `"A"`).
  3. Tool call paralel yang semuanya `index: 0` (perilaku Gemini OpenAI-compat, model default repo ini) digabung: `name` jadi `read_fileread_file`, `arguments` jadi dua JSON nyambung.
  4. `{"error": ...}` di dalam SSE ditelan (`catch {}` / tidak dicek) → agent menampilkan "(No content returned…)" bukan error asli.
  5. Tidak mengirim `stream_options: {include_usage: true}` → `promptTokens` selalu 0 saat streaming → telemetry/context % salah.
  6. Tidak ada timeout pada `fetch`; provider yang hang mengunci `chatLock` selamanya (semua chat berikutnya antre).
- **Fix hint**: parse `data:` dengan/ tanpa spasi, flush buffer akhir + `decoder.decode()`, bedakan tool call by `id` kalau index bentrok, throw kalau ada `error`, tambah timeout/AbortSignal.

### C6 ✅ Tool tanpa argumen gagal ("Invalid JSON arguments")
- **File**: `agent.ts` → parsing `toolCall.function.arguments`
- **Masalah**: `JSON.parse('')` throw. Banyak provider mengirim `arguments: ""` untuk tool tanpa parameter (`skills_list`, `manage_connections`, `todo_list` read).
- **Fix hint**: `const raw = args?.trim() ? args : '{}'`.

### C7 ✅ Path traversal di skill tools
- **File**: `builtin_tools.ts` → `skill_view` (param `file_path`), `skill_manage` (ops `create`, `write_file`, `remove_file`, `delete`)
- **Masalah**: `join(dirname(skill.path), file_path)` dan `join(targetBaseDir, category, name)` tanpa cek containment/symlink/`..`. Bisa baca/tulis/hapus file di luar folder skill. `delete` memakai `rmSync(dirname(skill.path), {recursive:true})`; kalau SKILL.md ada di root skills dir, seluruh direktori terhapus.
- **Bukti**: 3 test bawaan gagal (`skill_path_safety.test.mjs`).
- **Fix hint**: `resolve()` lalu pastikan `startsWith(base + sep)`; tolak symlink (`lstat`); validasi `name`/`category` pakai `validateSkillName/validateCategory` (dan `validateCategory` sendiri harus menolak komponen `..`).
- **Tambahan**: batch `operations` tidak ada di schema dan tidak atomic (klaim "atomic" salah; error di tengah meninggalkan perubahan separuh).

### C8 ✅ SSRF `web_extract` bisa dibypass
- **File**: `builtin_tools.ts` → tool `web_extract`
- **Masalah**:
  - `new URL().hostname` untuk IPv6 berbentuk `[::1]` (pakai kurung) → perbandingan `=== '::1'` dan `startsWith('fe80:')` tidak pernah cocok. `[::ffff:127.0.0.1]` juga lolos.
  - `0.0.0.0` tidak diblok → **konten service lokal berhasil terbaca** (repro).
  - 👁 `169.254.169.254` (cloud metadata), `fc00::/7` tidak diblok.
  - Redirect (`fetch` default follow) ke loopback lolos (test bawaan gagal: `HTTP 302`).
  - 👁 DNS rebinding / hostname yang resolve ke IP privat tidak dicek.
  - False positive: `startsWith('10.')` memblok domain legit seperti `10.example.com`.
  - 👁 Timeout di-clear sebelum `res.text()` dan tidak ada batas ukuran body → hang/OOM.
- **Fix hint**: resolve DNS, cek IP hasil resolve dengan library CIDR (termasuk IPv6/mapped), `redirect: 'manual'` dan validasi tiap hop, batasi ukuran body, timeout sampai body selesai. Terapkan juga ke `vision_analyze` (fetch URL tanpa proteksi sama sekali).

### C9 ✅ `skills_sync` menimpa skill buatan user
- **File**: `skills_sync.ts` → `syncBundledSkills()`
- **Masalah**: kalau skill user bernama sama dengan skill bundled dan belum ada di manifest, `manifestHash` undefined → cabang "user modified" dilewati → `rmSync(destPath)` lalu ditimpa. Repro: isi skill user diganti `BUNDLED`.
- **Juga**: skill disalin ke `skillsDir/<name>` (flat), jadi struktur kategori hilang dan nama kembar antar kategori bentrok.
- **Fix hint**: kalau dest ada tapi tidak ada di manifest → skip (atau backup), simpan relative path kategori.

### C10 ✅ Instalasi baru = 0 skill; path dev di-hardcode
- **File**: `skills_sync.ts` → `getBundledSkillsDir()`, `skills_hub_search.ts` → `fetchOfficialSkill()`
- **Masalah**: hardcode `/home/vallenganteng/Destop/vallenatrix/refrensi hermes-agent-2026.9.24/skills` (folder ini juga di-`.gitignore`). Di mesin lain `discoverBundledSkills()` kosong → "Loaded 0 skills", manifest tidak pernah ditulis sehingga log `First run detected` muncul **setiap** `new AIAgent`. Folder `.vallenatrix/skills` di repo (79 skill, frontmatter valid semua) tidak pernah dipakai. `official/<cat>/<name>` selalu gagal. 👁 `category/name` tidak divalidasi → traversal baca direktori lain.
- **Juga hardcode**: `watools/on.sh`, `watools/stop.sh`, kandidat path di `vallenterminal/src/main/banner.ts`.
- **Fix hint**: resolve relatif ke repo root / `app.getAppPath()` / env var.

### C11 👁 Command injection di `fetchGitHubSkill`
- **File**: `skills_hub_search.ts`
- **Masalah**: `execAsync(\`git clone --depth 1 "${url}" "${tmpDir}"\`)` lewat shell. `parseSkillIdentifier` hanya cek `startsWith('https://github.com/')`, jadi `https://github.com/x"; <cmd>; "` dieksekusi. Sama untuk `find "${skillDir}"`, `rm -rf "${tmpDir}"`.
- **Fix hint**: `execFile('git', ['clone','--depth','1','--', url, tmpDir])`, validasi URL dengan `new URL()` + regex owner/repo, gunakan `fs.mkdtemp`, tambah timeout dan `GIT_TERMINAL_PROMPT=0`.

---

## 🟠 HIGH

### H1 👁 Tidak ada approval gate untuk tool berbahaya
- `terminal`, `write_file`, `patch`, `execute_code`, `browser_exec`, `skill_manage install` berjalan langsung dengan privilege user. Schema `skill_manage` menulis "User approval required" tapi tidak ada implementasinya.
- Dikombinasikan dengan `web_extract`/skill hub (konten tak tepercaya masuk konteks) → prompt injection → eksekusi kode.
- `scanBundle()` hanya cek string `rm -rf /`, `eval(`, `exec(` (false positive `regex.exec(`, mudah dibypass); jangan dianggap security control.
- **UI spoofing**: `formatToolEnd()` memotong command 55 char dan tidak men-strip ESC/control char, sehingga model bisa menyembunyikan command dengan escape sequence atau padding. Sanitasi semua string yang ditulis ke xterm.

### H2 👁 `/skills <subcommand>` tidak berfungsi
- `vallenterminal/src/main/index.ts` meng-import `handleSkillsCommand` tapi **tidak pernah memanggilnya**. Hanya `trimmed === '/skills'` yang ditangani; `/skills search|install|uninstall|update|disable|enable|sync|reset` jatuh ke `agent.chat()` sebagai pesan biasa ke LLM. (`noUnusedLocals` di tsconfig seharusnya menolak ini saat `typecheck`.)

### H3 ✅ Fitur WhatsApp tidak ada implementasinya
- README mendokumentasikan "WhatsApp Remote Agent", root `package.json` punya dependensi baileys, tapi 0-byte: `vallenagent/src/platforms/{gateway,gateway_agent,gateway_runner,index,session_context,session_store,whatsapp_adapter,whatsapp_setup}.ts`, `vallenagent/tests/whatsapp.test.ts`, `watools/wa-client.js`. Dua test gateway crash `ERR_MODULE_NOT_FOUND`.
- Kalau nanti diimplementasi: agent yang sama menjalankan `terminal` dari pesan WA = remote shell; wajib approval + allowlist ketat.

### H4 ✅ `patch` / `fuzzyReplace` bisa merusak file diam-diam
- **File**: `builtin_tools.ts` → `fuzzyReplace()`
- Strategi 8 (`block_anchor`) hanya cek baris pertama & terakhir; baris tengah **tidak diverifikasi**. Repro: `old_string` dengan tengah `something_else()/other()` menimpa blok berisi `important1()/important2()` jadi `REPLACED`.
- Strategi 9 (similarity ≥90%) mengganti blok walau 1 baris berbeda → baris itu hilang tanpa error (repro: `step5` hilang).
- `replace_all` + strategi fuzzy hanya mengganti blok match pertama (`applyReplace` memakai teks blok itu), match lain dengan indentasi beda tidak diganti, tapi hasil dilaporkan `success: true`. Strategi 7 (unicode) mengabaikan `replaceAll`.
- 👁 Strategi 4: `Math.min(...[])` = `Infinity` jika semua baris kosong.
- 👁 `unescapeString` urutan replace salah untuk `\\n`. CRLF: `newString` LF menimpa blok CRLF → line ending campur.
- **Fix hint**: wajibkan semua baris (setelah normalisasi) cocok; hapus/batasi strategi 8–9 atau minta konfirmasi + tampilkan diff; error kalau replace tidak mengubah apa-apa.

### H5 ✅ Config & permission
- **File**: `config.ts`, `session.ts`, `memory.ts`
- `writeFileSync(..., {mode: 0o600})` hanya berlaku saat file **dibuat**. `config.json` berisi `api_key` yang sudah ada tetap `644` setelah `saveConfig` (repro). Perlu `chmodSync`.
- `saveConfig` memakai `...current` (hasil `loadConfig` yang selalu menyisipkan `terminal.cwd`) sehingga `terminal.cwd` **tetap tersimpan** ke disk; komentar "BUG-10: never persist" tidak benar.
- `setModel()` menyimpan `this.config` yang `skills.paths`-nya sudah di-expand (`~` jadi absolut) → mengubah config user.
- `sessions/` dan `memories/` dibuat `755` (2 test gagal); isi sesi bisa memuat secret. Gunakan `mkdirSync(..., {mode: 0o700})` + `0o600` untuk file.
- Penulisan non-atomic (`writeFileSync` langsung) untuk config, session, memory, hub lock → korup kalau crash. Pakai tulis ke temp + `rename`.

### H6 ✅ Model switch bocor ke turn yang sama; `/resume` model dibatalkan
- `agent.ts` membaca `this.provider.model` tiap iterasi, jadi `setModel()` di tengah turn langsung berlaku (test `turn_model_isolation` gagal). Snapshot model di awal `_chatImpl`.
- 👁 `index.ts` memanggil `agent.setModel(userModel)` di **setiap** chat (tulis `config.json` + `.bak` tiap pesan), dan renderer selalu mengirim `modelSelect.value`, sehingga model hasil `/resume` langsung ditimpa pesan berikutnya.

### H7 ✅ Test suite menyesatkan
- Root `npm test` hanya menjalankan `vallenterminal/tests/config-theme.test.mjs`, dan file itu **menyalin ulang** `isValidThemeName/validateTheme` ke dalam test (tidak mengimpor kode asli) → selalu hijau.
- `vallenagent` tests tidak dijalankan oleh root; 13/40 gagal.
- Ada test untuk fitur yang belum ada: `SkillLoader.getRelevantSkills`, skill preload sebelum model call.
- `AGENTS.md` menyebut "6 test suites"; sebenarnya 19 file.

---

## 🟡 MEDIUM

### M1 ✅ `HubLock` pakai operator `in`
- `skills_hub_lock.ts` → `has()`: `'constructor' in {}` = true. Skill bernama `constructor`/`toString`/`valueOf` dianggap sudah terpasang; `get()` mengembalikan fungsi bawaan. Pakai `Object.hasOwn` / `Map`, atau `Object.create(null)`.

### M2 👁 Install/uninstall skill hub
- `uninstallSkill`: `join(skillsDir, entry.install_path)` tanpa validasi; lock rusak/diedit (`""` atau `../..`) → `rmSync` recursive di luar/akar skills. `normalizeLockInstallPath` ada tapi tidak dipakai.
- `installFromQuarantine` menghapus install lama **sebelum** menyalin file baru; gagal di tengah = skill lama hilang (tidak ada rollback).
- Copy memakai `readFileSync(..., 'utf-8')` → file biner (gambar/font) rusak. `fetchGitHubSkill` mengabaikan file biner dengan `catch {}`.
- Jika `SKILL.md` ada di root repo, `find skillDir -type f` ikut membaca seluruh `.git/` ke bundle. Regex `^name:\s*(.+)$` ikut membawa tanda kutip → `validateSkillName` gagal untuk `name: "foo"`. `find` memakai SKILL.md pertama yang ketemu (urutan tak tentu). `parseSkillIdentifier` menghasilkan nama `unknown` untuk URL berakhiran `/` dan tidak membuang `.git`.
- `HubLock` read-modify-write tanpa lock antar instance. `execAsync` tanpa timeout, `maxBuffer` default 1 MB.
- `searchGitHub` memakai `curl` + shell; pakai `fetch`. Query `in:file` di endpoint `search/repositories` tidak valid (itu untuk `search/code`) → hasil tidak relevan.

### M3 👁 `SkillLoader` / skills
- `SKILL_PATTERN = /SKILL\.md$/i` cocok dengan `MYSKILL.md`, `not_a_skill.md`. Gunakan `^SKILL\.md$`.
- `name`/`description` non-string dari YAML (`name: 123`) → `a.name.localeCompare` throw di `getFormattedIndex()` → **seluruh system prompt gagal dibangun**. Coerce ke string / skip skill invalid.
- Nama duplikat antar kategori saling menimpa (hanya warn). `disable()` pada nama yang tidak ada tetap menambah ke set.
- `skill_manage` batch memakai `process.cwd()` untuk `localDir` (bukan `context.workingDir`) dan memakai closure `skillLoader`/`delegateAgentFactory` dari agent **terakhir** yang mendaftarkan tool.

### M4 👁 `registerBuiltinTools` dipanggil ulang tiap `new AIAgent`
- Flag `builtinToolsRegistered` dideklarasikan tapi tidak dipakai → tiap subagent/review mendaftar ulang 19 tool, spam `[Tools] Overwriting...`, dan handler (closure `delegateAgentFactory`, `skillLoader`) menunjuk agent terakhir. Subagent/review juga men-scan ulang semua SKILL.md dan menjalankan `syncBundledSkillsIfNeeded` (lihat C10) setiap kali.
- Subagent berbagi objek `config` dengan parent → `cd` di subagent mengubah cwd parent. `registry` singleton global menyulitkan multi-agent/gateway.

### M5 ✅/👁 Renderer (vallenterminal)
- ✅ `getMediaUrl()` memakai `encodeURI`, yang tidak meng-encode `#` dan `?`. Path seperti `/home/u/wall #1.mp4` diterima main sebagai `/home/u/wall ` → 403/gagal. Pakai `encodeURIComponent` per segmen atau `pathToFileURL`.
- 👁 `window.api.onTerminalData` hanya `term.write` bila `isDirectPtyMode`; output PTY yang datang saat mode AI **hilang**.
- 👁 Ctrl+T, Ctrl+`, Ctrl+-, Ctrl+0, Ctrl+, direbut app walau sedang di mode PTY (Ctrl+T = transpose, Ctrl+- = undo di readline).
- 👁 `debouncedSaveConfig` memakai satu timer bersama; payload berbeda (`{windowOpacity}` vs `{background}`) saling membatalkan → perubahan dim/opacity bisa tidak tersimpan. `sliderBlur` dan `setFontSize` malah tidak di-debounce.
- 👁 `loadAgentColors()` → `JSON.parse` tanpa try/catch; localStorage rusak membuat `init()` reject sebelum `applyBackground()`/banner → UI kosong.
- 👁 Listener (`onWindowStateChange`, keydown zoom) memakai `activeConfig` sebelum `init()` selesai → `TypeError` pada event `focus` awal.
- 👁 `applyBackground()` memanggil `videoEl.pause()` lalu `play()` di setiap `input` slider → stutter. `videoEl.src` tidak dibersihkan saat ganti ke image/none.
- 👁 Protocol `vallen-media` memakai `net.fetch(file://)` tanpa meneruskan header `Range` → seek/loop video berpotensi gagal.
- 👁 Pesan awal tidak ada guard "sedang diproses"; `/stop` saat chat masih antre di `chatLock` hilang karena `isInterrupted` di-reset di awal `_chatImpl`.
- 👁 Pencocokan slash command pakai `startsWith` (`/token`, `/model`, `/theme`, `/resume`, `/plan`) sehingga `/tokens`, `/planet` tertangkap salah.
- 👁 Pesan `/token <key>` masih di-echo apa adanya ke terminal oleh renderer (`> /token sk-...`); mask di sisi renderer juga.

### M6 👁 Tool lain (`builtin_tools.ts`)
- `write_file` selalu mengembalikan `verified: true` (hardcode, tidak membaca ulang).
- `search_files`: `break` hanya keluar dari loop baris; pencarian terus membaca semua file lain setelah limit tercapai. `total_count` tidak akurat. Regex tanpa proteksi ReDoS.
- `read_file`: `fd` bocor jika `readSync` throw (tidak ada `finally`); `limit` negatif menghasilkan slice kosong.
- `execute_code` / `browser_exec`: kode dikirim via argv `python3 -c` (batas ~128 KB per argumen → `E2BIG`); deskripsi "sandbox" menyesatkan (tidak ada sandbox); `browser_exec` mengabaikan parameter `session`; timeout hanya membunuh python, bukan child process-nya.
- `terminal`: kalau output melewati 10 MB, proses di-kill tapi hasil dilabeli `timed_out`; marker cwd hilang. `stderr` dipotong diam-diam. Command yang berakhir dengan heredoc/backslash merusak probe `__VALLEN_CWD__`. Fast-path `cd` tidak menangani `cd -`, `$VAR`.
- `web_search`: `title` diambil dari 80 char snippet (bukan judul), entity HTML tidak di-decode, parser regex rapuh terhadap perubahan DDG. `web_extract`: urutan decode `&amp;` sebelum `&lt;` menghasilkan double-decode; regex `.` tidak melewati newline sehingga `<p>`/`<h*>` multi-baris tidak diformat.
- `image_generate`: tidak cek `content-type`/magic bytes → halaman error HTML tersimpan sebagai `.png`; `~/` di `output_path` tidak di-expand (membuat folder literal `~`); GIF tidak dikenali; prompt panjang bisa kena 414 karena ada di URL.
- `vision_analyze`: memakai `loadConfig()` (model dari file) bukan model runtime agent; tidak batasi ukuran download URL; MIME bisa `text/html` dari header.
- `manage_connections`: endpoint 9router hardcode, mengabaikan config provider. `clarify`: stub ("NOT IMPLEMENTED") tapi terdaftar sebagai tool sehingga model sering memanggilnya sia-sia.

### M7 👁 `agent.ts` lain-lain
- `interrupt()` hanya meng-abort `fetch` provider; tool yang sedang berjalan (`terminal`, `execute_code`) tidak dihentikan. Response interupsi berisi kode ANSI mentah.
- `pruneOldToolResults` memangkas hasil tool > 250 char di luar 8 pesan terakhir → model kehilangan isi `read_file` setelah ±4 tool call dan membaca ulang (loop/token boros).
- `/plan` dideteksi `startsWith('/plan')` (cocok `/planet`); history menyimpan prompt plan, bukan pesan asli. Mode plan hanya "saran" di prompt, tidak ditegakkan (tool tulis tetap aktif).
- `resetSession()` tidak menunggu `chatLock` → bisa merusak history turn yang sedang jalan. `resumeSession` tidak memvalidasi bentuk `messages`/`cwd`.
- `session.ts`: `getSessionPath` mengganti karakter ilegal jadi `_` → ID berbeda bertabrakan (`a/b` vs `a_b`); `title` dari `content.slice` crash bila `content` bukan string (array multimodal); `slice(0,45)` bisa memotong surrogate pair.
- Timestamp detik di system prompt tiap turn merusak prompt-cache provider.
- `contextWindow` hardcode 1_048_576 untuk semua model.

### M8 👁 `memory.ts`
- Read-modify-write tanpa lock; review agent (async) dan agent utama bisa saling menimpa.
- `batch()` menulis `memory` lalu `user` terpisah → tidak atomic bila yang kedua gagal. `replace` dengan `content` kosong di `batch` jadi no-op diam-diam. Delimiter `\n§\n` bisa dipecah oleh konten yang mengandung pola itu. Limit dihitung dalam UTF-16 code unit, bukan karakter.

### M9 👁 Electron main (`vallenterminal/src/main`)
- `index.ts`: `ipcMain.on(TERMINAL_RESIZE, (_e, {cols, rows}))` destructuring payload undefined throw di main; `NaN` lolos `typeof === 'number'` (sebagian ditahan `cols > 0` di `PtyManager`).
- `media.ts`: validasi hanya berdasarkan ekstensi nama file (bukan magic bytes) dan mengikuti symlink; renderer manapun bisa membaca file gambar/video apa pun lewat `vallen-media://`.
- `pty.ts`: `onExit` proses lama (`spawn()` dipanggil ulang setelah `kill()`) bisa meng-null-kan `ptyProcess` baru dan memanggil `onExit` → menutup window. Env diteruskan penuh (`process.env`), termasuk `LIBVA_DRIVER_NAME` dari launcher.
- `config.ts`: `saveConfig` menelan error tulis dan tetap mengembalikan config seolah tersimpan; `loadConfig` mengembalikan `{...DEFAULT_CONFIG}` (shallow, nested object dishare); `sanitizeConfig` menerima `NaN`; `validateTheme` meneruskan `colors`/`backgroundPreset` apa adanya (tanpa validasi format warna/path).
- `will-navigate` mengizinkan semua `file://`.
- `banner.ts`: health-check sebagian hardcode (`skillsCount = 59`, "0 disabled", status skills selalu OK); membaca `providers['9router'].baseURL` padahal key config adalah `base_url`; `execSync` sinkron di main thread saat startup; `getAgentInstance()` (scan skills + sync) juga sinkron di main thread → UI freeze saat boot.

### M10 👁 Packaging / launcher
- `bin/vallenatrix`: `export LIBVA_DRIVER_NAME=i965` default untuk semua user (merusak VA-API di GPU non-Intel, dan diwariskan ke semua shell/aplikasi yang dibuka dari terminal). Mode `-r`: fallback `kill -HUP $PPID` bisa menutup shell/parent yang salah. `sleep 0.3` race.
- `vallenterminal/package.json`: `"main": "dist/main/index.js"`, sementara electron-vite output ke `out/` (launcher memakai `out/main/index.js`). `electron-vite preview` (`npm start`) kemungkinan gagal menemukan entry. *(belum diverifikasi, tidak bisa menjalankan electron-vite)*
- `install.sh`: `rebuild:pty` hardcode `--target=28.0.0 --arch=x64` (ARM/versi Electron lain rusak) dan `cd node_modules/node-pty` (bisa tidak ada bila di-hoist/ workspace); label langkah `[1/4]…` tidak sinkron; tidak memverifikasi `~/.local/bin` di PATH sebelum melapor sukses; `--purge` hanya menghapus `~/.config/vallenterminal`, bukan `~/.vallenatrix` (config agent, sesi, memori, API key tertinggal).
- README menyebut `vallenagent/README.md` placeholder dan struktur lama; `AGENTS.md` memuat path dev absolut. `.gitignore` mengabaikan `*.bak` dan `refrensi*/` namun bergantung padanya di kode (C10).

---

## Urutan perbaikan yang disarankan
1. C1, C2, C3, C6 (agent kehilangan tool / crash / tool tanpa arg) — perbaikan kecil, dampak besar.
2. C4, C5 (kestabilan loop & provider Gemini).
3. C7, C8, C11, H1 (keamanan) — dan buat semua test di `tests/` hijau lagi.
4. C9, C10, H2, H3 (fitur yang diklaim tapi tidak jalan).
5. H4–H7, lalu M-series.

## Catatan metodologi
- Repro dijalankan terhadap `vallenagent/src` yang di-transpile ke CJS (TypeScript `transpileModule`) dengan stub minimal `gray-matter`; `VALLENATRIX_HOME` diarahkan ke direktori temp. Tidak ada network dan tidak ada Electron.
- 79 `SKILL.md` di `.vallenatrix/skills` diperiksa dengan PyYAML: semuanya frontmatter valid, tidak ada nama duplikat/non-string. Tidak ada secret nyata di repo (hanya placeholder `sk-xxxx` di dokumentasi).
