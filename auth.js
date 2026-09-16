// ============================================================
// auth.js — Login berbasis "kode CMS" (= slug URL publik)
// + username/password.
// ============================================================
// Sesi disimpan di localStorage (key: cmsSession): { cmsId,
// cmsNama, cmsKode, userId, username, name, role }. Superadmin
// adalah CMS khusus (kodeCms 'superadmin', lihat seed di
// schema.sql) — dengan begini alur login TETAP SATU POLA untuk semua
// peran (owner/penulis/superadmin).
//
// kodeCms di sini RANGKAP PERAN: dipakai untuk login DAN sebagai NILAI
// URL profil publik (?profile/<kodeCms>) & artikel (?user/<kodeCms>/<slug>)
// — wajib url-safe.
//
// CATATAN ARSITEKTUR: versi sebelumnya (routing path) perlu daftar
// RESERVED_SLUGS supaya kodeCms tidak bentrok dengan path admin seperti
// /dashboard atau /editor. Di routing query string sekarang, kodeCms
// TIDAK PERNAH jadi bagian nama rute (`?page=`) — dia cuma NILAI di
// dalam query string publik (`?profile/...`, `?user/.../...`), jadi
// tidak mungkin bentrok dengan `?page=dashboard` dkk. Reserved-word
// check jadi tidak diperlukan lagi; validasi cukup format url-safe saja.
// Diulang juga di worker.js (SLUG_RE) sebagai jaring pengaman server-side.
// ============================================================
// ============================================================
// [SECURITY] CAPTCHA matematika kustom di login & registrasi.
// ------------------------------------------------------------
// Menggantikan Cloudflare Turnstile: tidak ada script pihak ketiga
// yang dimuat (jadi tidak bisa ter-block ad-blocker), tidak ada Site
// Key untuk dikonfigurasi, dan verifikasinya tetap 100% di server
// (lihat generateMathCaptcha/verifyMathCaptcha di worker.js, repo
// cms-api) — bukan cuma dicek di JS sini.
//
// Alur: sebelum form Masuk/Daftar dirender, kita minta soal ke server
// (`db.getCaptcha()` -> GET /public?view=captcha), yang membalas
// { challenge: "4 + 7 = ?", token }. `token` (bertanda tangan HMAC,
// tidak berisi jawaban yang bisa dibaca tanpa verifikasi server)
// ditaruh sebagai hidden input; jawaban pengguna dikirim sebagai
// `captchaAnswer` bersama `captchaToken` ke endpoint login/register.
// Backend yang memutuskan benar/salah — kode di sini HANYA menampilkan
// soal dan mengumpulkan jawaban, sama seperti widget captcha lain.
//
// [SANGAT PENTING — INI BAGIAN YANG SERING TERLEWAT]
// Kalau backend (cms-api, repo terpisah) tidak memverifikasi
// `captchaToken`/`captchaAnswer`, maka captcha di sini CUMA HIASAN —
// bot yang memanggil endpoint API langsung (tanpa lewat frontend ini
// sama sekali) akan tetap lolos. Backend versi ini SUDAH melakukan
// verifikasi itu (lihat worker.js), tapi kalau nanti backend diganti
// atau di-fork, pastikan verifikasi itu tetap ada.
// ============================================================

/** Bangun HTML field captcha (raw, karena harus di dalam <form> yang sama
 *  supaya form.querySelector(...) di JS bisa menemukan hidden token-nya —
 *  lihat catatan `type:'raw'` di engine.js). `challenge` divalidasi format
 *  ketat sebelum disisipkan, walau sumbernya backend sendiri (bukan input
 *  pengguna), sebagai lapisan jaga-jaga tambahan. */
function mathCaptchaFieldsHtml(challenge, token) {
    const safeChallenge = /^\d{1,2} \+ \d{1,2} = \?$/.test(challenge) ? challenge : 'Soal captcha tidak valid';
    return `<input type="hidden" class="js-captcha-token" name="captchaToken" value="${escHtml(token || '')}">
        <div class="a-row">
            <label class="a-label">Captcha: ${escHtml(safeChallenge)}</label>
            <input type="number" class="js-captcha-answer" name="captchaAnswer" placeholder="Jawaban" required autocomplete="off">
        </div>`;
}

/** Ambil soal baru dari server dan render field captcha ke dalam form.
 *  Dipakai saat form pertama dibuka DAN setelah percobaan gagal (supaya
 *  token lama yang mungkin sudah kedaluwarsa/terpakai diganti yang baru). */
async function renderMathCaptcha(form) {
    const slot = form.querySelector('.js-captcha-slot');
    if (!slot) return;
    try {
        const { challenge, token } = await db.getCaptcha();
        slot.innerHTML = mathCaptchaFieldsHtml(challenge, token);
    } catch (e) {
        slot.innerHTML = `<div class="a-row"><span style="color:var(--red,#c00)">Gagal memuat captcha: ${escHtml(e.message)}</span></div>`;
    }
}

/** Baca token + jawaban captcha yang sedang ditampilkan di form ini. */
function readCaptcha(form) {
    return {
        captchaToken: form.querySelector('.js-captcha-token')?.value || '',
        captchaAnswer: form.querySelector('.js-captcha-answer')?.value || '',
    };
}

const auth = {
    SESSION_KEY: 'cmsSession',
    TOKEN_KEY: 'cmsToken',
    SUPERADMIN_KODE: 'superadmin',

    SLUG_RE: /^[a-z0-9][a-z0-9-]{1,29}$/,

    // [SECURITY] Pengunci sisi-klien setelah beberapa kali gagal login.
    // Ini HANYA pelapis UX (mencegah orang iseng klik cepat berkali-kali
    // di browser) — SAMA SEKALI BUKAN pertahanan terhadap brute-force
    // sungguhan, karena siapa pun bisa memanggil endpoint login backend
    // langsung tanpa lewat kode ini. Rate limiting/lockout yang nyata
    // WAJIB ada di backend (per IP dan/atau per akun). Lihat SECURITY.md.
    LOGIN_LOCKOUT_KEY: 'cmsLoginAttempts',
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_LOCKOUT_MS: 60_000,

    _loginAttemptState() {
        try { return JSON.parse(sessionStorage.getItem(this.LOGIN_LOCKOUT_KEY) || 'null') || { count: 0, until: 0 }; }
        catch (e) { return { count: 0, until: 0 }; }
    },
    _recordLoginFailure() {
        const s = this._loginAttemptState();
        s.count += 1;
        if (s.count >= this.LOGIN_MAX_ATTEMPTS) { s.until = Date.now() + this.LOGIN_LOCKOUT_MS; s.count = 0; }
        try { sessionStorage.setItem(this.LOGIN_LOCKOUT_KEY, JSON.stringify(s)); } catch (e) {}
    },
    _clearLoginFailures() {
        try { sessionStorage.removeItem(this.LOGIN_LOCKOUT_KEY); } catch (e) {}
    },
    _lockoutRemainingMs() {
        const s = this._loginAttemptState();
        return Math.max(0, s.until - Date.now());
    },

    /** Token sesi bertanda tangan dari server (dipakai db.js di header Authorization). */
    token() {
        try { return localStorage.getItem(this.TOKEN_KEY) || null; } catch (e) { return null; }
    },

    _saveSession(res) {
        localStorage.setItem(this.TOKEN_KEY, res.token);
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(res.user));
    },

    currentUser() {
        try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); }
        catch (e) { return null; }
    },

    isLoggedIn() { return !!this.currentUser(); },
    isSuperadmin() { return this.currentUser()?.role === 'superadmin'; },

    validateKodeCms(kodeRaw) {
        const kode = String(kodeRaw || '').trim().toLowerCase();
        if (!this.SLUG_RE.test(kode)) return 'Kode CMS harus 2-30 karakter: huruf kecil, angka, atau tanda strip (mis. "wawan" atau "catatan-wawan").';
        return null;
    },

    /**
     * Login — SELURUH pencocokan kredensial terjadi di server.
     *
     * [SECURITY] Versi lama menarik seluruh tabel `users` (termasuk kolom
     * password) ke browser lewat db.allForCms('users', ...) lalu
     * membandingkan `u.password === password` di JS. Endpoint itu kini
     * diblokir di backend, dan password disimpan sebagai hash PBKDF2.
     * Yang kembali dari server hanya token sesi + data tampilan pengguna —
     * tidak pernah hash, tidak pernah daftar akun.
     */
    async login(kodeCms, username, password, captcha) {
        const kode = String(kodeCms || '').trim().toLowerCase();
        if (!kode || !username || !password) return 'Kode CMS, username, dan password wajib diisi.';
        try {
            const res = await db.login({ kodeCms: kode, username, password, ...captcha });
            this._saveSession(res);
            return null; // null = sukses
        } catch (e) {
            return e.message;
        }
    },

    /**
     * Registrasi mandiri CMS baru — juga satu panggilan server (membuat
     * baris `cms` + akun owner ber-hash dalam satu transaksi logis, setelah
     * captcha diverifikasi). Frontend tidak lagi membuat baris `users`
     * sendiri lewat CRUD generik.
     */
    async register({ kodeCms, namaCms, bio, ownerName, username, password, captchaToken, captchaAnswer }) {
        const kode = String(kodeCms || '').trim().toLowerCase();
        if (!kode || !namaCms || !ownerName || !username || !password) return 'Semua field bertanda * wajib diisi.';
        const slugErr = this.validateKodeCms(kode);
        if (slugErr) return slugErr;
        if (password.length < 8) return 'Password minimal 8 karakter.';
        try {
            const res = await db.register({ kodeCms: kode, namaCms, bio: bio || '', ownerName, username, password, captchaToken, captchaAnswer });
            this._saveSession(res);
            return null;
        } catch (e) {
            return e.message;
        }
    },

    logout() {
        localStorage.removeItem(this.SESSION_KEY);
        localStorage.removeItem(this.TOKEN_KEY);
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('login');
    },

    /** Dipanggil dari renderMenu() (index.html) tiap kali menu digambar ulang. */
    renderAuthUI() {
        const slot = web.gebi('authSlot');
        if (!slot) return;
        const user = this.currentUser();
        slot.innerHTML = user
            ? `<span class="auth-chip">
                   <i class="di-person img-24"></i>
                   <span class="auth-name">${user.name}${user.role !== 'superadmin' ? ' &middot; ' + (user.cmsNama || '') : ''}</span>
                   <span class="badge auth-role">${roleLabel(user.role)}</span>
               </span>
               ${user.role !== 'superadmin' ? `<a class="slcBtn" href="${web.href(`profile/${user.cmsKode}`)}" target="_blank" rel="noopener">Lihat CMS</a>` : ''}
               <button class="slcBtn auth-logout" onclick="auth.logout()">Keluar</button>`
            : `<a href="javascript:void(0)" onclick="web.navigate('login')" class="auth-chip">
                   <i class="di-lock img-24"></i>
                   <span class="auth-name">Masuk</span>
               </a>`;
        if (typeof svg?.di === 'function') svg.di();
    },

    async handleLoginSubmit(form) {
        const remaining = this._lockoutRemainingMs();
        if (remaining > 0) {
            alert(`Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(remaining / 1000)} detik.`);
            return;
        }

        // [SECURITY] captchaToken/captchaAnswer dikirim apa adanya ke server —
        // verifikasi yang SAH terjadi di backend (lihat verifyMathCaptcha di
        // worker.js, repo cms-api), bukan di sini.
        const captcha = readCaptcha(form);
        if (!captcha.captchaToken || !captcha.captchaAnswer) { alert('Mohon isi jawaban captcha terlebih dahulu.'); return; }

        const kodeCms = form.querySelector('[name="kodeCms"]').value;
        const username = form.querySelector('[name="username"]').value.trim();
        const password = form.querySelector('[name="password"]').value;

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Memproses...'; }
        const err = await this.login(kodeCms, username, password, captcha).catch(e => e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Masuk'; }
        await renderMathCaptcha(form); // soal lama sudah terpakai (atau salah) -> ganti yang baru

        if (err) { this._recordLoginFailure(); alert(err); return; }
        this._clearLoginFailures();
        if (typeof renderMenu === 'function') renderMenu();

        // Jika pengguna tadi diarahkan ke sini dari komentar artikel (lihat
        // publicPage.goLoginThenReturn di pages/public.js), balik ke sana.
        let redirect = null;
        try { redirect = JSON.parse(sessionStorage.getItem('postLoginRedirect') || 'null'); } catch (e) {}
        if (redirect) {
            sessionStorage.removeItem('postLoginRedirect');
            web.navigate(redirect);
            return;
        }
        web.navigate(this.isSuperadmin() ? 'cms' : 'dashboard');
    },

    async handleRegisterSubmit(form) {
        const captcha = readCaptcha(form);
        if (!captcha.captchaToken || !captcha.captchaAnswer) { alert('Mohon isi jawaban captcha terlebih dahulu.'); return; }

        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() || '';
        const payload = {
            kodeCms: val('kodeCms'), namaCms: val('namaCms'), bio: val('bio'),
            ownerName: val('ownerName'), username: val('username'),
            password: form.querySelector('[name="password"]').value,
            ...captcha,
        };
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Mendaftarkan...'; }
        const err = await this.register(payload).catch(e => e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Daftar & Mulai'; }
        await renderMathCaptcha(form);

        if (err) { alert(err); return; }
        alert(`CMS "${payload.namaCms}" berhasil dibuat di cms.piawai.id/?profile/${payload.kodeCms.toLowerCase()}. Selamat menulis!`);
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('dashboard');
    },
};

function roleLabel(role) {
    return { superadmin: 'Superadmin', owner: 'Pemilik CMS', penulis: 'Penulis' }[role] || role;
}

/** Guard: dipanggil di awal resolver halaman yang butuh login (lihat pages/*.js). */
function requireLogin(allowedRoles) {
    const user = auth.currentUser();
    if (!user) {
        return [{ section: 'titleHero', title: 'Perlu Masuk',
                   description: `Silakan <a href="javascript:void(0)" onclick="web.navigate(&#39;login&#39;)">masuk</a> terlebih dahulu untuk mengakses halaman ini.` }];
    }
    if (allowedRoles && !allowedRoles.includes(user.role)) {
        return [{ section: 'titleHero', title: 'Akses Ditolak',
                   description: 'Peran akun Anda tidak memiliki izin untuk membuka halaman ini.' }];
    }
    return null; // null = boleh lanjut
}

/** Ambil soal captcha awal untuk sebuah form baru dibuka. Dibungkus try/catch
 *  supaya server yang sedang bermasalah tidak membuat seluruh halaman Masuk/
 *  Daftar gagal dirender — pesan errornya ditampilkan di slot captcha saja. */
async function initialCaptchaFieldHtml() {
    try {
        const { challenge, token } = await db.getCaptcha();
        return `<div class="js-captcha-slot">${mathCaptchaFieldsHtml(challenge, token)}</div>`;
    } catch (e) {
        return `<div class="js-captcha-slot"><div class="a-row"><span style="color:var(--red,#c00)">Gagal memuat captcha: ${escHtml(e.message)}</span></div></div>`;
    }
}

web.routes.login = 'resolveLogin';
web.resolveLogin = async function () {
    if (auth.isLoggedIn()) {
        return [{ section: 'titleHero', title: 'Anda Sudah Masuk',
                   description: `Masuk sebagai <strong>${auth.currentUser().name}</strong>.` }];
    }
    return [
        { section: 'titleHero', title: 'Masuk ke CMS Anda', description: 'Masukkan kode CMS, username, dan password.' },
        {
            section: 'articleFull',
            subtitle: 'Form Masuk',
            fields: [
                { type: 'text', name: 'kodeCms', label: 'Kode CMS', placeholder: 'mis. wawan', required: true, autocomplete: 'username' },
                { type: 'text', name: 'username', label: 'Username', required: true, autocomplete: 'username' },
                { type: 'password', name: 'password', label: 'Password', required: true, autocomplete: 'current-password' },
                { type: 'raw', html: await initialCaptchaFieldHtml() },
            ],
            submitText: 'Masuk',
            onSubmit: 'event.preventDefault(); auth.handleLoginSubmit(this);',
            lines: [
                'form:',
                'link:Belum punya CMS? Daftar di sini:register',
                // [SECURITY] Kredensial demo SENGAJA tidak lagi ditampilkan di
                // halaman login publik — itu sama saja memasang kunci di pintu.
                // Akun demo (kalau dipakai) ada di schema.sql, bukan di UI.
            ],
        },
    ];
};

web.routes.register = 'resolveRegister';
web.resolveRegister = async function () {
    if (auth.isLoggedIn()) return web.resolveLogin();
    return [
        { section: 'titleHero', title: 'Buat CMS Baru', description: 'Buat CMS Anda sendiri dalam satu langkah — dapat alamat cms.piawai.id/?profile/kode-anda.' },
        {
            section: 'articleFull',
            subtitle: 'Form Registrasi CMS',
            fields: [
                { type: 'text', name: 'kodeCms', label: 'Kode CMS (alamat URL)', placeholder: 'mis. wawan', required: true, maxlength: 30 },
                { type: 'text', name: 'namaCms', label: 'Nama Tampilan / Nama CMS', required: true, maxlength: 80 },
                { type: 'textarea', name: 'bio', label: 'Bio Singkat', rows: 2, maxlength: 300 },
                { type: 'text', name: 'ownerName', label: 'Nama Anda', required: true, maxlength: 80, autocomplete: 'name' },
                { type: 'text', name: 'username', label: 'Username Login', required: true, maxlength: 40, autocomplete: 'username' },
                { type: 'password', name: 'password', label: 'Password (min. 8 karakter)', required: true, autocomplete: 'new-password' },
                { type: 'raw', html: await initialCaptchaFieldHtml() },
            ],
            submitText: 'Daftar & Mulai',
            onSubmit: 'event.preventDefault(); auth.handleRegisterSubmit(this);',
            lines: [
                'form:',
                'Kode CMS akan menjadi alamat publik: cms.piawai.id/?profile/kode-cms-anda. Hanya huruf kecil, angka, dan tanda strip.',
                'link:Sudah punya akun? Masuk di sini:login',
            ],
        },
    ];
};
