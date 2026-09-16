// ============================================================
// pages/postingan.js — Daftar & kelola artikel milik CMS yang login.
// ============================================================
web.routes.postingan = 'resolvePostingan';

async function resolvePostingan() {
    const guard = requireLogin(['owner', 'penulis']);
    if (guard) return guard;

    const user = auth.currentUser();
    const posts = (await db.query('post', () => true))
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const rows = posts.map(p => ({
        judul: p.judul,
        status: p.status === 'publish' ? '● Publish' : '○ Draft',
        views: p.views || 0,
        diperbarui: p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('id-ID') : '-',
        aksi: `<a href="javascript:void(0)" onclick='web.navigate("editor/" + ${JSON.stringify(p.id)})'>Edit</a>`
            + (p.status === 'publish' ? ` &middot; <a href="${web.href(`artikel/${user.cmsKode}/${p.slug}`)}" target="_blank" rel="noopener">Lihat</a>` : ''),
    }));

    return [
        {
            section: 'titleHero',
            title: 'Artikel Saya',
            description: `CMS Anda: <a href="${web.href(`profile/${user.cmsKode}`)}" target="_blank" rel="noopener">Lihat CMS publik (${user.cmsKode})</a>`,
        },
        {
            section: 'articleFull',
            subtitle: `${posts.length} Artikel`,
            lines: [
                'link:+ Tulis Artikel Baru:editor',
                '---',
                'table:rows',
            ],
            rows,
            tableOpts: {
                visibleKeys: ['judul', 'status', 'views', 'diperbarui', 'aksi'],
                labels: { judul: 'Judul', status: 'Status', views: 'Dilihat', diperbarui: 'Diperbarui', aksi: 'Aksi' },
                // [SECURITY] judul artikel adalah input bebas pengguna — harus di-escape
                // (default renderTable). Hanya 'aksi' yang raw HTML.
                rawKeys: ['aksi'],
            },
            emptyText: 'Belum ada artikel. Mulai menulis yang pertama!',
        },
    ];
}
