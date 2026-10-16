# TASK.md — jalankan task 1-7 sampai selesai

Jalankan satu task, selesaikan sampai ada bukti nyata, lalu lanjut task berikutnya.
Setiap task dijawab apa adanya: sebut file yang berubah, perintah yang dijalankan, dan
output nyatanya. Kalau ada yang tidak bisa dibuktikan, bilang terus terang.

Folder kerja: folder ini sendiri.

---

## Task 1

Buat file greeting.js di folder ini yang mengekspor fungsi greet(name) yang
mengembalikan "Halo, <name>!". Lalu jalankan file itu dengan node untuk membuktikan
hasilnya benar, dan tunjukkan outputnya.

## Task 2

Di greeting.js, tambahkan fungsi shout(name) yang mengembalikan greet(name) dalam
huruf kapital semua. Pakai patch, jangan tulis ulang seluruh file. Setelah itu
jalankan node untuk membuktikan shout("rudi") menghasilkan HALO, RUDI!.

## Task 3

Folder ini ada file broken.js. Ada yang salah di perhitungannya. Jalankan sampai
kelihatan salahnya, cari akar masalahnya, perbaiki, lalu buktikan sudah benar dengan
membandingkan angka yang diharapkan. Jangan tebak — tunjukkan perintah dan output
yang membuktikan.

Pembanding yang bisa dipakai:

node -e "const {stats}=require('./broken.js');const r=stats([2,4,6]);console.log(JSON.stringify(r), r.total===12 && r.average===4)"

## Task 4

Bikin modul kalkulator kecil di folder ini: add, subtract, multiply, divide yang
menolak pembagian nol dengan error yang jelas. Tulis self-check yang bisa dijalankan
dengan node, jalankan, lalu laporkan hasilnya.

## Task 5

Ada berapa baris di file greeting.js? Jawab dengan angka pasti dan sebutkan cara
kamu memastikan angkanya benar.

## Task 6

Bikin endpoint HTTP sederhana untuk health check di folder ini, lalu buktikan
endpointnya benar-benar merespons dengan menjalankannya dan menembak URL-nya. Setelah
bukti terkumpul, matikan servernya lagi.

## Task 7

Bikin file types.ts di folder ini dengan tipe User { id: number; name: string }

lalu pastikan tidak ada error tipe.
