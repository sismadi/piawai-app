// ============================================================
// pages/dashboard.js — Ringkasan artikel (statGrid, lihat engine.js).
// Superadmin diarahkan ke halaman Kelola CMS, bukan dashboard
// penulis (karena superadmin tidak punya artikel sendiri).
// ============================================================
web.routes.dashboard = 'resolveDashboard';

async function resolveDashboard() {
    const guard = requireLogin(['owner', 'penulis', 'superadmin']);
    if (guard) return guard;

    const user = auth.currentUser();
    if (user.role === 'superadmin') return resolveCms();

    const posts = await db.query('post', () => true);
    const published = posts.filter(p => p.status === 'publish');
    const drafts = posts.filter(p => p.status === 'draft');
    const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);

    const teratas = [...published]
        .sort((a, b) => (b.views || 0) - (a.views || 0))
        .slice(0, 5)
        .map(p => ({ label: p.judul, value: p.views || 0 }));

    const terbaru = [...posts]
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, 5)
        .map(p => `link:${p.judul} (${p.status === 'publish' ? 'publish' : 'draft'}):editor/${p.id}`);

    return [
        { section: 'titleHero', title: 'Dashboard', description: `Selamat datang kembali, <strong>${user.name}</strong> &mdash; ${user.cmsNama}.` },
        {
            section: 'statGrid',
            stats: [
                { value: posts.length, label: 'Total Artikel' },
                { value: published.length, label: 'Publish' },
                { value: drafts.length, label: 'Draft' },
                { value: totalViews, label: 'Total Dilihat' },
            ],
        },
        { section: 'barChart', title: 'Artikel Paling Banyak Dilihat', items: teratas },
        {
            section: 'article',
            leftCol: {
                subtitle: 'Aksi Cepat',
                lines: [
                    'link:+ Tulis Artikel Baru:editor',
                    '---',
                    'link:Kelola Semua Artikel:postingan',
                    '---',
                    'link:Edit Profil CMS:profil',
                ],
            },
            rightCol: {
                subtitle: 'Terbaru Diperbarui',
                lines: terbaru.length ? terbaru : ['Belum ada artikel. Mulai menulis yang pertama!'],
            },
        },
    ];
}
