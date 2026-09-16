// ============================================================
// dataset.js — Konfigurasi menu ADMIN (siteConfig) + util slugify.
// Menambah halaman admin baru cukup di sini + daftar `pageFiles`, tidak
// perlu menyentuh index.html (lihat renderMenu di sana).
// ============================================================
// CATATAN PEMBAGIAN TUGAS: siteConfig hanya mengurus menu ADMIN — daftar
// yang tetap, ditentukan developer, dan disaring per-peran. Menu PUBLIK
// (Beranda, Produk, Artikel, Penulis, Tentang, dst.) TIDAK ada di sini:
// isinya dibuat superadmin lewat halaman "Kelola Menu" dan diambil saat
// runtime dari backend (db.publicMenu()). Keduanya digabung di
// renderMenu() — lihat index.html.
// ============================================================
const siteConfig = [
    { slug: 'dashboard',  label: 'Dashboard', menu: true, role: ['owner', 'penulis'] },
    { slug: 'editor',     label: 'Tulis Baru', menu: true, role: ['owner', 'penulis'] },
    { slug: 'postingan',  label: 'Artikel Saya', menu: true, role: ['owner', 'penulis'] },
    { slug: 'profil',     label: 'Profil CMS', menu: true, role: ['owner'] },
    { slug: 'cms',        label: 'Kelola CMS', menu: true, role: ['superadmin'] },
    { slug: 'halaman',    label: 'Kelola Halaman', menu: true, role: ['superadmin'] },
    { slug: 'menu',       label: 'Kelola Menu', menu: true, role: ['superadmin'] },
    { slug: 'login',      label: 'Masuk',     menu: true, guestOnly: true },
];

/** Ubah teks bebas jadi slug url-safe (huruf kecil, angka, strip). Dipakai
 *  oleh editor.js (judul artikel -> slug) & auth.js (nama CMS -> kode CMS). */
function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'artikel';
}

// Daftar file JS halaman yang dimuat berurutan sebelum menu dirender.
// Termasuk pages/public.js (beranda, profil CMS, artikel + komentar) —
// dulu di-SSR langsung oleh worker.js, sekarang di-render client-side
// di sini karena backend (cms-api) sudah dipisah jadi microservice API
// murni tanpa SSR. Lihat pages/public.js.
const pageFiles = [
    'pages/public.js',
    'pages/dashboard.js',
    'pages/editor.js',
    'pages/postingan.js',
    'pages/profil.js',
    'pages/cms.js',
    'pages/halaman.js',
    'pages/kelola-menu.js',
];

// [PERF] Sebelumnya file dimuat SATU PER SATU (request ke-2 baru dikirim
// setelah request ke-1 selesai, dst) — 6 file kecil jadi 6x round-trip
// berurutan, padahal isinya independen (masing-masing cuma mengisi
// web.routes.<slug> + fungsi resolver sendiri, lihat komentar di tiap
// pages/*.js). Cross-call antar resolver (mis. resolveDashboard yang
// memanggil resolveCms()) baru terjadi saat navigasi sungguhan, JAUH
// setelah semua file ini selesai dimuat — jadi urutan muat aman diabaikan.
// Sekarang semua file dikirim SEKALIGUS lewat Promise.all: total waktu
// tunggu = request TERLAMA, bukan JUMLAH semua request.
function loadPageScripts(files, done) {
    Promise.all(files.map(src => new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = resolve; // tetap lanjut walau 1 file gagal, supaya halaman lain tidak ikut macet
        document.body.appendChild(s);
    }))).then(done);
}
