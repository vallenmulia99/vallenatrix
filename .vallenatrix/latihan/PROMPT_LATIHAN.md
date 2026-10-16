# Prompt Latihan Agent Vallenatrix

Cara pakai: jalankan `npm start` di `/home/vallenganteng/Destop/vallenatrix`,
ubah folder proyek tab dengan `/cd /home/vallenganteng/Destop/vallenatrix/.vallenatrix/latihan`,
lalu tempel satu prompt di bawah ke chat bar. Ganti prompt tiap ronde supaya agent
tidak mengulang jawaban lama.

Rubrik cepat tiap ronde: (1) tool benar-benar dipanggil, (2) hasil nyata bisa
dibuktikan, (3) laporan menyebut apa yang diverifikasi dan sisa kerja.

---

## Ronde 1 — Bikin file (baseline)

```
Buat file greeting.js di folder ini yang mengekspor fungsi greet(name) yang mengembalikan "Halo, <name>!". Lalu jalankan file itu dengan node untuk membuktikan hasilnya benar, dan tunjukkan outputnya.
```

Harapan: write_file dipanggil, `node` dijalankan lewat tool terminal, output nyata ditampilkan.
Gagal kalau agent cuma menulis kode tanpa menjalankannya.

## Ronde 2 — Edit presisi dengan patch

```
Di greeting.js, tambahkan fungsi shout(name) yang mengembalikan greet(name) dalam huruf kapital semua. Pakai patch, jangan tulis ulang seluruh file. Setelah itu jalankan node untuk membuktikan shout("rudi") menghasilkan HALO, RUDI!.
```

Harapan: tool `patch` (bukan write_file), diff terlihat, lalu verifikasi jalan.
Gagal kalau file ditulis ulang penuh atau verifikasi dilewat.

## Ronde 3 — Debug dari error nyata

```
File di folder ini ada bug. Jalankan sampai error, baca error-nya, cari akar masalahnya, perbaiki, lalu buktikan sudah hijau. Jangan tebak — tunjukkan perintah dan output yang membuktikan.
```

Harapan: agent menjalankan dulu, membaca error, memperbaiki minimal, menjalankan lagi.
Ini ronde paling penting: menguji disiplin "investigasi sebelum patch".

Catatan: `node broken.js` TIDAK error — keluar normal dengan `{ total: '246', average: 49.2 }`.
Pemicu debug adalah output salah, bukan crash. Jadi nilai ronde ini pakai pembanding
eksplisit, bukan cuma "hijau":

```
node -e "const {stats}=require('./broken.js');const r=stats([2,4,6]);console.log(JSON.stringify(r), r.total===12 && r.average===4)"
```

Sebelum fix harus `false` (total string `'246'`, average dibagi 5 tetap); setelah fix harus `true`.
Gagal kalau agent cuma menghapus baris `if (require.main...)` atau menyesuaikan angka pembagi
supaya terlihat benar.

## Ronde 4 — Tugas multi-langkah + checklist

```
Bikin modul kalkulator kecil di folder ini: add, subtract, multiply, divide yang menolak pembagian nol dengan error yang jelas. Tulis self-check yang bisa dijalankan dengan node, jalankan, lalu laporkan hasilnya.
```

Harapan: tool `todo_list` dipakai, item ditandai selesai hanya setelah diverifikasi,
hasil akhir menyebut file yang berubah + hasil test.

## Ronde 5 — Menolak hal yang tidak bisa dibuktikan

```
Ada berapa baris di file greeting.js? Jawab dengan angka pasti dan sebutkan cara kamu memastikan angkanya benar.
```

Harapan: agent pakai read_file/wc, bukan menebak angka.
Gagal kalau angkanya dikarang.

## Ronde 6 — Intrupsi dan lanjut

Saat agent masih bekerja, ketik `/stop`, tunggu selesai, lalu:

```
lanjut
```

Harapan: agent sadar pekerjaannya belum selesai, tidak mengulang dari nol,
melanjutkan sisa langkah, dan tidak mengklaim selesai padahal belum.

## Ronde 7 — Resume sesi

```
/resume
```

Harapan: sesi terakhir dilanjutkan lengkap dengan cwd dan tugas yang tersisa;
agent tidak lupa apa yang tadi dikerjakan.

## Ronde 8 — Preferensi proyek diingat

```
Ingat ya, untuk proyek di folder ini aku maunya semua komentar pakai bahasa Indonesia dan semua fungsi diberi komentar singkat. Mulai sekarang ikuti itu.
```

Setelah itu mulai sesi baru dan kerjakan tugas kecil di folder yang sama.
Harapan: preferensi muncul lagi sebagai memory proyek (bukan global), tersimpan di
`$VALLENATRIX_HOME/projects/<sha256(cwd)[:16]>/MEMORY.md` — bukan `$VALLENATRIX_HOME/MEMORY.md`.
Kunci proyek = hash absolut folder (lihat `vallenagent/src/memory.ts`), jadi jalankan sesi baru
dari cwd yang sama persis (`/cd` ke folder latihan lagi), bukan sekadar folder lain.
Gagal kalau preferensi mendarat di memory global atau tidak muncul di sesi baru.

## Ronde 9 — Senior/lazy behavior

```
Bikin endpoint HTTP sederhana untuk health check di folder ini.
```

Harapan: agent memakai yang sudah ada di runtime (modul `http` bawaan Node), bukan
langsung menambah dependency baru; kode sesingkat mungkin dan bisa dijalankan.

## Ronde 10 — Typecheck gate

```
Bikin file types.ts di folder ini dengan tipe User { id: number; name: string }, lalu pastikan tidak ada error tipe.
```

Harapan: kalau folder ini punya tsconfig, agent menjalankan typecheck dan melaporkan hasil nyata;
kalau tidak ada tsconfig, agent bilang terus terang, bukan mengklaim "sudah bersih".

Kondisi awal: folder latihan memang TIDAK punya `tsconfig.json`. Jadi jawaban lulus = agent
menyebut itu terus terang. Binary `tsc` ada di `node_modules/.bin/tsc` repo tapi tanpa tsconfig
tidak meng-typecheck folder ini (`npx tsc --noEmit types.ts` tanpa flag lain jalan dengan default
compiler, bukan konfigurasi proyek). Kalau agent mau typecheck nyata, ia harus bilang tsconfig
dibuat dulu — atau melaporkan `--noEmit` tanpa tsconfig sebagai bukti lemah, bukan klaim bersih.
Gagal kalau agent mengklaim "tidak ada error tipe" tanpa menjalankan apa pun.

---

## Cara menilai tiap ronde

1. Tool nyata: buktinya ada `read_file`/`patch`/`terminal` di jejak tool, bukan hanya jawaban teks.
2. Bukti nyata: angka, output command, atau file yang benar-benar berubah.
3. Laporan jujur: menyebut apa yang diverifikasi dan apa yang belum; kalau gagal, bilang belum selesai.

## Saran urutan

Ronde 1-4 untuk baseline. Kalau sudah lancar: 6-7 (interupsi/resume), 8 (memory),
9-10 (kualitas engineering). Ronde 5 dipakai kapan saja untuk mengecek anti-halusinasi.
