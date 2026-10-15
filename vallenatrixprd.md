# Vallen PRD: Product Requirements Document

> Dokumen ini ditujukan untuk **AI agent koding** yang akan membangun web "Vallen PRD" di dalam repo `vallenatrix`.
> Baca seluruh dokumen sebelum menulis kode. Kerjakan task sesuai urutan di bagian 13.
> Jika ada hal yang ambigu atau butuh keputusan manusia, **berhenti dan tanya user** (lihat bagian 15), jangan menebak.

- Versi dokumen: 1.0
- Pemilik produk: user (pemilik repo `vallenatrix`)
- Bahasa dokumen: Indonesia (istilah teknis tetap Inggris)

---

## 1. Ringkasan

**Vallen PRD** adalah web app yang membantu orang mengubah ide mentah ("buatin gw game", "buatin web toko", "buatin aplikasi catatan") menjadi **paket dokumen terstruktur** yang siap dikerjakan AI agent koding:

1. `PRD.md` yang spesifik terhadap jawaban user (bukan template generik),
2. `AGENTS.md` sebagai konteks tetap yang dibaca agent di awal setiap task,
3. `task01.md`, `task02.md`, dst: task kecil, berurutan, masing-masing punya acceptance criteria yang bisa dites.

User bisa **menyalin** tiap file atau **mengunduhnya** (satuan atau semua sekaligus sebagai `.zip`).

## 2. Masalah

- Orang yang kurang ide atau referensi memberi instruksi samar ke AI agent, lalu agent menebak dan hasilnya meleset.
- PRD buatan AI biasanya generik: panjang, terdengar rapi, tapi tidak memuat keputusan nyata (angka, batasan, urutan kerja).
- Task yang terlalu besar membuat agent koding berhalusinasi atau mengerjakan hal di luar lingkup.

## 3. Tujuan dan non-tujuan

### Tujuan
- G1. Dari satu kalimat ide, user mendapat paket PRD + task yang cukup spesifik sehingga agent koding bisa mengerjakan tanpa menebak.
- G2. User yang **tidak punya ide detail** tetap bisa maju: AI menawarkan opsi + rekomendasi default di setiap pertanyaan.
- G3. Hasil spesifik ke project: dua ide berbeda tidak boleh menghasilkan PRD yang hampir sama.
- G4. Ekspor praktis: salin per file, unduh per file, unduh semua (`.zip`).
- G5. Bisa memakai AI lewat dua jalur (mode **Mandiri** dan mode **Vallenatrix**) dan ganti lewat halaman Setting.

### Non-tujuan (jangan dikerjakan di versi 1)
- NG1. Bukan generator kode. Web ini hanya menyusun dokumen.
- NG2. Tidak ada login, akun, atau pembayaran.
- NG3. Tidak ada kolaborasi multi-user real-time.
- NG4. Tidak mengubah isi `vallenagent/` dan `vallenterminal/` (lihat bagian 9, hanya boleh dibaca/dipakai lewat adapter).
- NG5. Tidak ada integrasi langsung ke GitHub/Jira.

## 4. Pengguna dan skenario

| Persona | Kondisi | Yang dibutuhkan |
|---|---|---|
| **Pemula** | Punya ide samar, tidak tahu istilah | Pertanyaan sederhana, opsi siap pilih, rekomendasi default |
| **Builder** | Sudah tahu mau apa, malas menyusun | Jalur cepat: jawab sedikit, dapat paket lengkap |
| **Pengguna agent** | Rutin memberi tugas ke AI agent koding | File `task*.md` yang konsisten dan bisa langsung disalin |

Skenario utama:
- S1. "Buatkan gw game" -> AI menanyakan genre, loop utama, platform, kondisi menang/kalah -> paket dokumen game.
- S2. "Buatkan gw web toko" -> AI menanyakan produk, pembayaran, ongkir, admin -> paket dokumen toko.
- S3. "Buatkan gw aplikasi" (sangat samar) -> AI memandu dari nol, menawarkan 3-4 kategori dulu.
- S4. User sudah punya PRD jelek -> mode **Tajamin PRD** (bagian 6, FR-12).

## 5. Alur inti

1. **Ide** : user mengetik ide bebas (satu kalimat cukup).
2. **Klasifikasi** : AI menentukan jenis project (game / toko / aplikasi-web / lainnya) dan mengonfirmasi ke user.
3. **Ronde pertanyaan** : maksimal 5-8 pertanyaan per ronde, berbasis bank pertanyaan (bagian 7). Tiap pertanyaan punya opsi + rekomendasi + pilihan "Tidak tahu, kasih saran".
4. **Ringkasan keputusan** : AI menampilkan rangkuman jawaban, user bisa koreksi.
5. **Generate PRD** : PRD spesifik dari jawaban (bagian 8.1).
6. **Tajamin PRD (otomatis)** : AI menandai bagian ambigu/berisiko, lalu user memutuskan memperbaiki atau lanjut.
7. **Generate paket task** : `AGENTS.md` + `task01.md`... (bagian 8.2 dan 8.3).
8. **Ekspor** : salin / unduh satuan / unduh `.zip`.

## 6. Kebutuhan fungsional

Semua requirement bernomor agar bisa dirujuk di task.

**Input dan percakapan**
- FR-01. User dapat memasukkan ide bebas dan memulai sesi baru.
- FR-02. Sistem mengklasifikasi jenis project dan meminta konfirmasi user. Jika tidak yakin, tampilkan 3-4 pilihan kategori.
- FR-03. Pertanyaan ditampilkan per ronde (maks. 8). Tiap pertanyaan menampilkan: teks, 2-4 opsi, satu opsi bertanda "Rekomendasi" beserta alasan satu kalimat, dan opsi "Tidak tahu, kasih saran".
- FR-04. User dapat menjawab dengan klik opsi atau mengetik jawaban bebas.
- FR-05. Pertanyaan lanjutan bersifat adaptif: jawaban sebelumnya menentukan pertanyaan berikutnya. Pertanyaan yang jawabannya sudah tersirat tidak boleh ditanyakan ulang.
- FR-06. Tersedia ringkasan keputusan yang bisa diedit sebelum PRD dibuat.

**Generasi dokumen**
- FR-07. Sistem membuat `PRD.md` sesuai template di bagian 8.1.
- FR-08. Sistem membuat `AGENTS.md` sesuai bagian 8.3.
- FR-09. Sistem memecah pekerjaan menjadi `taskNN.md` sesuai bagian 8.2. Setiap task wajib punya acceptance criteria yang bisa dites dan daftar dependensi.
- FR-10. Penomoran task dua digit (`task01.md`) dan urutannya memperhatikan dependensi.
- FR-11. Hasil generate muncul **streaming** (bertahap) agar user tidak menunggu layar kosong.
- FR-12. Fitur **Tajamin PRD**: AI menunjuk bagian PRD yang ambigu, tidak terukur, atau berisiko, lalu menawarkan perbaikan per bagian. User juga bisa menempelkan PRD miliknya sendiri untuk dianalisis.

**Ekspor**
- FR-13. Tombol **Salin** untuk setiap file (clipboard).
- FR-14. Tombol **Unduh** untuk setiap file (`.md`).
- FR-15. Tombol **Unduh semua** menghasilkan `.zip` berisi `PRD.md`, `AGENTS.md`, dan semua `taskNN.md` dalam satu folder bernama sesuai nama project.
- FR-16. Pratinjau markdown ter-render, dengan toggle ke teks mentah.

**Riwayat dan pengaturan**
- FR-17. Sesi tersimpan lokal sehingga user bisa melanjutkan atau membuka ulang project sebelumnya (hapus, duplikat, ganti nama).
- FR-18. Halaman **Setting** untuk memilih mode AI (bagian 9), model, bahasa tampilan, dan tes koneksi.
- FR-19. Tampilan dua bahasa: Indonesia dan Inggris, default Indonesia. Bahasa PRD yang dihasilkan mengikuti pilihan user per sesi.
- FR-20. Edit manual: user bisa mengedit isi PRD dan task sebelum ekspor.

## 7. Bank pertanyaan (bekal AI)

Bank pertanyaan disimpan sebagai **data** (file JSON/YAML di `vallenprd/src/questions/`), bukan di-hardcode di UI, agar mudah ditambah. Setiap entri: `id`, `teks_id`, `teks_en`, `opsi[]`, `rekomendasi`, `alasan`, `tergantung_pada` (kondisi dari jawaban lain).

Aturan umum untuk semua jenis project:
- Maks. 8 pertanyaan per ronde, total ideal 10-18 pertanyaan sampai PRD.
- Selalu sediakan "Tidak tahu, kasih saran".
- Jangan tanya hal yang bisa disimpulkan dari jawaban sebelumnya.
- Pertanyaan harus konkret ("berapa pemain per match?") bukan abstrak ("apa visi game ini?").

### 7.0 Pertanyaan umum (semua jenis)
1. Siapa pengguna utamanya dan apa masalah/kebutuhan mereka?
2. Apa satu hal utama yang harus bisa dilakukan di versi pertama?
3. Platform target (web, mobile, desktop, CLI)?
4. Apakah ada batasan teknis atau preferensi stack? (boleh "agent yang pilih")
5. Perlu login/akun? Data apa yang disimpan?
6. Seberapa besar skala awal (jumlah pengguna/data)?
7. Apa yang **sengaja tidak** dikerjakan di versi 1?
8. Bagaimana tahu project ini berhasil (ukuran sukses dengan angka)?

### 7.1 Tambahan untuk **Game**
Genre dan referensi game serupa; loop inti (apa yang dilakukan pemain tiap 30 detik); kondisi menang/kalah; kontrol (keyboard/sentuh/gamepad); single/multi-player; gaya visual dan sumber aset; progres/penyimpanan; monetisasi (kalau ada); target performa (FPS, perangkat terlemah).

### 7.2 Tambahan untuk **Toko / e-commerce**
Jenis dan jumlah produk; varian (ukuran/warna); katalog dikelola siapa (admin?); keranjang dan checkout; metode pembayaran; ongkos kirim dan kurir; stok; promo/voucher; halaman admin; notifikasi pesanan; kebijakan retur.

### 7.3 Tambahan untuk **Aplikasi / web umum**
Entitas data utama dan relasinya; peran pengguna dan hak akses; alur utama langkah demi langkah; integrasi pihak ketiga; notifikasi; mode offline; ekspor/impor data; kebutuhan keamanan dan privasi.

### 7.4 Jenis "Lainnya"
Gunakan pertanyaan umum 7.0 lalu minta AI menurunkan 4-6 pertanyaan spesifik domain, tetap dengan format opsi + rekomendasi.

## 8. Format keluaran

### 8.1 Template `PRD.md`
Wajib berisi bagian berikut. Tiap bagian harus memakai **jawaban user** (nama, angka, batasan nyata), bukan kalimat umum.

1. Ringkasan dan latar belakang
2. Masalah yang diselesaikan
3. Tujuan dan non-tujuan
4. Pengguna dan skenario
5. Fitur (bernomor `FR-xx`, diprioritaskan **Must / Should / Could**)
6. Kebutuhan non-fungsional **dengan angka** (performa, keamanan, aksesibilitas)
7. Alur pengguna utama
8. Model data / entitas (jika relevan)
9. Metrik sukses (angka + tenggat)
10. Risiko dan asumsi
11. Pertanyaan terbuka (hal yang belum diputuskan user)
12. Rekomendasi stack beserta alasan (atau "ikut pilihan user")

Aturan kualitas ("anti-generik"): tidak boleh ada frasa kosong seperti "user-friendly", "scalable", "modern" tanpa ukuran. Setiap Must-have harus punya cara verifikasi.

### 8.2 Template `taskNN.md`
```markdown
# Task NN: <judul singkat berbentuk aksi>

## Tujuan
Satu-dua kalimat: apa yang harus ada setelah task ini selesai.

## Dependensi
- Task sebelumnya yang harus selesai (atau "tidak ada")

## Konteks
- Bagian PRD terkait: FR-xx, FR-yy
- File/folder yang kemungkinan disentuh

## Langkah
1. ...
2. ...

## Acceptance criteria
- [ ] Kriteria yang bisa dites (perilaku nyata, bukan "kode rapi")
- [ ] ...

## Di luar lingkup
- Hal yang JANGAN dikerjakan di task ini

## Cara verifikasi
Perintah/langkah manual untuk membuktikan task selesai.
```
Aturan: satu task = satu hasil yang bisa dites, idealnya selesai dalam satu sesi agent (kira-kira < 150 baris perubahan inti). Pecah lagi jika lebih besar.

### 8.3 Template `AGENTS.md` (hasil)
Berisi: ringkasan project (3 kalimat), stack, struktur folder, perintah build/test/run, aturan kode, aturan "jangan ubah X", dan urutan membaca file (`AGENTS.md` -> `PRD.md` -> `taskNN.md`).

## 9. Lapisan AI (dua mode)

Web memakai **satu antarmuka provider** (`LLMProvider`) dengan dua implementasi. Pergantian mode lewat Setting (FR-18) dan tersimpan lokal.

| | Mode **Mandiri** | Mode **Vallenatrix** |
|---|---|---|
| Sumber model | Endpoint yang diisi user (base URL + API key + nama model), gaya OpenAI-compatible (`/chat/completions`) | Provider aktif yang sudah dikonfigurasi di vallenatrix (`~/.vallenatrix/config.json`, biasanya 9router lokal) |
| Siapa memegang key | Backend Vallen PRD | Konfigurasi vallenatrix; web tidak meminta key lagi |
| Kegunaan | Dipakai tanpa vallenatrix | Memakai model/akses yang sudah dipakai agent vallenatrix |

Aturan wajib:
- AI-1. **API key tidak boleh ada di kode frontend** dan tidak boleh muncul di log. Semua panggilan model lewat backend kecil milik Vallen PRD.
- AI-2. Mode Vallenatrix **hanya membaca** konfigurasi vallenatrix (read-only) dan tidak menulis ke `~/.vallenatrix/`. Jangan menambah/mengubah kode di `vallenagent/` atau `vallenterminal/`. Jika butuh helper, salin logika kecil ke `vallenprd/` atau impor modul publiknya.
- AI-3. Dua mode memakai kontrak yang sama: `chat(messages, {stream, signal}) -> AsyncIterable<token>` dan `listModels()`. Tambah provider baru tidak boleh menyentuh UI.
- AI-4. Streaming wajib; harus bisa dibatalkan (tombol Stop) dan punya timeout idle (mis. 60 detik tanpa token) yang **menampilkan error**, bukan menganggap hasil terpotong sebagai sukses.
- AI-5. Keluaran terstruktur (daftar pertanyaan, daftar task) diminta dalam **JSON** dengan skema yang divalidasi (mis. zod). Jika JSON tidak valid, coba perbaiki otomatis maksimal 2 kali lalu tampilkan error yang jelas.
- AI-6. Tombol **Tes koneksi** di Setting: kirim permintaan kecil dan tampilkan hasil/penyebab gagal.
- AI-7. Jika mode Vallenatrix dipilih tetapi config tidak ditemukan atau provider tidak aktif, tampilkan petunjuk perbaikan (bukan error mentah).

## 10. Kebutuhan non-fungsional

| ID | Kebutuhan | Ukuran |
|---|---|---|
| NFR-01 | Token pertama tampil setelah user mengirim | <= 3 detik (di luar latensi model) |
| NFR-02 | Generate PRD + task untuk project sedang | tampil bertahap; total <= 90 detik dengan model cepat |
| NFR-03 | Ekspor `.zip` | <= 2 detik untuk 30 file |
| NFR-04 | Responsif | berfungsi di lebar layar 360 px ke atas |
| NFR-05 | Aksesibilitas | navigasi keyboard penuh, kontras minimal WCAG AA |
| NFR-06 | Privasi | data sesi hanya tersimpan lokal; tidak ada telemetri tanpa persetujuan |
| NFR-07 | Ketahanan | refresh halaman tidak menghilangkan sesi yang sedang berjalan |
| NFR-08 | Runtime | Node.js 22 (sama dengan repo ini); tanpa dependensi native yang sulit dipasang |

## 11. Stack (agent yang memilih)

User menyerahkan pilihan stack ke agent. Aturan memilih:
- Utamakan yang **sederhana dan sedikit dependensi**: satu bahasa (TypeScript), satu perintah `npm run dev` dan `npm run build`.
- Frontend dan backend kecil boleh dalam satu proyek.
- Penyimpanan sesi: lokal (IndexedDB/localStorage di browser atau file JSON). Tidak perlu database server untuk versi 1.
- Pembuatan `.zip` dilakukan tanpa layanan eksternal.
- **Wajib** tulis keputusan stack singkat di `vallenprd/docs/decisions/0001-stack.md` (pilihan, alasan, alternatif yang ditolak) sebelum Task 01 dianggap selesai.
- Dilarang memakai CDN eksternal untuk aset penting agar jalan offline selain panggilan model.

## 12. Struktur folder

Web baru berada di **root repo `vallenatrix`**, sejajar `vallenagent/` dan `vallenterminal/`:

```
vallenatrix/
├── vallenagent/              # JANGAN diubah
├── vallenterminal/           # JANGAN diubah
└── vallenprd/                # semua pekerjaan baru di sini
    ├── vallenatrixprd.md     # dokumen ini
    ├── AGENTS.md             # konteks untuk agent (dibuat di Task 01)
    ├── README.md             # cara menjalankan
    ├── docs/
    │   └── decisions/        # catatan keputusan (0001-stack.md, dst)
    ├── skills/
    │   ├── SOURCES.md        # daftar sumber + lisensi + tanggal unduh
    │   ├── _vendor/          # salinan repo referensi (read-only, jangan diedit)
    │   └── vallenprd-core/   # skill buatan sendiri hasil rangkuman (SKILL.md + references/)
    ├── src/
    │   ├── questions/        # bank pertanyaan (data, bukan kode)
    │   ├── templates/        # template PRD, task, AGENTS.md
    │   ├── ai/               # LLMProvider + mode Mandiri + mode Vallenatrix
    │   ├── server/           # backend kecil (proxy ke model)
    │   ├── ui/               # halaman dan komponen
    │   ├── i18n/             # id.json, en.json
    │   └── export/           # salin, unduh, zip
    └── tests/
```
Struktur boleh disesuaikan dengan stack pilihan agent, tetapi folder `docs/decisions`, `skills/`, `src/questions`, `src/templates`, dan `tests` harus ada.

## 13. Rencana implementasi untuk agent (urutan wajib)

Tiap task ditulis ulang oleh agent menjadi file `vallenprd/docs/tasks/taskNN.md` memakai template 8.2 sebelum dikerjakan.

| # | Task | Hasil yang bisa dites | FR terkait |
|---|---|---|---|
| 01 | **Fondasi**: pilih stack, scaffold, `AGENTS.md`, `README.md`, ADR stack, `npm run dev/build/test` jalan | Halaman kosong tampil; build dan test hijau | NFR-08 |
| 02 | **Skills**: unduh referensi ke `skills/_vendor/`, isi `SOURCES.md`, buat `skills/vallenprd-core/` | Folder dan SOURCES.md lengkap; tiap sumber punya lisensi tercatat | bagian 14 |
| 03 | **Lapisan AI**: `LLMProvider`, mode Mandiri, streaming, batal, timeout idle, validasi JSON | Tes dengan server model palsu: stream, batal, dan timeout idle semuanya benar | AI-1..6 |
| 04 | **Mode Vallenatrix** (read-only config) + halaman Setting + tes koneksi + pesan error ramah | Ganti mode lewat Setting; config hilang menampilkan petunjuk | FR-18, AI-2, AI-7 |
| 05 | **Bank pertanyaan** + engine adaptif (klasifikasi, ronde, tergantung_pada, tanpa pertanyaan ganda) | Tes: jawaban yang sama tidak memicu pertanyaan yang sama dua kali | FR-02..06, bagian 7 |
| 06 | **UI percakapan**: ide, ronde pertanyaan dengan opsi/rekomendasi/"kasih saran", ringkasan yang bisa diedit | Alur ide sampai ringkasan jalan end-to-end | FR-01..06 |
| 07 | **Generate PRD + AGENTS.md** (streaming) dengan aturan anti-generik | Dua ide berbeda menghasilkan PRD yang berbeda nyata (tes dengan 3 ide contoh) | FR-07, FR-08, FR-11 |
| 08 | **Generate paket task** (`taskNN.md`) + validasi struktur (acceptance criteria, dependensi, urutan) | Setiap task lolos validator template 8.2 | FR-09, FR-10 |
| 09 | **Tajamin PRD** + mode tempel PRD sendiri | PRD sengaja dibuat samar -> sistem menandai bagian yang lemah | FR-12 |
| 10 | **Ekspor**: salin, unduh satuan, unduh zip, pratinjau markdown, edit manual | Zip berisi semua file dan terbuka normal | FR-13..16, FR-20 |
| 11 | **Riwayat sesi** + i18n ID/EN | Refresh tidak menghilangkan sesi; ganti bahasa mengubah UI dan bahasa keluaran | FR-17, FR-19, NFR-07 |
| 12 | **Pemolesan**: aksesibilitas, responsif 360 px, error state, README final | Cek NFR-04, NFR-05; semua tes hijau | NFR-* |

## 14. Skills referensi: apa yang diunduh dan ditaruh di mana

Tujuan: memakai skill PRD open source sebagai **bahan referensi** untuk membangun bank pertanyaan, template, dan aturan kualitas. Isinya **dirangkum dan ditulis ulang**, bukan disalin mentah.

Langkah untuk agent (Task 02):
1. Buat folder `vallenprd/skills/_vendor/`.
2. Untuk setiap repo di tabel, `git clone --depth 1 <url> vallenprd/skills/_vendor/<nama>` (atau unduh zip jika git tidak ada).
3. Buka `LICENSE` setiap repo dan catat di `vallenprd/skills/SOURCES.md`: nama, URL, lisensi, tanggal unduh, dan commit hash.
4. **Jika repo tidak punya lisensi atau lisensinya melarang penggunaan ulang**, jangan salin teksnya ke mana pun. Cukup pelajari ide umumnya dan catat "referensi konsep saja" di `SOURCES.md`.
5. Hapus `.git` dari salinan vendor agar tidak menjadi repo bersarang.
6. Baca `SKILL.md` dan folder `references/` tiap repo, lalu tulis skill sendiri di `vallenprd/skills/vallenprd-core/` (`SKILL.md` + `references/`) yang merangkum: alur tanya-jawab, aturan anti-generik, template PRD/task, dan checklist review.
7. Bank pertanyaan di `src/questions/` harus **ditulis sendiri** berdasarkan bagian 7, boleh terinspirasi dari referensi.
8. Jika sebuah URL tidak bisa diakses (repo hilang/pindah/jaringan mati), **catat di `SOURCES.md` dan lapor ke user**. Jangan mengarang isi repo tersebut.

| Nama | URL | Dipakai untuk |
|---|---|---|
| ralph (skill `prd`) | https://github.com/snarktank/ralph | Alur tanya-klarifikasi interaktif, PRD yang bisa dikerjakan agent, requirement bernomor |
| ship-it | https://github.com/sugumar247/ship-it | Struktur `references/` per jenis dokumen, quality gate anti-generik, dokumen turunan (TRD, schema, plan) |
| prd-ready | https://github.com/aihxp/prd-ready | Mode kerja (produk baru / fitur / perbaiki PRD generik), pertanyaan pra-penulisan, kriteria sukses berangka |
| TayaIntelligence/skills | https://github.com/TayaIntelligence/skills | `technical-pm` (ide mentah jadi PRD) dan `prd-review` (audit kelengkapan) untuk fitur Tajamin PRD |
| founder-skills (`prd-generator`) | https://github.com/ognjengt/founder-skills | Template PRD ringan siap-AI |
| camacho/ai-skills (`to-prd`) | https://github.com/camacho/ai-skills | Cara merangkum konteks percakapan jadi PRD dengan acceptance criteria |

Opsional: agar agent vallenatrix sendiri bisa memakai skill buatan ini, salin `skills/vallenprd-core/` ke `.vallenatrix/skills/` di root repo. Jangan menyalin isi `_vendor/` ke sana.

## 15. Aturan kerja untuk agent

**Wajib**
- Kerjakan satu task per sesi sesuai urutan bagian 13. Jangan loncat.
- Tiap task: tulis tes dulu atau bersamaan, jalankan `npm test` dan `npm run build`, dan jangan lanjut jika merah.
- Commit kecil per task dengan pesan jelas (`task03: add LLMProvider with streaming`).
- Jangan menaruh API key, token, atau data pribadi di kode, log, atau commit. Gunakan `.env` dan pastikan masuk `.gitignore`.
- Validasi semua input dari model (JSON), jangan percaya mentah-mentah.
- Isi `README.md` agar user bisa menjalankan dengan satu perintah.

**Dilarang**
- Mengubah `vallenagent/` atau `vallenterminal/`.
- Menambah fitur di luar bagian 6 tanpa persetujuan user.
- Menyalin teks skill vendor mentah-mentah ke kode/produk (lihat bagian 14).
- Menyatakan task selesai tanpa menjalankan perintah verifikasinya.

**Berhenti dan tanya user jika**
- Dua requirement saling bertentangan.
- Butuh keputusan yang mengubah lingkup (mis. menambah login, database server, atau layanan berbayar).
- Lisensi sebuah sumber referensi tidak jelas.
- Mode Vallenatrix butuh perubahan di `vallenagent/` agar bisa jalan.
- Stack yang dipilih gagal dipasang di lingkungan user.

Format pertanyaan ke user: tulis masalah, 2-3 opsi, dan rekomendasimu.

## 16. Metrik sukses

| Metrik | Target | Cara ukur |
|---|---|---|
| Paket dokumen dari ide ke ekspor | <= 10 menit untuk user baru | Uji coba manual dengan 3 ide contoh (game, toko, aplikasi) |
| Spesifisitas | 3 ide berbeda menghasilkan PRD yang berbeda nyata (nama entitas, angka, batasan tidak identik) | Review manual + tes otomatis perbandingan |
| Task bisa dikerjakan | >= 80% task hasil generate lolos validator template 8.2 tanpa edit manual | Validator otomatis di Task 08 |
| Keandalan stream | 0 kasus hasil terpotong yang dianggap sukses | Tes server model palsu (Task 03) |
| Penyelesaian | Semua tes hijau, build sukses | CI lokal |

## 17. Risiko dan asumsi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| PRD terasa generik | Produk tidak berguna | Bank pertanyaan berbasis domain, aturan anti-generik, fitur Tajamin PRD |
| Pertanyaan terlalu banyak | User menyerah | Maks. 8 per ronde, jalur cepat, opsi "kasih saran" |
| Task terlalu besar | Agent halu | Validator ukuran/struktur task, pecah otomatis |
| Model mengembalikan JSON rusak | Fitur gagal | Validasi skema + perbaikan otomatis maks. 2 kali |
| Lisensi skill referensi tidak jelas | Masalah hukum | Catat di `SOURCES.md`, rangkum ulang, jangan salin mentah |
| Format config vallenatrix berubah | Mode Vallenatrix patah | Baca defensif, pesan error ramah, ada tes dengan config contoh |

Asumsi: user menjalankan web secara lokal; ada minimal satu sumber model yang valid (endpoint sendiri atau provider vallenatrix); Node.js 22 tersedia.

## 18. Pertanyaan terbuka (untuk user, bukan agent)

- Q1. Nama produk final: tetap "Vallen PRD"?
- Q2. Apakah nanti web ini akan di-host publik? (Jika ya, perlu rate limit, proteksi API key, dan pembahasan ulang privasi.)
- Q3. Jenis project selain game/toko/aplikasi yang ingin ditambahkan ke bank pertanyaan?

## 19. Definisi selesai (Definition of Done)

- [ ] Semua task 01-12 selesai dengan acceptance criteria terpenuhi.
- [ ] `npm run build` dan `npm test` hijau dari clone bersih.
- [ ] Alur ide -> pertanyaan -> PRD -> task -> ekspor `.zip` berjalan end-to-end di kedua mode AI.
- [ ] Tidak ada perubahan di `vallenagent/` dan `vallenterminal/`.
- [ ] `skills/SOURCES.md` lengkap dengan lisensi tiap sumber.
- [ ] README menjelaskan cara menjalankan, mengganti mode AI, dan menambah pertanyaan ke bank.
