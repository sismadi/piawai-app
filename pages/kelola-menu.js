// ============================================================
// pages/kelola-menu.js — Superadmin: kelola MENU & SUBMENU navigasi
// publik situs.
// ============================================================
// Rute halaman ini `?menu`, tapi berkasnya dinamai kelola-menu.js supaya
// tidak tertukar dengan renderMenu() di index.html (pembangun bilah
// navigasi) saat dibaca sekilas di daftar berkas.
//
// Submenu dibatasi SATU tingkat — aturan itu ditegakkan backend (lihat
// normalizeMenu di cms-api/worker.js); di sini konsekuensinya hanya
// tampak sebagai daftar induk yang bisa dipilih: menu yang sudah menjadi
// submenu tidak muncul di pilihan "Induk".
// ============================================================
web.routes.menu = 'resolveMenu';

const MENU_TIPE_LABEL = {
    halaman: 'Halaman',
    rute: 'Rute bawaan',
    url: 'Tautan luar',
    induk: 'Induk (hanya wadah submenu)',
};

// Rute bawaan yang boleh dituju — harus sama dengan MENU_ROUTES di
// cms-api/worker.js. Kalau berbeda, admin baru tahu pilihannya ditolak
// setelah menekan Simpan.
const MENU_RUTE_PILIHAN = [
    { value: 'home', label: 'home — halaman depan' },
    { value: 'artikel-list', label: 'artikel-list — daftar artikel semua penulis' },
    { value: 'penulis', label: 'penulis — daftar penulis' },
    { value: 'login', label: 'login — halaman masuk' },
    { value: 'register', label: 'register — halaman daftar' },
];

async function resolveMenu() {
    const guard = requireLogin(['superadmin']);
    if (guard) return guard;

    const semua = await db.all('menu');
    const induk = semua.filter(m => !m.parentId);
    const anakDari = (id) => semua.filter(m => m.parentId === id);

    // Daftar diratakan dengan anak tepat di bawah induknya (bukan diurut
    // ulang secara global), supaya susunan di tabel = susunan yang benar-
    // benar dilihat pengunjung di bilah navigasi.
    const urut = [];
    induk.forEach(m => { urut.push({ m, level: 0 }); anakDari(m.id).forEach(a => urut.push({ m: a, level: 1 })); });

    const rows = urut.map(({ m, level }) => ({
        label: (level ? '— ' : '') + m.label,
        tipe: MENU_TIPE_LABEL[m.tipe] || m.tipe,
        target: m.target || '-',
        urutan: m.urutan ?? 0,
        status: m.status === 'aktif' ? '● Aktif' : '○ Nonaktif',
        aksi: `<a href="javascript:void(0)" onclick='menuPage.openForm(${JSON.stringify(m.id)})'>Edit</a>`
            + ` &middot; <a href="javascript:void(0)" onclick='menuPage.handleDelete(${JSON.stringify(m.id)},${JSON.stringify(m.label)})'>Hapus</a>`,
    }));

    return [
        {
            section: 'titleHero',
            title: 'Kelola Menu',
            description: `${semua.length} entri menu. Submenu didukung satu tingkat: buat satu menu bertipe <strong>Induk</strong>, lalu tunjuk menu lain sebagai anaknya.`,
        },
        {
            section: 'articleFull',
            subtitle: 'Susunan Menu',
            lines: [
                '<button type="button" class="slcBtn" onclick="menuPage.openForm()">+ Menu Baru</button>',
                '---',
                'table:rows',
            ],
            rows,
            tableOpts: {
                visibleKeys: ['label', 'tipe', 'target', 'urutan', 'status', 'aksi'],
                labels: { label: 'Label', tipe: 'Tipe', target: 'Target', urutan: 'Urutan', status: 'Status', aksi: 'Aksi' },
                // [SECURITY] label & target diketik admin — tetap di-escape.
                rawKeys: ['aksi'],
            },
            emptyText: 'Belum ada menu. Tambahkan minimal satu agar pengunjung bisa berpindah halaman.',
        },
    ];
}

const menuPage = {
    async openForm(id) {
        const semua = await db.all('menu');
        const m = id ? semua.find(x => x.id === id) : null;
        if (id && !m) { alert('Menu tidak ditemukan.'); return; }

        // Kandidat induk: menu tingkat atas, bukan dirinya sendiri, dan —
        // kalau menu ini sudah punya anak — pilihan induk ditutup sama
        // sekali (backend menolak menu beranak dijadikan submenu).
        const punyaAnak = !!id && semua.some(x => x.parentId === id);
        const kandidatInduk = punyaAnak ? [] : semua
            .filter(x => !x.parentId && x.id !== id)
            .map(x => ({ value: x.id, label: x.label }));

        const daftarHalaman = (await db.all('halaman'))
            .map(h => `<code>${escHtml(h.slug)}</code>`).join(', ') || '(belum ada halaman)';

        web.openDrawer({
            title: m ? `Edit Menu: ${m.label}` : 'Menu Baru',
            fields: [
                { type: 'hidden', name: 'id', value: m?.id || '' },
                { type: 'text', name: 'label', label: 'Label yang tampil di navigasi', value: m?.label, required: true, maxlength: 60 },
                {
                    type: 'select', name: 'tipe', label: 'Tipe', value: m?.tipe || 'halaman',
                    options: Object.entries(MENU_TIPE_LABEL).map(([value, label]) => ({ value, label })),
                },
                {
                    type: 'raw',
                    html: `<div class="a-row"><small>
                        <strong>Isi Target sesuai tipe:</strong><br>
                        &bull; Halaman &rarr; slug halaman yang sudah dibuat: ${daftarHalaman}<br>
                        &bull; Rute bawaan &rarr; ${MENU_RUTE_PILIHAN.map(r => `<code>${escHtml(r.value)}</code>`).join(', ')}<br>
                        &bull; Tautan luar &rarr; URL lengkap diawali https://<br>
                        &bull; Induk &rarr; kosongkan saja
                    </small></div>`,
                },
                { type: 'text', name: 'target', label: 'Target', value: m?.target || '', maxlength: 300 },
                ...(kandidatInduk.length
                    ? [{ type: 'select', name: 'parentId', label: 'Induk (kosongkan untuk menu tingkat atas)', value: m?.parentId || '', options: kandidatInduk }]
                    : [{ type: 'raw', html: `<div class="a-row"><label class="a-label">Induk</label><input type="text" value="${punyaAnak ? 'Menu ini sudah memiliki submenu' : 'Belum ada menu tingkat atas lain'}" disabled></div>` }]),
                { type: 'number', name: 'urutan', label: 'Urutan tampil (kecil = lebih kiri/atas)', value: m?.urutan ?? 0, step: 1 },
                {
                    type: 'select', name: 'status', label: 'Status', value: m?.status || 'aktif',
                    options: [{ value: 'aktif', label: 'Aktif (tampil di navigasi)' }, { value: 'nonaktif', label: 'Nonaktif (disembunyikan)' }],
                },
            ],
            submitText: m ? 'Simpan Perubahan' : 'Simpan Menu',
            onSubmit: 'event.preventDefault(); menuPage.handleSubmit(this);',
        });
    },

    async handleSubmit(form) {
        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
        const id = val('id');

        const payload = {
            label: val('label'),
            tipe: val('tipe') || 'halaman',
            target: val('target'),
            urutan: Number(val('urutan')) || 0,
            status: val('status') || 'aktif',
            // Select induk absen saat tidak ada kandidat — kirim string kosong
            // (= tingkat atas), yang di backend diterjemahkan jadi parentId NULL.
            parentId: form.querySelector('[name="parentId"]')?.value || '',
        };

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
        try {
            if (id) await db.update('menu', id, payload);
            else await db.insert('menu', payload);
        } catch (e) {
            alert(e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Simpan'; }
            return;
        }
        web.closeDrawer();
        alert('Menu tersimpan.');
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('menu');
    },

    async handleDelete(id, label) {
        if (!confirm(`Hapus menu "${label}"? Submenu di bawahnya ikut terhapus.`)) return;
        try { await db.remove('menu', id); }
        catch (e) { alert(e.message); return; }
        alert('Menu dihapus.');
        if (typeof renderMenu === 'function') renderMenu();
        web.navigate('menu');
    },
};
