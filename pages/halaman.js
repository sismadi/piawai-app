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

async function resolveHalaman() {
    const guard = requireLogin(['superadmin']);
    if (guard) return guard;

    const daftar = await db.all('halaman');

    const rows = daftar.map(h => ({
        judul: h.judul,
        slug: h.slug === HOME_SLUG_ADMIN ? `${h.slug} (halaman depan)` : h.slug,
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
                visibleKeys: ['judul', 'slug', 'status', 'urutan', 'aksi'],
                labels: { judul: 'Judul', slug: 'Slug', status: 'Status', urutan: 'Urutan', aksi: 'Aksi' },
                // [SECURITY] judul & slug diketik admin — tetap di-escape (default
                // renderTable). Hanya 'aksi' yang berisi HTML rakitan sendiri.
                rawKeys: ['aksi'],
            },
            emptyText: 'Belum ada halaman.',
        },
    ];
}

const halamanPage = {
    /** Buka drawer tambah (tanpa id) atau edit (dengan id). */
    async openForm(id) {
        const hal = id ? await db.find('halaman', h => h.id === id) : null;
        if (id && !hal) { alert('Halaman tidak ditemukan.'); return; }
        const isHome = hal?.slug === HOME_SLUG_ADMIN;

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
                { type: 'textarea', name: 'konten', label: 'Konten (HTML dasar: &lt;p&gt;, &lt;h2&gt;, &lt;strong&gt;, &lt;a&gt;, dst.)', rows: 12, value: hal?.konten, required: true },
                { type: 'text', name: 'coverImage', label: 'URL Gambar Sampul (opsional)', value: hal?.coverImage },
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
