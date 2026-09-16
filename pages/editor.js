// ============================================================
// pages/editor.js — Form tulis/edit artikel.
// Rute: /editor (artikel baru) atau /editor/:id (edit artikel :id).
// ============================================================
web.routes.editor = 'resolveEditor';

async function resolveEditor(postId) {
    const guard = requireLogin(['owner', 'penulis']);
    if (guard) return guard;

    const user = auth.currentUser();
    let post = null;
    if (postId) {
        post = await db.find('post', p => p.id === postId);
        if (!post) {
            return [{ section: 'titleHero', title: 'Artikel Tidak Ditemukan',
                       description: `Artikel dengan id <strong>${postId}</strong> tidak ditemukan di CMS Anda.` }];
        }
    }

    const isEdit = !!post;
    const previewUrl = post && post.status === 'publish' ? web.href(`artikel/${user.cmsKode}/${post.slug}`) : null;

    return [
        {
            section: 'titleHero',
            title: isEdit ? 'Edit Artikel' : 'Tulis Artikel Baru',
            description: previewUrl ? `Sudah tayang di <a href="${previewUrl}" target="_blank" rel="noopener">${previewUrl}</a>` : 'Artikel akan tersimpan sebagai draft sampai Anda memilih status "Publish".',
        },
        {
            section: 'articleFull',
            subtitle: 'Form Artikel',
            fields: [
                { type: 'hidden', name: 'postId', value: post?.id || '' },
                { type: 'text', name: 'judul', label: 'Judul', value: post?.judul, required: true },
                { type: 'text', name: 'slug', label: 'Slug URL', value: post?.slug, placeholder: 'kosongkan untuk otomatis dari judul' },
                { type: 'textarea', name: 'ringkasan', label: 'Ringkasan (untuk daftar artikel & meta deskripsi)', rows: 2, value: post?.ringkasan },
                { type: 'textarea', name: 'konten', label: 'Konten (HTML dasar: <p>, <strong>, <a>, dst.)', rows: 10, value: post?.konten, required: true },
                { type: 'text', name: 'coverImage', label: 'URL Gambar Sampul (opsional)', value: post?.coverImage },
                { type: 'text', name: 'kategori', label: 'Kategori', value: post?.kategori },
                { type: 'text', name: 'tags', label: 'Tags (pisahkan dengan koma)', value: post?.tags },
                {
                    type: 'select', name: 'status', label: 'Status', value: post?.status || 'draft',
                    options: [{ value: 'draft', label: 'Draft (belum tayang)' }, { value: 'publish', label: 'Publish (tayang publik)' }],
                },
            ],
            submitText: isEdit ? 'Simpan Perubahan' : 'Simpan Artikel',
            onSubmit: 'event.preventDefault(); editorPage.handleSubmit(this);',
            lines: [
                'form:',
                '---',
                'link:&larr; Kembali ke Daftar Artikel:postingan',
                ...(isEdit ? [`<button type="button" class="slcBtn" style="background:#c0392b;" onclick="editorPage.handleDelete('${post.id}')">Hapus Artikel Ini</button>`] : []),
            ],
        },
    ];
}

const editorPage = {
    async handleSubmit(form) {
        const val = (name) => form.querySelector(`[name="${name}"]`)?.value.trim() ?? '';
        const postId = val('postId');
        const judul = val('judul');
        let slug = val('slug') || slugify(judul);
        slug = slugify(slug); // pastikan tetap url-safe walau diisi manual

        const payload = {
            judul,
            slug,
            ringkasan: val('ringkasan'),
            konten: form.querySelector('[name="konten"]').value, // JANGAN trim: spasi/HTML mungkin sengaja
            coverImage: val('coverImage'),
            kategori: val('kategori'),
            tags: val('tags'),
            status: val('status') || 'draft',
            updatedAt: new Date().toISOString(),
        };
        if (payload.status === 'publish') payload.publishedAt = payload.publishedAt || new Date().toISOString();

        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

        try {
            if (postId) {
                await db.update('post', postId, payload);
            } else {
                payload.createdAt = new Date().toISOString();
                payload.views = 0;
                const created = await db.insert('post', payload);
                web.navigate(`editor/${created.id}`);
                if (btn) { btn.disabled = false; btn.textContent = 'Simpan Perubahan'; }
                alert('Artikel tersimpan.');
                return;
            }
        } catch (e) {
            alert(e.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Simpan'; }
            return;
        }

        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Perubahan'; }
        alert('Perubahan tersimpan.');
        web.navigate(`editor/${postId}`);
    },

    async handleDelete(postId) {
        if (!confirm('Hapus artikel ini? Tindakan ini tidak dapat dibatalkan.')) return;
        await db.remove('post', postId);
        alert('Artikel dihapus.');
        web.navigate('postingan');
    },
};
