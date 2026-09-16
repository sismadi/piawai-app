// ============================================================
// pages/profil.js — Edit profil CMS milik akun yang sedang login (nama
// tampilan, bio, avatar). Halaman ADMIN (butuh login) — beda dengan
// rute publik ?profile/<kodeCms> di pages/public.js (itu yang tampil
// ke pengunjung; ini formulir editnya, khusus pemilik).
// Catatan: kodeCms (slug URL) SENGAJA tidak bisa diubah dari sini —
// mengubahnya akan merusak tautan yang sudah dibagikan/terindex.
// ============================================================
web.routes.profil = 'resolveProfil';

async function resolveProfil() {
    const guard = requireLogin(['owner']);
    if (guard) return guard;

    const user = auth.currentUser();
    const daftarCms = await db.allCms();
    const cms = daftarCms.find(c => c.id === user.cmsId);
    if (!cms) return [{ section: 'titleHero', title: 'Data CMS Tidak Ditemukan' }];

    return [
        {
            section: 'titleHero',
            title: 'Profil CMS',
            description: `Alamat CMS: <a href="${web.href(`profile/${cms.kodeCms}`)}" target="_blank" rel="noopener">Lihat CMS publik (${cms.kodeCms})</a> (kode CMS tidak dapat diubah).`,
        },
        {
            section: 'articleFull',
            subtitle: 'Edit Profil',
            fields: [
                { type: 'text', name: 'nama', label: 'Nama Tampilan', value: cms.nama, required: true },
                { type: 'textarea', name: 'bio', label: 'Bio Singkat', rows: 3, value: cms.bio },
                { type: 'text', name: 'avatarUrl', label: 'URL Foto Profil (opsional)', value: cms.avatarUrl },
            ],
            submitText: 'Simpan Profil',
            onSubmit: 'event.preventDefault(); profilPage.handleSubmit(this);',
            lines: ['form:'],
        },
    ];
}

const profilPage = {
    async handleSubmit(form) {
        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
        const user = auth.currentUser();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }
        try {
            await db.updateCms(user.cmsId, {
                nama: val('nama'), bio: val('bio'), avatarUrl: val('avatarUrl') || null,
            });
            // Sinkronkan nama tampilan di sesi lokal supaya menu langsung terlihat update.
            const session = auth.currentUser();
            session.cmsNama = val('nama');
            localStorage.setItem(auth.SESSION_KEY, JSON.stringify(session));
        } catch (e) {
            alert(e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Simpan Profil'; }
            return;
        }
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Profil'; }
        if (typeof renderMenu === 'function') renderMenu();
        alert('Profil CMS tersimpan.');
        web.navigate('profil');
    },
};
