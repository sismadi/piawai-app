// ============================================================
// pages/halaman.js — Superadmin: kelola HALAMAN situs (landing page +
// halaman statis lain seperti "Tentang").
// ============================================================
// Halaman di sini BEDA dengan artikel (pages/postingan.js): artikel
// dimiliki masing-masing penulis dan tampil di bawah kode CMS-nya,
// sedangkan halaman adalah wajah situs piawai.id yang sama untuk semua
// pengunjung — karena itu hanya superadmin yang boleh mengelolanya
// (ditegakkan di backend, lihat handleSiteTable di cms-api/worker.js;
// requireLogin di sini hanya supaya menunya tidak terbuka sia-sia).
//
// Form memakai FORM DRAWER yang sama dengan halaman admin lain (lihat
// web.openDrawer di engine.js) — tidak ada rute editor terpisah, supaya
// admin tidak kehilangan konteks daftar saat menyunting satu halaman.
// ============================================================
web.routes.halaman = 'resolveHalaman';

// Slug halaman depan — dikunci di backend (HOME_SLUG di worker.js).
// Diulang di sini hanya untuk menyesuaikan tampilan (menyembunyikan
// tombol Hapus & mengunci field slug); backend tetap penentu akhirnya.
const HOME_SLUG_ADMIN = 'beranda';

// Tujuan tautan bawaan untuk tombol hero & tautan fitur. Harus sejalan
// dengan MENU_ROUTES/safeNavTarget di cms-api/worker.js — kalau tidak,
// pilihan di sini baru ditolak setelah admin menekan Simpan.
const TUJUAN_RUTE = [
    { value: 'home', label: 'Rute: halaman depan' },
    { value: 'artikel-list', label: 'Rute: daftar artikel' },
    { value: 'penulis', label: 'Rute: daftar penulis' },
    { value: 'register', label: 'Rute: daftar akun baru' },
    { value: 'login', label: 'Rute: masuk' },
];

async function resolveHalaman() {
    const guard = requireLogin(['superadmin']);
    if (guard) return guard;

    const daftar = await db.all('halaman');

    const rows = daftar.map(h => ({
        judul: h.judul,
        slug: h.slug === HOME_SLUG_ADMIN ? `${h.slug} (halaman depan)` : h.slug,
        tataLetak: h.tataLetak === 'seksi' ? 'Seksi' : 'Konten',
        status: h.status === 'publish' ? '● Publish' : '○ Draft',
        urutan: h.urutan ?? 0,
        // [SECURITY] id disisipkan ke atribut onclick sebagai literal JS —
        // pakai JSON.stringify, bukan interpolasi manual, supaya tanda kutip
        // dalam nilai tidak bisa memutus keluar dari handler. Pola yang sama
        // dipakai di pages/cms.js.
        aksi: `<a href="javascript:void(0)" onclick='halamanPage.openForm(${JSON.stringify(h.id)})'>Edit</a>`
            + ` &middot; <a href="${h.slug === HOME_SLUG_ADMIN ? '/' : web.href({ page: 'laman', slug: h.slug })}" target="_blank" rel="noopener">Lihat</a>`
            + (h.slug === HOME_SLUG_ADMIN ? '' : ` &middot; <a href="javascript:void(0)" onclick='halamanPage.handleDelete(${JSON.stringify(h.id)},${JSON.stringify(h.judul)})'>Hapus</a>`),
    }));

    return [
        {
            section: 'titleHero',
            title: 'Kelola Halaman',
            description: `${daftar.length} halaman. Halaman berslug <strong>${HOME_SLUG_ADMIN}</strong> adalah landing page yang tampil di alamat utama situs.`,
        },
        {
            section: 'articleFull',
            subtitle: 'Daftar Halaman',
            lines: [
                '<button type="button" class="slcBtn" onclick="halamanPage.openForm()">+ Halaman Baru</button>',
                '---',
                'table:rows',
            ],
            rows,
            tableOpts: {
                visibleKeys: ['judul', 'slug', 'tataLetak', 'status', 'urutan', 'aksi'],
                labels: { judul: 'Judul', slug: 'Slug', tataLetak: 'Tata Letak', status: 'Status', urutan: 'Urutan', aksi: 'Aksi' },
                // [SECURITY] judul & slug diketik admin — tetap di-escape (default
                // renderTable). Hanya 'aksi' yang berisi HTML rakitan sendiri.
                rawKeys: ['aksi'],
            },
            emptyText: 'Belum ada halaman.',
        },
    ];
}

// ============================================================
// Penyusun SEKSI landing page (kolom `halaman.blok` di backend).
// ------------------------------------------------------------
// Blok disimpan sebagai JSON, tapi memaksa admin mengetik JSON di
// textarea adalah cara cepat membuat fitur ini tidak pernah dipakai.
// Jadi form memakai bentuk baris sederhana "a | b | c" dan berkas ini
// yang menerjemahkannya ke/dari JSON. Backend tetap memvalidasi ulang
// hasilnya (lihat normalizeBlok di cms-api/worker.js) — parser di sini
// urusan kenyamanan, bukan lapisan keamanan.
// ============================================================

/** Pecah teks banyak baris jadi array, buang baris kosong. */
function barisTeks(v) {
    return String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
}

/** "a | b | c" -> ['a','b','c'] (bagian yang tidak diisi jadi string kosong). */
function pecahKolom(baris, jumlah) {
    const p = String(baris).split('|').map(x => x.trim());
    return Array.from({ length: jumlah }, (_, i) => p[i] || '');
}

/** Ambil satu seksi bertipe tertentu dari array blok tersimpan. */
function ambilSeksi(blok, section) {
    return (blok || []).find(b => b.section === section) || null;
}

/** Baca kolom `blok` milik satu halaman (string JSON) jadi array objek. */
function bacaBlok(hal) {
    if (!hal?.blok) return [];
    try { return JSON.parse(hal.blok); }
    catch (e) { return []; } // JSON rusak: perlakukan sebagai belum ada seksi
}

/** Rakit array blok dari isian form. Mengembalikan null kalau tidak ada isi. */
function rakitBlok(form) {
    const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
    const blok = [];

    if (val('hero_judul')) {
        const hero = {
            section: 'hero',
            title: val('hero_judul'),
            tagline: val('hero_tagline'),
            description: val('hero_deskripsi'),
            badges: val('hero_badges').split(',').map(x => x.trim()).filter(Boolean),
        };
        if (val('hero_ikon')) hero.imgClass = val('hero_ikon');
        if (val('hero_cta_teks') && val('hero_cta_link')) {
            hero.cta = { text: val('hero_cta_teks'), link: val('hero_cta_link') };
        }
        blok.push(hero);
    }

    const items = barisTeks(form.querySelector('[name="fitur"]')?.value)
        .map(b => {
            const [icon, title, content, linkText, linkTarget] = pecahKolom(b, 5);
            const item = { icon, title, content };
            if (linkTarget) { item.linkTarget = linkTarget; item.linkText = linkText; }
            return item;
        })
        .filter(it => it.title);
    if (items.length) blok.push({ section: 'features', items });

    const lines = barisTeks(form.querySelector('[name="penutup_baris"]')?.value);
    if (val('penutup_judul') || lines.length) {
        blok.push({ section: 'articleFull', subtitle: val('penutup_judul'), lines });
    }

    return blok.length ? blok : null;
}

const halamanPage = {
    /** Buka drawer tambah (tanpa id) atau edit (dengan id). */
    async openForm(id) {
        const hal = id ? await db.find('halaman', h => h.id === id) : null;
        if (id && !hal) { alert('Halaman tidak ditemukan.'); return; }
        const isHome = hal?.slug === HOME_SLUG_ADMIN;

        const blok = bacaBlok(hal);
        const hero = ambilSeksi(blok, 'hero');
        const fitur = ambilSeksi(blok, 'features');
        const penutup = ambilSeksi(blok, 'articleFull');

        // Semua halaman yang ada bisa jadi tujuan tautan, jadi daftarnya
        // dibangun dari data — bukan ditulis ulang tiap kali ada halaman baru.
        const tujuan = [
            ...TUJUAN_RUTE,
            ...(await db.all('halaman')).map(h => ({ value: `laman/${h.slug}`, label: `Halaman: ${h.judul}` })),
        ];

        web.openDrawer({
            title: hal ? `Edit: ${hal.judul}` : 'Halaman Baru',
            fields: [
                { type: 'hidden', name: 'id', value: hal?.id || '' },
                { type: 'text', name: 'judul', label: 'Judul Halaman', value: hal?.judul, required: true, maxlength: 200 },
                ...(isHome
                    // Slug halaman depan tidak dapat diubah (backend menolaknya),
                    // jadi tampilkan sebagai keterangan, bukan field yang bisa
                    // diketik lalu ditolak saat disimpan.
                    ? [{ type: 'raw', html: `<div class="a-row"><label class="a-label">Slug</label><input type="text" value="${HOME_SLUG_ADMIN}" disabled></div>` }]
                    : [{ type: 'text', name: 'slug', label: 'Slug URL', value: hal?.slug, placeholder: 'kosongkan untuk otomatis dari judul' }]),
                { type: 'textarea', name: 'ringkasan', label: 'Ringkasan singkat (opsional)', rows: 2, value: hal?.ringkasan, maxlength: 500 },
                {
                    type: 'select', name: 'tataLetak', label: 'Tata letak halaman', value: hal?.tataLetak || 'konten',
                    options: [
                        { value: 'konten', label: 'Konten — satu blok HTML (halaman teks biasa)' },
                        { value: 'seksi', label: 'Seksi — hero + fitur + penutup (landing page)' },
                    ],
                },
                {
                    type: 'raw',
                    html: `<div class="a-row"><small>Kedua bagian di bawah selalu tampil di form ini, tapi yang
                        <strong>dirender ke pengunjung hanya yang sesuai tata letak terpilih</strong> — isian yang
                        tidak dipakai tetap tersimpan, jadi aman berganti tata letak bolak-balik.</small></div>
                        <hr><h3>A. Isi untuk tata letak "Konten"</h3>`,
                },
                { type: 'textarea', name: 'konten', label: 'Konten (HTML dasar: &lt;p&gt;, &lt;h2&gt;, &lt;strong&gt;, &lt;a&gt;, dst.)', rows: 8, value: hal?.konten },
                { type: 'text', name: 'coverImage', label: 'URL Gambar Sampul (opsional)', value: hal?.coverImage },

                { type: 'raw', html: `<hr><h3>B. Isi untuk tata letak "Seksi"</h3><div class="a-row"><small>Seksi <em>hero</em> adalah spanduk paling atas; kosongkan judulnya kalau tidak ingin memakainya.</small></div>` },
                { type: 'text', name: 'hero_judul', label: 'Hero — judul besar', value: hero?.title || '', maxlength: 120 },
                { type: 'text', name: 'hero_tagline', label: 'Hero — tagline singkat', value: hero?.tagline || '', maxlength: 120 },
                { type: 'textarea', name: 'hero_deskripsi', label: 'Hero — deskripsi', rows: 2, value: hero?.description || '', maxlength: 400 },
                { type: 'text', name: 'hero_badges', label: 'Hero — badge (pisahkan dengan koma, maks 6)', value: (hero?.badges || []).join(', ') },
                { type: 'text', name: 'hero_ikon', label: 'Hero — kelas ikon', value: hero?.imgClass || '', placeholder: 'mis. di-piawai, di-cart, di-edu' },
                { type: 'text', name: 'hero_cta_teks', label: 'Hero — teks tombol', value: hero?.cta?.text || '', maxlength: 60 },
                { type: 'select', name: 'hero_cta_link', label: 'Hero — tujuan tombol', value: hero?.cta?.link || '', options: tujuan },

                {
                    type: 'raw',
                    html: `<div class="a-row"><small><strong>Format tiap baris fitur:</strong>
                        <code>ikon | judul | deskripsi | teks tautan | tujuan tautan</code><br>
                        Tiga kolom terakhir boleh dikosongkan. Tujuan tautan memakai nilai yang sama dengan tombol hero
                        (mis. <code>artikel-list</code>, <code>penulis</code>, <code>laman/tentang</code>).</small></div>`,
                },
                {
                    type: 'textarea', name: 'fitur', label: 'Fitur (satu per baris, maks 12)', rows: 7,
                    value: (fitur?.items || []).map(it => [it.icon || '', it.title || '', it.content || '', it.linkText || '', it.linkTarget || ''].join(' | ').replace(/( \| )+$/, '')).join('\n'),
                    placeholder: 'di-cart | POS Piawai | Kasir untuk usaha kecil | Selengkapnya | laman/pos-piawai',
                },
                { type: 'text', name: 'penutup_judul', label: 'Penutup — judul bagian', value: penutup?.subtitle || '', maxlength: 120 },
                {
                    type: 'textarea', name: 'penutup_baris', label: 'Penutup — isi (satu baris per entri)', rows: 5,
                    value: (penutup?.lines || []).join('\n'),
                    placeholder: 'Teks biasa\nlink:Daftar sekarang:register\n---\nlink:Sudah punya akun? Masuk:login',
                },

                { type: 'raw', html: '<hr>' },
                { type: 'number', name: 'urutan', label: 'Urutan tampil', value: hal?.urutan ?? 0, step: 1 },
                ...(isHome
                    ? [{ type: 'raw', html: `<div class="a-row"><label class="a-label">Status</label><input type="text" value="Publish (halaman depan selalu tayang)" disabled></div>` }]
                    : [{
                        type: 'select', name: 'status', label: 'Status', value: hal?.status || 'draft',
                        options: [{ value: 'draft', label: 'Draft (belum tayang)' }, { value: 'publish', label: 'Publish (tayang publik)' }],
                    }]),
            ],
            submitText: hal ? 'Simpan Perubahan' : 'Simpan Halaman',
            onSubmit: 'event.preventDefault(); halamanPage.handleSubmit(this);',
        });
    },

    async handleSubmit(form) {
        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
        const id = val('id');
        const judul = val('judul');

        const payload = {
            judul,
            ringkasan: val('ringkasan'),
            konten: form.querySelector('[name="konten"]').value, // JANGAN trim: spasi/HTML mungkin sengaja
            coverImage: val('coverImage'),
            urutan: Number(val('urutan')) || 0,
            tataLetak: val('tataLetak') || 'konten',
            blok: rakitBlok(form),
        };
        // Field slug & status absen saat mengedit halaman depan (dikunci di
        // backend) — jangan kirim key-nya sama sekali daripada mengirim
        // string kosong yang akan ditolak sebagai slug tidak sah.
        const slugField = form.querySelector('[name="slug"]');
        if (slugField) payload.slug = slugify(slugField.value.trim() || judul);
        const statusField = form.querySelector('[name="status"]');
        if (statusField) payload.status = statusField.value || 'draft';

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
        try {
            if (id) await db.update('halaman', id, payload);
            else await db.insert('halaman', payload);
        } catch (e) {
            alert(e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Simpan'; }
            return;
        }
        web.closeDrawer();
        alert('Halaman tersimpan.');
        // Menu publik bisa ikut berubah (halaman baru dapat ditunjuk menu,
        // atau judulnya berganti) — bangun ulang bilah navigasi.
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('halaman');
    },

    async handleDelete(id, judul) {
        if (!confirm(`Hapus halaman "${judul}"? Menu yang menunjuk halaman ini ikut terhapus.`)) return;
        try { await db.remove('halaman', id); }
        catch (e) { alert(e.message); return; }
        alert('Halaman dihapus.');
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('halaman');
    },
};
