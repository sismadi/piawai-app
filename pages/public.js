// ============================================================
// pages/public.js — Halaman PUBLIK (beranda, profil CMS, artikel +
// komentar). Rute: ?           (home)
//                   ?profile/<kodeCms>           (profil CMS)
//                   ?user/<kodeCms>/<slug>       (artikel)
// Lihat PRETTY_PUBLIC_ROUTES di engine.js untuk cara URL di atas
// dibaca/dibangun dari query string.
// ============================================================
// PERUBAHAN ARSITEKTUR: halaman-halaman ini DULU di-SSR (server-rendered
// HTML) langsung oleh worker.js supaya mesin pencari & pengunjung tanpa
// JS tetap bisa membaca artikel. Sekarang backend (cms-api) sudah
// dipisah jadi microservice API murni (JSON only, tanpa SSR) — jadi
// render HTML dilakukan DI SINI, di klien, memakai data dari
// db.publicHome() / db.publicProfile() / db.publicArtikel() (lihat db.js).
//
// Konsekuensi yang perlu diketahui:
//   - Pengindeksan mesin pencari kini bergantung pada Google/dst. mampu
//     menjalankan JavaScript (umumnya bisa, tapi tidak sekuat SSR asli).
//   - Form komentar SEKARANG butuh JS (fetch ke /public?view=komentar),
//     karena hosting statis (mis. GitHub Pages) tidak punya server yang
//     bisa memproses submit form HTML biasa.
// ============================================================

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// ============================================================
// [SECURITY] Sanitasi HTML untuk `post.konten`.
// ------------------------------------------------------------
// editor.js sengaja mengizinkan penulis mengetik HTML dasar untuk isi
// artikel (<p>, <strong>, <a>, dst — lihat label field 'konten'), dan
// nilai itu dirender APA ADANYA lewat innerHTML di halaman publik
// (`<div class="post-konten">${post.konten}</div>`). Ini rich-text yang
// SAH untuk kasus normal, TAPI kalau tidak disaring, ini juga jadi jalan
// masuk stored XSS langsung ke pengunjung publik: satu akun penulis yang
// nakal atau kena bobol saja cukup untuk menyerang SEMUA pembaca artikel
// itu (curi sesi admin lain lewat localStorage, redirect, cryptojacking,
// dsb).
//
// sanitizeHtml() memakai DAFTAR PUTIH (allowlist) tag & atribut — bukan
// daftar hitam — karena daftar hitam nyaris selalu bisa dilubangi (mis.
// event handler ada puluhan nama: onerror, onload, onpointerover, dst).
// Prinsipnya: apa pun yang tidak ada di daftar putih DIBUANG, bukan
// "dicoba dibersihkan".
//
// CATATAN PENTING: ini sanitasi di SISI KLIEN, dijalankan tiap kali
// artikel ditampilkan — jadi tetap melindungi pengunjung walau data
// "kotor" berhasil masuk ke database lewat jalur lain (mis. seseorang
// memanggil API backend langsung, melewati form editor). Tapi ini BUKAN
// pengganti validasi/sanitasi di backend (cms-api, repo terpisah) —
// idealnya backend juga menyaring `konten` saat disimpan, supaya semua
// konsumen API (bukan cuma frontend ini) ikut aman. Lihat SECURITY.md.
// ============================================================
const ALLOWED_TAGS = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'a', 'ul', 'ol', 'li',
    'blockquote', 'h2', 'h3', 'h4', 'code', 'pre', 'span', 'img', 'figure', 'figcaption',
]);
const ALLOWED_ATTRS = {
    a: new Set(['href', 'title']),
    img: new Set(['src', 'alt', 'title', 'width', 'height', 'loading']),
    '*': new Set(['class']),
};
const SAFE_URL_RE = /^(https?:|mailto:|tel:|\/|#)/i;

function sanitizeHtml(html) {
    const doc = new DOMParser().parseFromString(`<div>${String(html ?? '')}</div>`, 'text/html');
    const root = doc.body.firstChild;
    if (!root) return '';

    (function walk(node) {
        // Jalan mundur (childNodes berubah saat elemen dibuang) supaya index tetap aman.
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            const child = node.childNodes[i];

            if (child.nodeType === Node.COMMENT_NODE) { node.removeChild(child); continue; }

            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();

                // script, style, iframe, object, embed, form, on*-handler apa pun,
                // svg/math (vektor serangan lama di banyak sanitizer), dsb — SEMUA
                // dibuang total (termasuk isinya) kalau bukan tag yang diizinkan.
                if (!ALLOWED_TAGS.has(tag)) {
                    node.removeChild(child);
                    continue;
                }

                // Buang SEMUA atribut kecuali yang ada di daftar putih untuk tag ini.
                // Ini otomatis membuang onclick/onerror/onload/style/dst tanpa perlu
                // tahu nama setiap event handler yang ada di spec HTML.
                const allowedForTag = ALLOWED_ATTRS[tag] || new Set();
                Array.from(child.attributes).forEach(attr => {
                    const name = attr.name.toLowerCase();
                    const isAllowed = allowedForTag.has(name) || ALLOWED_ATTRS['*'].has(name);
                    if (!isAllowed) { child.removeAttribute(attr.name); return; }
                    // Untuk href/src, tolak skema berbahaya (javascript:, data:, vbscript:).
                    if ((name === 'href' || name === 'src') && !SAFE_URL_RE.test(attr.value.trim())) {
                        child.removeAttribute(attr.name);
                    }
                });
                if (tag === 'a') child.setAttribute('rel', 'noopener noreferrer nofollow');

                walk(child);
            }
        }
    })(root);

    return root.innerHTML;
}

function fmtTanggal(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch { return iso; }
}

/** Link ke halaman publik lain — pakai href dalam bentuk URL "cantik"
 *  (lihat PRETTY_PUBLIC_ROUTES di engine.js) + onclick SPA nav. */
function profileLink(kode, label) {
    return `<a href="${web.href({page:'profile', user:kode})}" onclick="web.navigate({page:'profile',user:'${kode}'}); return false;">${label}</a>`;
}
function artikelLink(kode, slug, label) {
    return `<a href="${web.href({page:'artikel', user:kode, slug})}" onclick="web.navigate({page:'artikel',user:'${kode}',slug:'${slug}'}); return false;">${label}</a>`;
}

// ============================================================
// HALAMAN BUATAN ADMIN (tabel `halaman` di backend).
// ------------------------------------------------------------
// Beranda dan halaman statis lain memakai renderer yang SAMA — bedanya
// hanya slug mana yang diambil. Beranda dikunci ke slug 'beranda' (lihat
// HOME_SLUG di cms-api/worker.js); halaman lain membaca slug dari URL.
// Dipisah jadi satu fungsi supaya tampilan keduanya tidak pelan-pelan
// menyimpang saat salah satunya disunting.
// ============================================================
const HOME_SLUG = 'beranda';

// ============================================================
// [SECURITY] Seksi halaman (hero / features / articleFull) ditulis admin,
// tapi komponen di engine.js menyisipkan nilainya LANGSUNG ke template
// HTML (`<h1>${d.title}</h1>`) karena aslinya hanya dipakai untuk konten
// statis buatan developer. Jadi SEMUA teks dari backend di-escape di sini
// sebelum diserahkan ke komponen, dan tautannya dibangun ulang dari
// daftar target yang sudah divalidasi backend — bukan dipakai mentah.
// ============================================================

/** Ubah satu baris `articleFull.lines` dari backend jadi HTML yang sudah aman. */
function seksiBaris(line) {
    if (line === '---') return '---';

    const heading = String(line).match(/^(#{2,3})\s+(.*)$/);
    if (heading) return `${heading[1]} ${esc(heading[2])}`;

    const link = String(line).match(/^link:([^:]+):(.+)$/);
    if (link) {
        // Dirakit sendiri jadi <a>, bukan diserahkan ke handler 'link:' di
        // lineRenderer — handler itu menaruh target mentah ke dalam atribut
        // onclick, dan target di sini berasal dari basis data.
        const href = web.href(link[2]);
        return `<a href="${esc(href)}" onclick='web.navigate(${JSON.stringify(link[2])}); return false;' class="inline-link">${esc(link[1])} &raquo;</a>`;
    }
    return esc(line);
}

/** Ubah array `blok` dari backend jadi array section siap-render ui.render(). */
function seksiHalaman(blok) {
    return blok.map(b => {
        if (b.section === 'hero') {
            return {
                section: 'hero',
                title: esc(b.title),
                tagline: esc(b.tagline || ''),
                description: esc(b.description || ''),
                badges: (b.badges || []).map(esc),
                imgClass: b.imgClass ? esc(b.imgClass) : '',
                cta: b.cta ? { text: esc(b.cta.text), link: b.cta.link } : null,
            };
        }
        if (b.section === 'features') {
            return {
                section: 'features',
                items: (b.items || []).map(it => ({
                    icon: esc(it.icon || 'di-icon'),
                    title: esc(it.title),
                    content: esc(it.content || ''),
                    linkText: it.linkText ? esc(it.linkText) : '',
                    linkTarget: it.linkTarget || '',
                })),
            };
        }
        return {
            section: 'articleFull',
            subtitle: esc(b.subtitle || ''),
            lines: (b.lines || []).map(seksiBaris),
        };
    });
}

async function renderHalaman(slug, { isHome = false } = {}) {
    let halaman;
    try { ({ halaman } = await db.publicHalaman(slug)); }
    catch (e) {
        // Beranda tidak boleh berakhir sebagai layar error telanjang:
        // situs mungkin baru dipasang dan halamannya memang belum dibuat.
        if (isHome) {
            return [{
                section: 'titleHero',
                title: 'Piawai',
                description: 'Halaman depan belum disiapkan. Superadmin dapat membuatnya lewat menu <strong>Kelola Halaman</strong> dengan slug <strong>beranda</strong>.',
            }];
        }
        return [{ section: 'titleHero', title: 'Halaman Tidak Ditemukan', description: esc(e.message) }];
    }

    // Tata letak 'seksi' — landing page berblok (hero, fitur, penutup).
    if (halaman.tataLetak === 'seksi' && Array.isArray(halaman.blok) && halaman.blok.length) {
        return seksiHalaman(halaman.blok);
    }

    // Tata letak 'konten' — satu blok HTML, cocok untuk halaman teks panjang.
    const html = `
        <div class="row page">
            <div class="artikel">
                <h1>${esc(halaman.judul)}</h1>
                ${halaman.ringkasan ? `<p><em>${esc(halaman.ringkasan)}</em></p>` : ''}
                ${halaman.coverImage ? `<p><img src="${esc(halaman.coverImage)}" alt="${esc(halaman.judul)}" loading="eager" fetchpriority="high" decoding="async" style="max-width:100%;"></p>` : ''}
                <div class="post-konten">${sanitizeHtml(halaman.konten)}</div>
            </div>
        </div>`;
    return [{ section: 'rawHtml', html }];
}

// ------------------------------------------------------------
// Beranda — landing page yang isinya dikelola admin (slug 'beranda').
// Dulu halaman ini adalah daftar CMS aktif yang di-hardcode di sini;
// daftar itu sekarang pindah ke rute `penulis` di bawah, supaya halaman
// depan sepenuhnya milik admin.
// ------------------------------------------------------------
web.routes.home = 'resolveHome';
async function resolveHome() {
    return renderHalaman(HOME_SLUG, { isHome: true });
}

// ------------------------------------------------------------
// Halaman statis lain — ?laman/<slug>
// ------------------------------------------------------------
web.routes.laman = 'resolveLaman';
async function resolveLaman(slugParam, _slug, params) {
    const slug = (slugParam || params?.slug || web.currentParams.slug || '').toLowerCase();
    if (!slug) return [{ section: 'titleHero', title: 'Halaman Tidak Ditemukan', description: 'Alamat halaman tidak lengkap.' }];
    // '?laman/beranda' dan '/' menunjuk isi yang sama — biarkan keduanya
    // bekerja daripada memaksa redirect; keduanya sah dibagikan.
    return renderHalaman(slug);
}

// ------------------------------------------------------------
// Daftar artikel semua penulis — ?artikel
// ------------------------------------------------------------
web.routes['artikel-list'] = 'resolveArtikelList';
async function resolveArtikelList() {
    let posts = [];
    try { ({ posts } = await db.publicArtikelList()); }
    catch (e) { return [{ section: 'titleHero', title: 'Gagal Memuat', description: esc(e.message) }]; }

    const list = posts.map(p => `
        <div class="col-1-1 artikel" style="margin-bottom:1.2em;">
            <span class="judul">${artikelLink(p.kodeCms, p.slug, esc(p.judul))}</span>
            ${p.kategori ? `<span class="badge">${esc(p.kategori)}</span>` : ''}
            <br><small>${fmtTanggal(p.publishedAt)} &middot; oleh ${profileLink(p.kodeCms, esc(p.penulis))}</small>
            <p>${esc(p.ringkasan || '')}</p>
        </div>`).join('') || '<div class="col-1-1 artikel"><p>Belum ada artikel yang dipublikasikan.</p></div>';

    return [
        { section: 'titleHero', title: 'Artikel', description: 'Tulisan terbaru dari seluruh penulis di situs ini.' },
        { section: 'rawHtml', html: `<div class="row gading">${list}</div>` },
    ];
}

// ------------------------------------------------------------
// Daftar penulis (CMS aktif) — ?penulis
// ------------------------------------------------------------
web.routes.penulis = 'resolvePenulis';
async function resolvePenulis() {
    let daftarCms = [];
    try { ({ cms: daftarCms } = await db.publicHome()); }
    catch (e) { return [{ section: 'titleHero', title: 'Gagal Memuat', description: esc(e.message) }]; }

    const list = daftarCms.map(c => `
        <div class="col-1-3 artikel">
            ${c.avatarUrl ? `<img src="${esc(c.avatarUrl)}" alt="${esc(c.nama)}" width="56" height="56" loading="lazy" decoding="async" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">` : ''}
            <span class="judul">${profileLink(c.kodeCms, esc(c.nama))}</span>
            <p>${esc(c.bio || '')}</p>
        </div>`).join('') || '<div class="col-1-1 artikel"><p>Belum ada penulis aktif.</p></div>';

    return [
        { section: 'titleHero', title: 'Penulis', description: 'Setiap penulis memiliki CMS sendiri — klik namanya untuk membaca tulisannya.' },
        { section: 'rawHtml', html: `<div class="row gading">${list}</div>` },
    ];
}

// ------------------------------------------------------------
// Profil CMS publik — ?profile/<kodeCms>
// ------------------------------------------------------------
web.routes.profile = 'resolveProfile';
async function resolveProfile(kode, _slug, params) {
    kode = (kode || params?.user || web.currentParams.user || '').toLowerCase();
    let cms, posts;
    try { ({ cms, posts } = await db.publicProfile(kode)); }
    catch (e) { return [{ section: 'titleHero', title: 'CMS Tidak Ditemukan', description: esc(e.message) }]; }

    const list = posts.map(p => `
        <div class="col-1-1 artikel" style="margin-bottom:1.2em;">
            <span class="judul">${artikelLink(kode, p.slug, esc(p.judul))}</span>
            ${p.kategori ? `<span class="badge">${esc(p.kategori)}</span>` : ''}
            <br><small>${fmtTanggal(p.publishedAt)}</small>
            <p>${esc(p.ringkasan || '')}</p>
        </div>`).join('') || '<div class="col-1-1 artikel"><p>Belum ada artikel yang dipublikasikan.</p></div>';

    const header = `
        <div class="row page">
            <div class="artikel">
                ${cms.avatarUrl ? `<img src="${esc(cms.avatarUrl)}" alt="${esc(cms.nama)}" width="72" height="72" loading="eager" fetchpriority="high" decoding="async" style="width:72px;height:72px;border-radius:50%;object-fit:cover;">` : ''}
                <h1>${esc(cms.nama)}</h1>
                <p>${esc(cms.bio || '')}</p>
            </div>
        </div>
        <div class="row gading">${list}</div>`;

    return [{ section: 'rawHtml', html: header }];
}

// ------------------------------------------------------------
// Artikel + komentar — ?user/<kodeCms>/<slug>
// ------------------------------------------------------------
web.routes.artikel = 'resolveArtikel';
async function resolveArtikel(_sub, _slug, params, notice) {
    // params dikirim langsung oleh web.navigate(); web.currentParams hanya
    // cadangan untuk pemanggilan manual (mis. render ulang setelah komentar).
    const kode = (params?.user || web.currentParams.user || '').toLowerCase();
    const slug = params?.slug || web.currentParams.slug || '';
    let cms, post, komentar;
    try { ({ cms, post, komentar } = await db.publicArtikel(kode, slug)); }
    catch (e) { return [{ section: 'titleHero', title: 'Artikel Tidak Ditemukan', description: esc(e.message) }]; }

    const tags = (post.tags || '').split(',').map(t => t.trim()).filter(Boolean)
        .map(t => `<span class="badge">${esc(t)}</span>`).join(' ');

    const komentarHtml = komentar.map(k => `
        <div class="info-card">
            <strong>${esc(k.nama)}</strong> <small>&middot; ${fmtTanggal(k.createdAt)}</small>
            <p>${esc(k.isi)}</p>
        </div>`).join('') || '<p>Belum ada komentar. Jadilah yang pertama.</p>';

    const noticeHtml = notice ? `<div class="info-card">${esc(notice)}</div>` : '';

    const html = `
        <div class="row page">
            <div class="artikel">
                <p>${profileLink(kode, '&larr; ' + esc(cms.nama))}</p>
                <h1>${esc(post.judul)}</h1>
                <p><small>${fmtTanggal(post.publishedAt)} ${post.kategori ? '&middot; ' + esc(post.kategori) : ''}</small></p>
                ${tags}
                ${post.coverImage ? `<p><img src="${esc(post.coverImage)}" alt="${esc(post.judul)}" loading="eager" fetchpriority="high" decoding="async" style="max-width:100%;"></p>` : ''}
                <div class="post-konten">${sanitizeHtml(post.konten)}</div>
                <hr>
                <h2 id="komentar">Komentar</h2>
                ${noticeHtml}
                <div id="komentarList">${komentarHtml}</div>
                <h3>Tulis Komentar</h3>
                ${komentarFormOrLoginPrompt(kode, slug)}
            </div>
        </div>`;

    return [{ section: 'rawHtml', html }];
}

// ============================================================
// [SECURITY / FITUR] Komentar WAJIB login.
// ------------------------------------------------------------
// Sebelumnya siapa pun (tanpa akun) bisa mengirim komentar hanya dengan
// mengetik nama bebas — ini memudahkan spam/penyamaran identitas, dan
// tidak ada cara memverifikasi siapa yang benar-benar menulis komentar.
// Sekarang form hanya ditampilkan untuk pengguna yang sudah login;
// identitas (nama) diambil dari sesi, bukan diketik manual, supaya
// komentar selalu bisa ditelusuri ke akun yang mengirimnya.
//
// [KETERBATASAN YANG PERLU DIKETAHUI] `auth` di app ini menyimpan sesi
// hanya di localStorage klien (lihat auth.js) — TIDAK ADA token sesi
// bertanda tangan (mis. JWT) yang dikirim & diverifikasi backend. Jadi
// pengecekan login di bawah ini mencegah pengguna BIASA berkomentar
// tanpa akun lewat antarmuka ini, tapi TIDAK mencegah seseorang yang
// memanggil endpoint backend (`/public?view=komentar`) secara langsung
// dari mengaku sebagai siapa saja. Supaya "wajib login" benar-benar
// ditegakkan di sisi server, backend (cms-api, repo terpisah) perlu
// menerbitkan token sesi asli saat login dan memvalidasinya di endpoint
// komentar — lihat SECURITY.md.
// ============================================================
function komentarFormOrLoginPrompt(kode, slug) {
    const user = (typeof auth !== 'undefined') ? auth.currentUser() : null;
    if (!user) {
        return `<div class="info-card">
            Silakan <a href="javascript:void(0)" onclick="publicPage.goLoginThenReturn('${kode}','${slug}')">masuk</a>
            atau <a href="javascript:void(0)" onclick="web.navigate('register')">daftar</a> terlebih dahulu untuk menulis komentar.
        </div>`;
    }
    return `
        <form class="dynamic-form" onsubmit="event.preventDefault(); publicPage.handleKomentarSubmit(this, '${kode}', '${slug}');">
            <div class="a-row"><label class="a-label">Nama</label><input type="text" value="${esc(user.name)}" disabled></div>
            <div class="a-row"><label class="a-label">Komentar <span style="color:var(--orange,#f90)">*</span></label><textarea name="isi" rows="3" maxlength="2000" required></textarea></div>
            <button type="submit" class="slcBtn">Kirim Komentar</button>
        </form>`;
}

const publicPage = {
    /** Simpan halaman artikel yang sedang dibuka, lalu arahkan ke /login.
     *  Dipanggil balik oleh auth.js setelah login sukses (lihat
     *  sessionStorage 'postLoginRedirect') supaya pengguna tidak perlu
     *  mencari-cari lagi artikel yang tadi ingin dikomentari. */
    goLoginThenReturn(kode, slug) {
        try { sessionStorage.setItem('postLoginRedirect', JSON.stringify({ page: 'artikel', user: kode, slug })); }
        catch (e) { /* localStorage/sessionStorage penuh atau diblokir — abaikan, login tetap jalan tanpa redirect balik */ }
        web.navigate('login');
    },

    /** Submit komentar lewat fetch (bukan <form method="POST"> biasa) —
     *  hosting statis tidak punya server untuk memproses form POST langsung,
     *  jadi ini WAJIB AJAX. Lihat catatan arsitektur di atas berkas ini. */
    async handleKomentarSubmit(form, kode, slug) {
        const user = (typeof auth !== 'undefined') ? auth.currentUser() : null;
        if (!user) { alert('Sesi Anda berakhir, silakan masuk kembali.'); web.navigate('login'); return; }

        const isi = form.querySelector('[name="isi"]')?.value.trim() ?? '';
        if (!isi) return;

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }
        try {
            // nama diambil dari sesi (bukan field form) supaya tidak bisa dipalsukan
            // lewat DevTools/edit-HTML manual sebelum submit.
            await db.publicKomentar(kode, slug, { nama: user.name, userId: user.userId, isi });
        } catch (e) {
            alert(e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Kirim Komentar'; }
            return;
        }
        // Render ulang halaman artikel supaya komentar baru langsung terlihat.
        const params = { page: 'artikel', user: kode, slug };
        web.currentParams = params;
        const pageData = await resolveArtikel(undefined, undefined, params, 'Komentar terkirim, terima kasih!');
        await ui.render('content', pageData);
        location.hash = 'komentar';
    },
};
