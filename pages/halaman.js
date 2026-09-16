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
// Blok disimpan sebagai JSON, dan form MENGETIK JSON itu langsung
// (tab "B. Seksi") — bukan lagi dirakit dari input per-field seperti
// versi sebelumnya. Ini lebih fleksibel (semua field tiap seksi bisa
// diisi, bukan cuma yang disediakan formnya) dengan risiko: admin bisa
// salah ketik JSON. Backend TETAP memvalidasi ulang bentuknya (lihat
// normalizeBlok di cms-api/worker.js) — parser di sini cuma urusan
// mengetahui "ini JSON sah atau tidak", bukan lapisan keamanan.
// ============================================================

/** Baca kolom `blok` milik satu halaman (string JSON) jadi array objek —
 *  dipakai untuk mengisi textarea JSON saat form dibuka (pretty-printed). */
function bacaBlok(hal) {
    if (!hal?.blok) return [];
    try { return JSON.parse(hal.blok); }
    catch (e) { return []; } // JSON rusak: perlakukan sebagai belum ada seksi
}

/** Baca & validasi (sintaks JSON saja, bukan isi) textarea seksi dari form.
 *  Melempar Error dengan pesan yang bisa langsung ditunjukkan ke admin
 *  kalau teksnya bukan array JSON yang sah. Mengembalikan null kalau
 *  textarea dikosongkan (halaman tanpa seksi). */
function bacaSeksiForm(form) {
    const raw = form.querySelector('[name="seksiJson"]')?.value.trim() ?? '';
    if (!raw) return null;
    let arr;
    try { arr = JSON.parse(raw); }
    catch (e) { throw new Error('JSON pada tab "Seksi" tidak sah: ' + e.message); }
    if (!Array.isArray(arr)) throw new Error('JSON pada tab "Seksi" harus berupa daftar/array (diawali "[" dan diakhiri "]").');
    return arr;
}

// Contoh isian tab "Seksi" — ditampilkan sebagai placeholder textarea supaya
// admin tidak mulai dari layar kosong. Hanya memuat seksi yang benar-benar
// didukung backend (SECTION_TIPE di cms-api/worker.js): hero, features,
// articleFull — lihat normalizeBlok untuk field apa saja yang diterima tiap seksi.
const CONTOH_SEKSI_JSON = JSON.stringify([
    {
        section: 'hero',
        title: 'Judul Besar Halaman',
        tagline: 'Tagline singkat di bawah judul',
        description: 'Deskripsi lebih panjang, satu-dua kalimat.',
        badges: ['Badge Satu', 'Badge Dua'],
        imgClass: 'di-piawai',
        cta: { text: 'Teks Tombol', link: 'register' },
    },
    {
        section: 'features',
        items: [
            { icon: 'di-cart', title: 'Judul Fitur', content: 'Deskripsi fitur.', linkText: 'Selengkapnya', linkTarget: 'artikel-list' },
        ],
    },
    {
        section: 'articleFull',
        subtitle: 'Judul Bagian Penutup',
        lines: ['Baris teks biasa.', 'link:Daftar sekarang:register', '---', 'link:Sudah punya akun? Masuk:login'],
    },
], null, 2);

const halamanPage = {
    /** Buka drawer tambah (tanpa id) atau edit (dengan id). */
    async openForm(id) {
        const hal = id ? await db.find('halaman', h => h.id === id) : null;
        if (id && !hal) { alert('Halaman tidak ditemukan.'); return; }
        const isHome = hal?.slug === HOME_SLUG_ADMIN;

        const blok = bacaBlok(hal);

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
                    html: `<div class="a-row"><small>Kedua tab di bawah selalu tersimpan bersamaan, tapi yang
                        <strong>dirender ke pengunjung hanya yang sesuai tata letak terpilih</strong> di atas — isian
                        di tab yang tidak dipakai tetap tersimpan, jadi aman berpindah tata letak bolak-balik.</small></div>
                        <div class="tab-bar">
                            <div class="a-tab active" onclick="web.switchFormTab(this,'konten')">A. Konten</div>
                            <div class="a-tab" onclick="web.switchFormTab(this,'seksi')">B. Seksi (JSON)</div>
                        </div>
                        <div class="tab-content" data-tab="konten">`,
                },
                { type: 'textarea', name: 'konten', label: 'Konten (HTML dasar: &lt;p&gt;, &lt;h2&gt;, &lt;strong&gt;, &lt;a&gt;, dst.)', rows: 8, value: hal?.konten },
                { type: 'text', name: 'coverImage', label: 'URL Gambar Sampul (opsional)', value: hal?.coverImage },
                { type: 'raw', html: '</div>' }, // tutup tab "konten"

                {
                    type: 'raw',
                    html: `<div class="tab-content" data-tab="seksi" style="display:none">
                        <div class="a-row"><small>Susun seksi landing page sebagai <strong>array JSON</strong>.
                        Seksi yang dikenal backend: <code>hero</code>, <code>features</code>, <code>articleFull</code>
                        — seksi/field lain akan ditolak saat disimpan. Tujuan tautan (<code>cta.link</code> /
                        <code>linkTarget</code> / baris <code>link:...</code>) yang sah:
                        ${tujuan.map(t => `<code>${escHtml(t.value)}</code>`).join(', ')}.</small></div>`,
                },
                {
                    type: 'textarea', name: 'seksiJson', label: 'Seksi (array JSON)', rows: 18,
                    value: blok.length ? JSON.stringify(blok, null, 2) : '',
                    placeholder: CONTOH_SEKSI_JSON,
                },
                { type: 'raw', html: '</div>' }, // tutup tab "seksi"

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

        // Divalidasi sintaksnya di sini supaya kesalahan ketik JSON ketahuan
        // sebelum request dikirim — tapi bentuk ISINYA (nama seksi, field
        // wajib, dst.) tetap ditentukan backend (normalizeBlok di worker.js).
        let blok;
        try { blok = bacaSeksiForm(form); }
        catch (e) { alert(e.message); return; }

        const payload = {
            judul,
            ringkasan: val('ringkasan'),
            konten: form.querySelector('[name="konten"]').value, // JANGAN trim: spasi/HTML mungkin sengaja
            coverImage: val('coverImage'),
            urutan: Number(val('urutan')) || 0,
            tataLetak: val('tataLetak') || 'konten',
            blok,
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
