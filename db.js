// ============================================================
// db.js — Lapisan akses data (fetch ke Worker API backend) + auto cms-scoping.
// ============================================================
// PERUBAHAN ARSITEKTUR (microservices, 2 repo terpisah):
//   - API_BASE sekarang ABSOLUT (bukan '/api' relatif lagi), karena
//     cms-app (frontend, repo ini) dan cms-api (backend) sekarang 2
//     origin/deployment TERPISAH (mis. frontend di GitHub Pages, backend
//     di Cloudflare Workers). ISI URL DI BAWAH sesuai hasil `wrangler
//     deploy` di repo cms-api.
//   - Semua parameter (table, id, cmsId) sekarang dikirim lewat QUERY
//     STRING ke satu endpoint `/api`, BUKAN path segment (`/api/table/id`)
//     seperti sebelumnya — konsisten dengan worker.js yang baru.
//   - SCOPED_TABLES diperbarui utk tabel CMS: users, post, komentar.
//   - cmsId tetap otomatis ditambahkan ke tiap request tabel scoped
//     dari sesi login aktif (lihat auth.js) — halaman (editor.js,
//     postingan.js, dst.) tidak perlu mengurus cmsId sendiri.
// ============================================================

// GANTI dengan URL hasil `wrangler deploy` di repo cms-api, tanpa slash
// di akhir. Contoh: 'https://cms-api.namaakun.workers.dev'
const API_BASE = 'https://piawai-api.piawai.workers.dev';

const SCOPED_TABLES = new Set(['post']); // `users` & `komentar` tidak lagi diakses lewat /api

// ============================================================
// [SECURITY] Token sesi. Backend (cms-api) sekarang menurunkan cmsId &
// role dari token bertanda tangan ini, BUKAN dari query string — jadi
// mengubah cmsId di localStorage tidak lagi membuka data CMS lain.
// cmsId tetap dikirim hanya untuk kunci cache di sisi klien.
// ============================================================
function authHeaders() {
    const t = (typeof auth !== 'undefined') ? auth.token() : null;
    return t ? { Authorization: `Bearer ${t}` } : {};
}

/** 401 = sesi habis/dicabut server -> bersihkan sesi lokal & kembali ke login. */
function handleUnauthorized() {
    if (typeof auth !== 'undefined') {
        try { localStorage.removeItem(auth.SESSION_KEY); } catch (e) {}
    }
    if (typeof web !== 'undefined' && typeof web.navigate === 'function') web.navigate('login');
}

/** Bangun query string dari objek {key: value}, buang key yang kosong/undefined. */
function qs(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') sp.set(k, v);
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

async function apiGet(params) {
    const res = await fetch(`${API_BASE}/api${qs(params)}`, { headers: authHeaders() });
    if (res.status === 401) { handleUnauthorized(); throw new Error('Sesi berakhir, silakan masuk kembali.'); }
    if (!res.ok) {
        let msg = `GET /api gagal (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

async function apiSend(method, params, body) {
    const res = await fetch(`${API_BASE}/api${qs(params)}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { handleUnauthorized(); throw new Error('Sesi berakhir, silakan masuk kembali.'); }
    if (res.status === 404) return null;
    if (!res.ok) {
        let msg = `${method} /api gagal (${res.status})`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
    }
    return res.json();
}

/** Fetch ke endpoint /public (data siap-pakai untuk halaman publik, lihat pages/public.js). */
async function apiPublicGet(params) {
    const res = await fetch(`${API_BASE}/public${qs(params)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `GET /public gagal (${res.status})`);
    return body;
}

async function apiPublicSend(method, params, body) {
    const res = await fetch(`${API_BASE}/public${qs(params)}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const resBody = await res.json().catch(() => null);
    if (!res.ok) throw new Error(resBody?.error || `${method} /public gagal (${res.status})`);
    return resBody;
}

// ============================================================
// [PERF] Cache in-memory per tabel — db.all() dipanggil berulang kali
// oleh banyak resolver (menu, dashboard, halaman publik, dst.) untuk
// tabel yang sama dalam waktu berdekatan. Tanpa cache, tiap navigasi
// menunggu fetch penuh lagi walau datanya belum berubah, itu salah
// satu sumber "jeda terasa" saat pindah halaman. Cache ini HANYA hidup
// selama sesi tab (di memori, bukan localStorage) dan otomatis
// dibuang lewat invalidateTable() setiap ada insert/update/remove —
// jadi tidak pernah menampilkan data basi setelah CRUD.
// ============================================================
const _tableCache = new Map(); // key: "table:cmsId" -> { data, ts }
const CACHE_TTL_MS = 30_000; // jaga-jaga kalau data berubah dari sesi/tab lain

function cacheKey(table, cmsId) {
    return cmsId ? `${table}:${cmsId}` : table;
}

/** Buang entri cache untuk satu tabel (semua cmsId, atau satu cmsId spesifik). */
function invalidateTable(table, cmsId) {
    if (cmsId !== undefined) { _tableCache.delete(cacheKey(table, cmsId)); return; }
    for (const key of _tableCache.keys()) {
        if (key === table || key.startsWith(`${table}:`)) _tableCache.delete(key);
    }
}

function activeCmsId() {
    const user = (typeof auth !== 'undefined') ? auth.currentUser() : null;
    return user?.cmsId || null;
}

function requireCms() {
    const c = activeCmsId();
    if (!c) throw new Error('Tidak ada sesi aktif — silakan masuk kembali.');
    return c;
}

const db = {
    async all(table) {
        const params = { table };
        if (SCOPED_TABLES.has(table)) params.cmsId = requireCms();

        const key = cacheKey(table, params.cmsId);
        const hit = _tableCache.get(key);
        if (hit && (Date.now() - hit.ts) < CACHE_TTL_MS) return hit.data;

        const data = await apiGet(params);
        _tableCache.set(key, { data, ts: Date.now() });
        return data;
    },

    async find(table, predicate) {
        const rows = await this.all(table);
        return rows.find(predicate) || null;
    },

    async query(table, predicate) {
        const rows = await this.all(table);
        return rows.filter(predicate);
    },

    async insert(table, row) {
        const body = { ...row };
        const params = { table };
        if (SCOPED_TABLES.has(table)) {
            const c = requireCms();
            body.cmsId = c;
            params.cmsId = c;
        }
        const result = await apiSend('POST', params, body);
        invalidateTable(table, params.cmsId);
        return result;
    },

    async update(table, id, patch) {
        const params = { table, id };
        if (SCOPED_TABLES.has(table)) params.cmsId = requireCms();
        const result = await apiSend('PATCH', params, patch);
        invalidateTable(table, params.cmsId);
        return result;
    },

    async remove(table, id) {
        const params = { table, id };
        if (SCOPED_TABLES.has(table)) params.cmsId = requireCms();
        await apiSend('DELETE', params);
        invalidateTable(table, params.cmsId);
        return true;
    },

    // --- CATATAN: allForCms()/insertForCms() DIHAPUS ---
    // Dulu dipakai auth.js untuk menarik SELURUH tabel `users` (termasuk
    // password) ke browser lalu mencocokkan di JS. Backend sekarang
    // memblokir tabel `users` dari /api sepenuhnya; login & registrasi
    // pindah ke endpoint server (lihat auth.login / auth.register).

    // --- Tabel `cms` sendiri TIDAK di-scope (global) ---
    async allCms() {
        const key = cacheKey('cms');
        const hit = _tableCache.get(key);
        if (hit && (Date.now() - hit.ts) < CACHE_TTL_MS) return hit.data;
        const data = await apiGet({ table: 'cms' });
        _tableCache.set(key, { data, ts: Date.now() });
        return data;
    },
    async updateCms(id, patch) {
        const result = await apiSend('PATCH', { table: 'cms', id }, patch);
        invalidateTable('cms');
        return result;
    },

    // --- Autentikasi (diproses SEPENUHNYA di server) ---
    async login(payload) { return apiPublicSend('POST', { view: 'login' }, payload); },
    async register(payload) { return apiPublicSend('POST', { view: 'register' }, payload); },

    // --- Captcha matematika (lihat auth.js) — soal baru tiap dipanggil. ---
    async getCaptcha() { return apiPublicGet({ view: 'captcha' }); },

    // --- Data publik (beranda / profil CMS / artikel + komentar) ---
    // Tabel `halaman` & `menu` TIDAK di-scope per-CMS (isinya wajah situs,
    // bukan milik satu penulis), jadi db.all/insert/update/remove generik
    // di atas sudah cukup untuk sisi admin — tidak ada helper khusus.
    async publicHome() { return apiPublicGet({ view: 'home' }); },
    async publicHalaman(slug) { return apiPublicGet({ view: 'halaman', slug }); },
    async publicMenu() { return apiPublicGet({ view: 'menu' }); },
    async publicArtikelList() { return apiPublicGet({ view: 'artikel-list' }); },
    async publicProfile(userSlug) { return apiPublicGet({ view: 'profile', user: userSlug }); },
    async publicArtikel(userSlug, slug) { return apiPublicGet({ view: 'artikel', user: userSlug, slug }); },
    async publicKomentar(userSlug, slug, komentar) {
        return apiPublicSend('POST', { view: 'komentar', user: userSlug, slug }, komentar);
    },
};
