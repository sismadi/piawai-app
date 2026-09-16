// ============================================================
// pages/cms.js — Superadmin: kelola daftar CMS (aktifkan/nonaktifkan).
// Sama seperti pola versi POS, tapi terminologi "toko" -> "CMS".
// ============================================================
web.routes.cms = 'resolveCms';

async function resolveCms() {
    const guard = requireLogin(['superadmin']);
    if (guard) return guard;

    const daftarCms = (await db.allCms()).filter(c => c.id !== 'system');

    const rows = daftarCms.map(c => ({
        nama: c.nama,
        kodeCms: c.kodeCms,
        status: c.status === 'aktif' ? '● Aktif' : '○ Nonaktif',
        dibuat: c.createdAt ? new Date(c.createdAt).toLocaleDateString('id-ID') : '-',
        // [SECURITY] c.id/c.status disisipkan ke atribut onclick sebagai literal JS
        // (bukan HTML biasa) — pakai JSON.stringify, bukan interpolasi string manual,
        // supaya tanda kutip/backslash di nilainya tidak bisa memutus keluar dari handler.
        aksi: `<a href="${web.href(`profile/${c.kodeCms}`)}" target="_blank" rel="noopener">Lihat</a>`
            + ` &middot; <a href="javascript:void(0)" onclick='cmsPage.toggleStatus(${JSON.stringify(c.id)},${JSON.stringify(c.status)})'>${c.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'}</a>`,
    }));

    return [
        { section: 'titleHero', title: 'Kelola CMS', description: `${daftarCms.length} CMS terdaftar.` },
        {
            section: 'articleFull',
            subtitle: 'Daftar CMS',
            lines: ['table:rows'],
            rows,
            tableOpts: {
                visibleKeys: ['nama', 'kodeCms', 'status', 'dibuat', 'aksi'],
                labels: { nama: 'Nama', kodeCms: 'Kode/URL', status: 'Status', dibuat: 'Dibuat', aksi: 'Aksi' },
                // [SECURITY] Hanya 'aksi' yang boleh raw HTML (tombol Lihat/Aktifkan).
                // nama & kodeCms diisi bebas oleh pemilik CMS saat registrasi —
                // WAJIB di-escape (default renderTable) supaya tidak jadi stored XSS
                // yang jalan di sesi superadmin. Lihat catatan di engine.js.
                rawKeys: ['aksi'],
            },
            emptyText: 'Belum ada CMS terdaftar.',
        },
    ];
}

const cmsPage = {
    async toggleStatus(cmsId, currentStatus) {
        const next = currentStatus === 'aktif' ? 'nonaktif' : 'aktif';
        if (!confirm(`Ubah status CMS ini menjadi "${next}"?`)) return;
        await db.updateCms(cmsId, { status: next });
        web.navigate('cms');
    },
};
