// Kullanıcı ve ürün verileri innerHTML'e yazılmadan önce kaçırılır.
window.feyzayEsc = function (value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
};
window.feyzayKimlik = (async () => {
    try {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (!data.user) {
            localStorage.removeItem('feyzay_user');
            return null;
        }
        localStorage.setItem('feyzay_user', JSON.stringify({
            firstName: data.user.firstName,
            lastName: data.user.lastName,
            email: data.user.email
        }));
        return data.user;
    } catch (e) {
        return JSON.parse(localStorage.getItem('feyzay_user'));
    }
})();


window.feyzayOturumKontrol = function (yanit) {
    if (yanit && yanit.status === 401) {
        localStorage.removeItem('feyzay_user');
        window.location.reload();
        return true;
    }
    return false;
};

window.showToast = function (message, type = 'success') {
    const eski = document.querySelectorAll('.feyzay-toast');
    eski.forEach(t => t.remove());
    if (window._feyzayToastTimer) clearTimeout(window._feyzayToastTimer);
    if (window._feyzayToastRemoveTimer) clearTimeout(window._feyzayToastRemoveTimer);

    const toast = document.createElement('div');
    toast.className = `feyzay-toast ${type}`;
    toast.style.cssText = `position:fixed; top:80px; left:-300px; max-width:calc(100% - 40px); padding:15px 25px; border-radius:4px; z-index:9999; transition:left 0.4s ease; font-weight:bold; color:#fff; background:${type === 'success' ? '#2ecc71' : '#e74c3c'}`;
    toast.innerText = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.style.left = '50px');
    window._feyzayToastTimer = setTimeout(() => {
        toast.style.left = '-300px';
        window._feyzayToastRemoveTimer = setTimeout(() => toast.remove(), 500);
    }, 2500);
};

window.openLightbox = function (imgSrc) {
    const overlay = document.createElement('div');
    overlay.className = 'feyzay-lightbox-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; z-index:10000; cursor:zoom-out;';
    overlay.innerHTML = `<img src="${imgSrc}" style="max-width:90%; max-height:90%; border-radius:6px; box-shadow:0 10px 25px rgba(0,0,0,0.5);">`;
    document.body.appendChild(overlay);
    overlay.onclick = () => overlay.remove();
};

window.openProductDetailModal = function (urun) {
    window.location.href = `detay.html?id=${urun.id}`;
};

// ============ ÇEREZ (COOKIE) BİLDİRİMİ ============
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const CONSENT_KEY = 'feyzay_cerez_onayi';
        const mevcutOnay = localStorage.getItem(CONSENT_KEY);
        if (mevcutOnay) return; // Daha önce karar verilmiş

        const banner = document.createElement('div');
        banner.className = 'feyzay-cookie-banner';
        banner.innerHTML = `
            <p>Sitemizde deneyiminizi iyileştirmek için zorunlu çerezler ile, izninize bağlı olarak analiz/pazarlama çerezleri kullanıyoruz. Detaylar için <a href="gizlilik-politikasi.html" target="_blank" rel="noopener">Gizlilik ve Çerez Politikası</a>'nı inceleyebilirsiniz.</p>
            <div class="feyzay-cookie-actions">
                <button class="feyzay-cookie-accept" id="feyzay-cookie-accept">Tümünü Kabul Et</button>
                <button class="feyzay-cookie-reject" id="feyzay-cookie-reject">Yalnızca Zorunlu Çerezler</button>
            </div>
        `;
        document.body.appendChild(banner);
        requestAnimationFrame(() => banner.classList.add('aktif'));

        const kapat = (karar) => {
            localStorage.setItem(CONSENT_KEY, karar);
            banner.classList.remove('aktif');
            setTimeout(() => banner.remove(), 500);
        };

        document.getElementById('feyzay-cookie-accept').onclick = () => kapat('tumu');
        document.getElementById('feyzay-cookie-reject').onclick = () => kapat('zorunlu');
    });
})();

window.askForAddress = async function (isGuest) {
    let saved = { city: '', district: '', street: '', zipcode: '' };
    if (!isGuest) {
        try {
            const res = await fetch('/api/user/get-address', { method: 'POST' });
            const data = await res.json();
            if (data.success && data.address) saved = data.address;
        } catch (e) { }
    }

    let parsedStreet = { mahalle: '', cadde: '', binaNo: '' };
    if (saved.street) {
        try {
            const obj = JSON.parse(saved.street);
            if (obj.mahalle) parsedStreet = obj;
        } catch (e) {
            parsedStreet.cadde = saved.street;
        }
    }

    return new Promise((resolve) => {
        let overlay = document.querySelector('.feyzay-modal-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.className = 'feyzay-modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s ease;';

        let guestHtml = isGuest ? `
            <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
                <h4 style="margin-top: 0; margin-bottom: 10px; color: #555;">Kişisel Bilgileriniz</h4>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <input type="text" id="feyzay-guest-firstname" placeholder="İsim" style="flex:1; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
                    <input type="text" id="feyzay-guest-lastname" placeholder="Soyisim" style="flex:1; padding: 10px; border: 1px solid #ccc; border-radius: 4px;">
                </div>
                <input type="email" id="feyzay-guest-email" placeholder="E-posta Adresiniz" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
            </div>
        ` : '';

        overlay.innerHTML = `
            <div class="feyzay-modal" style="background:#fff; padding:25px; border-radius:8px; width:90%; max-width:450px; box-shadow:0 10px 25px rgba(0,0,0,0.2); transform:translateY(-20px); transition:transform 0.3s ease;">
                <h3 style="margin-top:0;">Sipariş ve Teslimat Adresi</h3>
                <p style="font-size:14px; color:#666; margin-bottom:20px;">Lütfen ürünün teslim edileceği adres bilgilerini girin.</p>
                ${guestHtml}
                <h4 style="margin-top: 0; margin-bottom: 10px; color: #555;">Adres Bilgileriniz</h4>
                <div style="margin-bottom: 12px;"><label style="display: block; font-size: 12px; margin-bottom: 4px; color: #777;">Mahalle</label><input type="text" id="feyzay-mahalle" value="${feyzayEsc(parsedStreet.mahalle)}" placeholder="Örn: Atatürk Mah." style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></div>
                <div style="margin-bottom: 12px;"><label style="display: block; font-size: 12px; margin-bottom: 4px; color: #777;">Cadde / Sokak</label><input type="text" id="feyzay-cadde" value="${feyzayEsc(parsedStreet.cadde)}" placeholder="Örn: Vatan Caddesi" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></div>
                <div style="margin-bottom: 12px;"><label style="display: block; font-size: 12px; margin-bottom: 4px; color: #777;">Bina / Daire No</label><input type="text" id="feyzay-binano" value="${feyzayEsc(parsedStreet.binaNo)}" placeholder="Örn: No:12 D:4" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></div>
                <div style="display: flex; gap: 10px; margin-bottom: 12px;">
                    <div style="flex: 2;"><label style="display: block; font-size: 12px; margin-bottom: 4px; color: #777;">Şehir / İl</label><input type="text" id="feyzay-city" value="${feyzayEsc(saved.city)}" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></div>
                    <div style="flex: 2;"><label style="display: block; font-size: 12px; margin-bottom: 4px; color: #777;">İlçe</label><input type="text" id="feyzay-district" value="${feyzayEsc(saved.district)}" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></div>
                </div>
                <div style="margin-bottom: 20px;"><label style="display: block; font-size: 12px; margin-bottom: 4px; color: #777;">Posta Kodu</label><input type="number" id="feyzay-zipcode" value="${feyzayEsc(saved.zipcode)}" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;"></div>

                <div style="margin-bottom: 16px; padding-top: 12px; border-top: 1px solid #eee;">
                    <div class="feyzay-consent">
                        <input type="checkbox" id="feyzay-on-bilgi-onay">
                        <label for="feyzay-on-bilgi-onay"><a href="on-bilgilendirme-formu.html" target="_blank" rel="noopener">Ön Bilgilendirme Formu</a>'nu okudum ve onaylıyorum.</label>
                    </div>
                    <div class="feyzay-consent">
                        <input type="checkbox" id="feyzay-mesafeli-onay">
                        <label for="feyzay-mesafeli-onay"><a href="mesafeli-satis-sozlesmesi.html" target="_blank" rel="noopener">Mesafeli Satış Sözleşmesi</a>'ni okudum, kabul ediyorum.</label>
                    </div>
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button id="feyzay-btn-cancel" style="padding: 10px 15px; border: none; background: #eee; color: #333; border-radius: 4px; cursor: pointer; font-weight: bold;">İptal</button>
                    <button id="feyzay-btn-confirm" style="padding: 10px 15px; border: none; background: #111; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold;">Ödemeyi Tamamla</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
            overlay.querySelector('.feyzay-modal').style.transform = 'translateY(0)';
        });

        const close = (data) => {
            overlay.style.opacity = '0';
            overlay.querySelector('.feyzay-modal').style.transform = 'translateY(-20px)';
            setTimeout(() => overlay.remove(), 300);
            resolve(data);
        };

        document.getElementById('feyzay-btn-cancel').onclick = () => close(null);
        document.getElementById('feyzay-btn-confirm').onclick = () => {
            const mahalle = document.getElementById('feyzay-mahalle').value.trim();
            const cadde = document.getElementById('feyzay-cadde').value.trim();
            const binaNo = document.getElementById('feyzay-binano').value.trim();
            const city = document.getElementById('feyzay-city').value.trim();
            const district = document.getElementById('feyzay-district').value.trim();
            const zipcode = document.getElementById('feyzay-zipcode').value.trim();

            const onBilgiOnay = document.getElementById('feyzay-on-bilgi-onay');
            const mesafeliOnay = document.getElementById('feyzay-mesafeli-onay');
            if (!onBilgiOnay.checked || !mesafeliOnay.checked) {
                window.showToast('Devam etmek için Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi\'ni onaylamalısınız.', 'error');
                return;
            }

            let guestData = null;
            if (isGuest) {
                const fName = document.getElementById('feyzay-guest-firstname').value.trim();
                const lName = document.getElementById('feyzay-guest-lastname').value.trim();
                const gEmail = document.getElementById('feyzay-guest-email').value.trim();
                if (!fName || !lName || !gEmail) {
                    window.showToast('Lütfen kişisel bilgilerinizi eksiksiz doldurun.', 'error');
                    return;
                }
                guestData = { firstName: fName, lastName: lName, email: gEmail };
            }

            if (!mahalle || !cadde || !binaNo || !city || !district || !zipcode) {
                window.showToast('Lütfen adresin tüm alanlarını doldurun.', 'error');
                return;
            }

            const combinedStreet = JSON.stringify({ mahalle, cadde, binaNo });
            close({ addressObj: { city, district, street: combinedStreet, zipcode }, guestData });
        };
    });
};

window.editAddressModal = async function () {
    const aktifKullanici = JSON.parse(localStorage.getItem('feyzay_user'));
    if (!aktifKullanici) return;

    let saved = { city: '', district: '', street: '', zipcode: '' };
    try {
        const res = await fetch('/api/user/get-address', { method: 'POST' });
        if (window.feyzayOturumKontrol(res)) return;
        const data = await res.json();
        if (data.success && data.address) saved = data.address;
    } catch (e) { }

    let parsedStreet = { mahalle: '', cadde: '', binaNo: '' };
    if (saved.street) {
        try {
            const obj = JSON.parse(saved.street);
            if (obj.mahalle) parsedStreet = obj;
        } catch (e) {
            parsedStreet.cadde = saved.street;
        }
    }

    let overlay = document.querySelector('.feyzay-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = 'feyzay-modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s ease;';

    overlay.innerHTML = `
        <div class="feyzay-modal" style="background:#fff; padding:25px; border-radius:8px; width:90%; max-width:450px; box-shadow:0 10px 25px rgba(0,0,0,0.2); transform:translateY(-20px); transition:transform 0.3s ease;">
            <h3 style="margin-top:0;">Adres Bilgilerim</h3>
            <div style="margin-bottom: 12px;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">Mahalle</label><input type="text" id="edit-mahalle" value="${feyzayEsc(parsedStreet.mahalle)}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            <div style="margin-bottom: 12px;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">Cadde / Sokak</label><input type="text" id="edit-cadde" value="${feyzayEsc(parsedStreet.cadde)}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            <div style="margin-bottom: 12px;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">Bina / Daire No</label><input type="text" id="edit-binano" value="${feyzayEsc(parsedStreet.binaNo)}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            <div style="display:flex; gap:10px; margin-bottom:12px;">
                <div style="flex:2;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">Şehir</label><input type="text" id="edit-city" value="${feyzayEsc(saved.city)}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
                <div style="flex:2;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">İlçe</label><input type="text" id="edit-district" value="${feyzayEsc(saved.district)}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            </div>
            <div style="margin-bottom:20px;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">Posta Kodu</label><input type="number" id="edit-zipcode" value="${feyzayEsc(saved.zipcode)}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="edit-btn-cancel" style="padding:10px 15px; border:none; background:#eee; color:#333; border-radius:4px; cursor:pointer; font-weight:bold;">İptal Et</button>
                <button id="edit-btn-save" style="padding:10px 15px; border:none; background:#111; color:#fff; border-radius:4px; cursor:pointer; font-weight:bold;">Kaydet</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.querySelector('.feyzay-modal').style.transform = 'translateY(0)';
    });

    document.getElementById('edit-btn-cancel').onclick = () => {
        overlay.style.opacity = '0';
        overlay.querySelector('.feyzay-modal').style.transform = 'translateY(-20px)';
        setTimeout(() => overlay.remove(), 300);
    };

    document.getElementById('edit-btn-save').onclick = async () => {
        const mahalle = document.getElementById('edit-mahalle').value.trim();
        const cadde = document.getElementById('edit-cadde').value.trim();
        const binaNo = document.getElementById('edit-binano').value.trim();
        const city = document.getElementById('edit-city').value.trim();
        const district = document.getElementById('edit-district').value.trim();
        const zipcode = document.getElementById('edit-zipcode').value.trim();

        if (!mahalle || !cadde || !binaNo || !city || !district || !zipcode) {
            window.showToast('Eksik alan bırakmayın.', 'error');
            return;
        }

        const combinedStreet = JSON.stringify({ mahalle, cadde, binaNo });
        const btn = document.getElementById('edit-btn-save');
        btn.innerText = 'Kaydediliyor...';
        btn.disabled = true;

        try {
            const response = await fetch('/api/user/address', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ city, district, street: combinedStreet, zipcode })
            });
            if (window.feyzayOturumKontrol(response)) return;
            const result = await response.json();

            if (result.success) {
                window.showToast(result.message, 'success');
                overlay.style.opacity = '0';
                overlay.querySelector('.feyzay-modal').style.transform = 'translateY(-20px)';
                setTimeout(() => overlay.remove(), 300);
            } else {
                window.showToast('Hata: ' + result.message, 'error');
            }
        } catch (e) {
            window.showToast('Sunucu hatası.', 'error');
        } finally {
            btn.innerText = 'Kaydet';
            btn.disabled = false;
        }
    };
};

window.editProfileModal = function () {
    const aktifKullanici = JSON.parse(localStorage.getItem('feyzay_user'));
    if (!aktifKullanici) return;

    let overlay = document.querySelector('.feyzay-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = 'feyzay-modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s ease;';

    overlay.innerHTML = `
        <div class="feyzay-modal" style="background:#fff; padding:25px; border-radius:8px; width:90%; max-width:450px; box-shadow:0 10px 25px rgba(0,0,0,0.2); transform:translateY(-20px); transition:transform 0.3s ease; max-height:90vh; overflow-y:auto;">
            <h3 style="margin-top:0;">Kullanıcı Bilgilerim</h3>
            <div style="display:flex; gap:10px; margin-bottom:12px;">
                <div style="flex:1;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">İsim</label><input type="text" id="prof-firstname" value="${feyzayEsc(aktifKullanici.firstName || aktifKullanici.name || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
                <div style="flex:1;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">Soyisim</label><input type="text" id="prof-lastname" value="${feyzayEsc(aktifKullanici.lastName || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            </div>
            <div style="margin-bottom:12px;"><label style="display:block; font-size:12px; margin-bottom:4px; color:#777;">E-posta</label><input type="email" id="prof-email" value="${feyzayEsc(aktifKullanici.email || '')}" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            <div style="margin-top:20px; padding-top:15px; border-top:1px dashed #ddd;">
                <h4 style="margin:0 0 10px 0; color:#555;">Şifre Değiştir</h4>
                <div style="margin-bottom:12px;"><input type="password" id="prof-old-password" placeholder="Mevcut Şifre" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
                <div style="margin-bottom:12px;"><input type="password" id="prof-new-password" placeholder="Yeni Şifre (en az 6 haneli, 1 büyük 1 küçük harf, boşluksuz)" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
                <div style="margin-bottom:20px;"><input type="password" id="prof-new-password-confirm" placeholder="Yeni Şifre (Tekrar)" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:4px;"></div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="prof-btn-cancel" style="padding:10px 15px; border:none; background:#eee; color:#333; border-radius:4px; cursor:pointer; font-weight:bold;">İptal</button>
                <button id="prof-btn-save" style="padding:10px 15px; border:none; background:#111; color:#fff; border-radius:4px; cursor:pointer; font-weight:bold;">Güncelle</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.querySelector('.feyzay-modal').style.transform = 'translateY(0)';
    });

    document.getElementById('prof-btn-cancel').onclick = () => {
        overlay.style.opacity = '0';
        overlay.querySelector('.feyzay-modal').style.transform = 'translateY(-20px)';
        setTimeout(() => overlay.remove(), 300);
    };

    document.getElementById('prof-btn-save').onclick = async () => {
        const firstName = document.getElementById('prof-firstname').value.trim();
        const lastName = document.getElementById('prof-lastname').value.trim();
        const newEmail = document.getElementById('prof-email').value.trim();
        const oldPassword = document.getElementById('prof-old-password').value;
        const newPassword = document.getElementById('prof-new-password').value;
        const newPasswordConfirm = document.getElementById('prof-new-password-confirm').value;

        if (!firstName || !lastName || !newEmail) return window.showToast('Gerekli alanları doldurun.', 'error');
        if (oldPassword || newPassword || newPasswordConfirm) {
            if (!oldPassword || !newPassword || !newPasswordConfirm) return window.showToast('Tüm şifre alanlarını doldurun.', 'error');
            if (newPassword !== newPasswordConfirm) return window.showToast('Yeni şifreler uyuşmuyor.', 'error');
            if (!(/^(?=.*[a-z])(?=.*[A-Z])(?!.*\s).{6,}$/.test(newPassword))) {
                return window.showToast('Yeni şifre en az 6 haneli, 1 büyük ve 1 küçük harf içermeli, boşluk içermemelidir!', 'error');
            }
        }

        try {
            const res = await fetch('/api/user/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName, lastName, newEmail, oldPassword: oldPassword || null, newPassword: newPassword || null })
            });
            if (window.feyzayOturumKontrol(res)) return;
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('feyzay_user', JSON.stringify({ firstName: data.firstName, lastName: data.lastName, email: data.email }));
                window.showToast(data.message, 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                window.showToast(data.message, 'error');
            }
        } catch (e) { }
    };
};

window.viewOrdersModal = async function () {
    const aktifKullanici = JSON.parse(localStorage.getItem('feyzay_user'));
    if (!aktifKullanici) return;
    window._feyzayOrdersReqId = (window._feyzayOrdersReqId || 0) + 1;
    const buIstekNo = window._feyzayOrdersReqId;
    const buKullaniciEmail = aktifKullanici.email;

    let overlay = document.querySelector('.feyzay-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.className = 'feyzay-modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.3s ease;';

    overlay.innerHTML = `
        <div class="feyzay-modal" style="position:relative; background:#fff; padding:25px; border-radius:8px; width:90%; max-width:550px; box-shadow:0 10px 25px rgba(0,0,0,0.2); transform:translateY(-20px); transition:transform 0.3s ease; max-height:80vh; overflow-y:auto;">
            <button id="orders-btn-x" style="position:absolute; top:15px; right:15px; background:none; border:none; font-size:24px; cursor:pointer; color:#888; line-height:1; padding:0; transition:color 0.2s;">&times;</button>
            <h3 style="margin-top:0; color:#111;">Sipariş Geçmişim</h3>
            <div id="orders-list-container" style="margin-top:15px; color:#333;">Siparişleriniz yükleniyor...</div>
            
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px;">
                <button id="orders-btn-close" style="padding:10px 15px; border:none; background:#111; color:#fff; border-radius:4px; cursor:pointer; font-weight:bold;">Kapat</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.querySelector('.feyzay-modal').style.transform = 'translateY(0)';
    });

    const closeFunc = () => {
        overlay.style.opacity = '0';
        overlay.querySelector('.feyzay-modal').style.transform = 'translateY(-20px)';
        setTimeout(() => overlay.remove(), 300);
    };

    document.getElementById('orders-btn-close').onclick = closeFunc;
    document.getElementById('orders-btn-x').onclick = closeFunc;

    try {
        let allProducts = [];
        try {
            const prodRes = await fetch('products.json');
            allProducts = await prodRes.json();
        } catch (e) { }

        const response = await fetch('/api/user/orders', { method: 'POST' });
        if (window.feyzayOturumKontrol(response)) return;
        const result = await response.json();

        if (buIstekNo !== window._feyzayOrdersReqId || buKullaniciEmail !== (JSON.parse(localStorage.getItem('feyzay_user')) || {}).email) {
            return;
        }

        const container = document.getElementById('orders-list-container');
        if (!container) return;

        if (result.success && result.orders.length > 0) {
            let html = '';
            result.orders.forEach(order => {
                let itemsHtml = order.cartData.map(item => {
                    let imgSrc = 'img/no-image.svg';
                    let product = allProducts.find(x => x.id === item.id);
                    if (product) {
                        if (product.colors && product.colors.length > 0) {
                            let cObj = product.colors.find(c => c.name === item.renk) || product.colors[0];
                            if (cObj && cObj.images && cObj.images.length > 0) imgSrc = cObj.images[0];
                        } else if (product.images && product.images.length > 0) {
                            imgSrc = product.images[0];
                        } else if (product.image) {
                            imgSrc = product.image;
                        }
                    }

                    return `
                        <div style="display:flex; align-items:center; gap:12px; margin-top:10px; padding-top:10px; border-top:1px dashed #eee;">
                            <img src="${feyzayEsc(imgSrc)}" style="width:50px; height:65px; object-fit:cover; border-radius:4px; border:1px solid #ddd;">
                            <div>
                                <div style="font-weight:600; font-size:13px; margin-bottom:4px;">${feyzayEsc(item.name)}</div>
                                <div style="color:#777; font-size:12px;">${feyzayEsc(item.beden)} ${item.renk ? ' | ' + feyzayEsc(item.renk) : ''} | ${feyzayEsc(item.adet)} Adet</div>
                            </div>
                        </div>
                    `;
                }).join('');
                if (order.cancelReason) {
                    html += `
                    <div style="padding:15px; border:1px solid #f5c6c6; border-radius:6px; margin-bottom:10px; font-size:14px; background:#fdf3f3;">
                        <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:5px;">
                            <span>Sipariş: #${order.id}</span>
                            <span>${new Date(order.createdAt).toLocaleDateString('tr-TR')}</span>
                        </div>
                        <div style="margin-bottom:10px; font-size:13px; background:#fff; padding:8px 12px; border:1px solid #f5c6c6; border-radius:4px;">
                            <strong style="color:#e74c3c;">Sipariş İptal Edildi.</strong>
                            <span style="color:#555;">Nedeni: ${feyzayEsc(order.cancelReason)}</span>
                        </div>
                        <div style="background:#fff; padding:10px; border-radius:4px; border:1px solid #f0e5e5;">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
                    return;
                }
                let durumHtml;
                if (order.cargoState === 1) {
                    const takipLink = order.cargoTrackingCode
                        ? `<a href="http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${encodeURIComponent(order.cargoTrackingCode)}" target="_blank" rel="noopener" style="color:#3498db; text-decoration:none; font-weight:bold; font-size:12px; margin-left:8px; border-left:1px solid #ddd; padding-left:8px;">Takip Ekranı ↗</a>`
                        : '';
                    durumHtml = `<span style="color:#2ecc71; font-weight:bold;">Kargoda</span> ${takipLink}`;
                } else if (order.approvalState === 0) {
                    durumHtml = `<span style="color:#7f8c8d; font-weight:bold;">Onay Bekliyor</span>`;
                } else {
                    durumHtml = `<span style="color:#f39c12; font-weight:bold;">Hazırlanıyor</span>`;
                }
                html += `
                    <div style="padding:15px; border:1px solid #eee; border-radius:6px; margin-bottom:10px; font-size:14px; background:#fcfcfc;">
                        <div style="display:flex; justify-content:space-between; font-weight:bold; margin-bottom:5px;">
                            <span>Sipariş: #${order.id}</span>
                            <span>${new Date(order.createdAt).toLocaleDateString('tr-TR')}</span>
                        </div>
                        <div style="margin-bottom:10px; font-size:13px; background:#fff; padding:8px 12px; border:1px solid #e1e8ed; border-radius:4px;">
                            <strong>Kargo Durumu:</strong> <span id="live-cargo-${order.id}">${durumHtml}</span>
                        </div>
                        <div style="background:#fff; padding:10px; border-radius:4px; border:1px solid #f0f0f0;">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
            // Yalnızca "Kargoda" aşamasındaki siparişlerde canlı Aras durumunu zenginleştir.
            result.orders.forEach(async (order) => {
                if (order.cancelReason || order.cargoState !== 1) return;
                const statusSpan = document.getElementById(`live-cargo-${order.id}`);
                if (!statusSpan) return;
                try {
                    const cRes = await fetch('/api/user/cargo-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderId: order.id })
                    });
                    const cData = await cRes.json();
                    if (cData.success && cData.durum) {
                        const linkHtml = cData.takipNo
                            ? `<a href="http://kargotakip.araskargo.com.tr/mainpage.aspx?code=${encodeURIComponent(cData.takipNo)}" target="_blank" rel="noopener" style="color:#3498db; text-decoration:none; font-weight:bold; font-size:12px; margin-left:8px; border-left:1px solid #ddd; padding-left:8px;">Takip Ekranı ↗</a>`
                            : '';
                        statusSpan.innerHTML = `<span style="color:#2ecc71; font-weight:bold;">Kargoda</span> <span style="color:#555;">— ${feyzayEsc(cData.durum)}</span> ${linkHtml}`;
                    }
                } catch (e) {
                    // Canlı sorgu başarısızsa DB'den gelen "Kargoda" etiketi görünürde kalır.
                }
            });

        } else {
            container.innerHTML = '<p style="color:#666;">Siparişiniz bulunmuyor.</p>';
        }
    } catch (e) {
        document.getElementById('orders-list-container').innerHTML = '<p style="color:#e74c3c;">Siparişler yüklenirken hata oluştu.</p>';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('slider');
    const nextBtn = document.getElementById('nextBtn');
    const prevBtn = document.getElementById('prevBtn');
    if (slider && nextBtn && prevBtn) {
        let slideWidth = slider.clientWidth;
        window.addEventListener('resize', () => slideWidth = slider.clientWidth);
        const goNext = () => { if (slider.scrollLeft + slideWidth >= slider.scrollWidth - 10) slider.scrollTo({ left: 0, behavior: 'smooth' }); else slider.scrollBy({ left: slideWidth, behavior: 'smooth' }); };
        const goPrev = () => { if (slider.scrollLeft === 0) slider.scrollTo({ left: slider.scrollWidth, behavior: 'smooth' }); else slider.scrollBy({ left: -slideWidth, behavior: 'smooth' }); };
        nextBtn.addEventListener('click', goNext); prevBtn.addEventListener('click', goPrev);
        let autoPlay = setInterval(goNext, 4000);
        slider.addEventListener('mouseenter', () => clearInterval(autoPlay));
        slider.addEventListener('mouseleave', () => autoPlay = setInterval(goNext, 4000));
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const urunKutusu = document.getElementById('urun-kutusu');
    let butunUrunler = [];

    if (urunKutusu) {
        const CINSIYET_ETIKETLERI = ['erkek', 'kadın', 'kız', 'unisex'];

        function urunGenderTespitEt(urun) {
            if (!urun.tags) return null;
            if (urun.tags.includes('erkek')) return 'erkek';
            if (urun.tags.includes('unisex')) return 'unisex';
            if (urun.tags.includes('kadın') || urun.tags.includes('kız')) return 'kadin';
            return null;
        }

        const TUM_KATEGORILER = [
            { filter: 'tesettür bone', label: 'Tesettür Bone' },
            { filter: 'tesettür alt - üst takım', label: 'Tesettür Alt - Üst Takım' },
            { filter: 'tesettür bluz', label: 'Tesettür Bluz' },
            { filter: 'bandana', label: 'Bandana' },
            { filter: 'bere', label: 'Bere' },
            { filter: 'tayt', label: 'Tayt' },
            { filter: 'boyunluk', label: 'Boyunluk' },
            { filter: 'atkı & bere set', label: 'Atkı & Bere Set' },
            { filter: 'şapka', label: 'Şapka' },
            { filter: 'saç bandı', label: 'Saç Bandı' },
            { filter: 'pijama takımı', label: 'Pijama Takımı' },
            { filter: 't-shirt', label: 'T-Shirt' },
            { filter: 'bluz', label: 'Bluz' },
            { filter: 'çorap', label: 'Çorap' },
            { filter: 'alt - üst takım', label: 'Alt - Üst Takım' },
            { filter: 'şort & bermuda', label: 'Şort & Bermuda' },
            { filter: 'spor t-shirt', label: 'Spor T-Shirt' },
            { filter: 'spor alt - üst takım', label: 'Spor Alt - Üst Takım' },
            { filter: 'tesettür şal', label: 'Tesettür Şal' },
            { filter: 'şal', label: 'Şal' },
            { filter: 'atkı & bere & eldiven set', label: 'Atkı & Bere & Eldiven Set' },
            { filter: 'kostüm', label: 'Kostüm' }
        ];

        const ERKEK_KATEGORILER = [
            { filter: 'bandana', label: 'Bandana' },
            { filter: 'bere', label: 'Bere' },
            { filter: 'boyunluk', label: 'Boyunluk' },
            { filter: 'atkı & bere set', label: 'Atkı & Bere Set' },
            { filter: 'şapka', label: 'Şapka' },
            { filter: 'saç bandı', label: 'Saç Bandı' },
            { filter: 'pijama takımı', label: 'Pijama Takımı' },
            { filter: 't-shirt', label: 'T-Shirt' },
            { filter: 'çorap', label: 'Çorap' },
            { filter: 'alt - üst takım', label: 'Alt - Üst Takım' },
            { filter: 'şort & bermuda', label: 'Şort & Bermuda' },
            { filter: 'spor t-shirt', label: 'Spor T-Shirt' },
            { filter: 'spor alt - üst takım', label: 'Spor Alt - Üst Takım' }
        ];

        const genderBtns = document.querySelectorAll('.gender-btn');
        const kategoriKutusu = document.getElementById('kategori-listesi');
        const searchInput = document.getElementById('product-search-input');

        let aktifGender = 'all';
        let aktifKategori = 'all';
        let aramaKelimesi = '';

        function unisexKategorileriGetir() {
            const gorulenler = new Set();
            const liste = [];
            butunUrunler.forEach(u => {
                if (urunGenderTespitEt(u) === 'unisex' && u.tags) {
                    u.tags.forEach(t => {
                        if (CINSIYET_ETIKETLERI.includes(t)) return;
                        if (!gorulenler.has(t)) {
                            gorulenler.add(t);
                            const hazirEslesme = TUM_KATEGORILER.find(k => k.filter === t);
                            liste.push({ filter: t, label: hazirEslesme ? hazirEslesme.label : (t.charAt(0).toUpperCase() + t.slice(1)) });
                        }
                    });
                }
            });
            return liste;
        }

        function kategorileriGetirGoreGender(gender) {
            if (gender === 'erkek') return ERKEK_KATEGORILER;
            if (gender === 'unisex') return unisexKategorileriGetir();
            return TUM_KATEGORILER;
        }

        function kategorileriCiz(gender) {
            if (!kategoriKutusu) return;
            const liste = kategorileriGetirGoreGender(gender);
            kategoriKutusu.innerHTML = '<button class="filter-btn active" data-filter="all">Hepsi</button>' +
                liste.map(k => `<button class="filter-btn" data-filter="${k.filter}">${k.label}</button>`).join('');

            kategoriKutusu.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    kategoriKutusu.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    aktifKategori = btn.getAttribute('data-filter');
                    filtreyiUygula();
                });
            });
        }

        const urunleriEkranaBas = (urunListesi) => {
            urunKutusu.innerHTML = '';
            if (urunListesi.length === 0) {
                urunKutusu.innerHTML = '<p style="text-align:center; grid-column:1/-1; color:#888;">Arama kriterlerine uygun ürün bulunamadı.</p>';
                return;
            }
            urunListesi.forEach(urun => {
                let imgSource = 'img/no-image.svg';
                if (urun.colors && urun.colors.length > 0 && urun.colors[0].images && urun.colors[0].images.length > 0) {
                    imgSource = urun.colors[0].images[0];
                } else if (urun.images && urun.images.length > 0) {
                    imgSource = urun.images[0];
                } else if (urun.image) {
                    imgSource = urun.image;
                }
                let kart = document.createElement('div');
                kart.className = 'product-card';
                kart.innerHTML = `
                    <div class="card-image" style="cursor:pointer;"><img src="${feyzayEsc(imgSource)}" alt="${feyzayEsc(urun.name)}"></div>
                    <div class="card-details">
                        <h3 class="product-title" style="cursor:pointer;">${feyzayEsc(urun.name)}</h3>
                        <p class="product-price">${Number(urun.price).toFixed(2)} TL</p>
                        <button class="add-to-cart-btn">İncele</button>
                    </div>
                `;
                kart.querySelector('.card-image').onclick = () => window.openProductDetailModal(urun);
                kart.querySelector('.product-title').onclick = () => window.openProductDetailModal(urun);
                kart.querySelector('.add-to-cart-btn').onclick = () => window.openProductDetailModal(urun);
                urunKutusu.appendChild(kart);
            });
        };

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                aramaKelimesi = e.target.value.toLowerCase().trim();
                filtreyiUygula();
            });
        }

        function filtreyiUygula() {
            let liste = butunUrunler;

            if (aktifGender !== 'all') liste = liste.filter(u => urunGenderTespitEt(u) === aktifGender);

            if (aktifKategori !== 'all') liste = liste.filter(u => u.tags && u.tags.includes(aktifKategori));

            if (aramaKelimesi !== '') {
                liste = liste.filter(u => u.name.toLowerCase().includes(aramaKelimesi));
            }

            urunleriEkranaBas(liste);
        }

        if (genderBtns) {
            genderBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    genderBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    aktifGender = btn.getAttribute('data-gender');
                    aktifKategori = 'all';
                    kategorileriCiz(aktifGender);
                    filtreyiUygula();
                });
            });
        }

        async function urunleriGetir() {
            try {
                const res = await fetch('products.json');
                if (!res.ok) throw new Error();
                butunUrunler = await res.json();

                kategorileriCiz(aktifGender);

                const params = new URLSearchParams(window.location.search);
                const baslangicFiltresi = params.get('filter');
                if (baslangicFiltresi && kategoriKutusu) {
                    aktifKategori = baslangicFiltresi;
                    const eslesenBtn = kategoriKutusu.querySelector('.filter-btn[data-filter="' + baslangicFiltresi + '"]');
                    if (eslesenBtn) {
                        kategoriKutusu.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                        eslesenBtn.classList.add('active');
                    }
                }

                filtreyiUygula();
            } catch (e) { }
        }
        urunleriGetir();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const nav = document.querySelector('.navigation');
    const kullanici = await window.feyzayKimlik;
    if (kullanici && nav) {
        const authLink = Array.from(nav.querySelectorAll('a')).find(a => a.getAttribute('href') === 'kayit.html');
        if (authLink) {
            authLink.outerHTML = `
                <div class="user-menu-container">
                    <a class="user-greeting" id="user-greeting-btn">Hesabım</a>
                    <div class="dropdown-content" id="user-dropdown">
                        <p style="padding:10px 16px; margin:0; font-size:12px; color:#888;">Merhaba, ${feyzayEsc(kullanici.firstName || 'Üye')}</p>
                        <a href="#" id="siparislerim-btn">Siparişlerim</a>
                        <a href="#" id="adres-duzenle-btn">Adres Bilgilerini Düzenle</a>
                        <a href="#" id="profil-duzenle-btn">Kullanıcı Bilgilerini Düzenle</a>
                        <a href="#" id="cikis-yap-btn" class="logout-btn">Çıkış Yap</a>
                    </div>
                </div>
            `;
            const dropdown = document.getElementById('user-dropdown');
            document.getElementById('user-greeting-btn').onclick = (e) => { e.preventDefault(); dropdown.classList.toggle('goster'); };
            window.addEventListener('click', (e) => { if (!e.target.matches('.user-greeting') && dropdown && dropdown.classList.contains('goster')) dropdown.classList.remove('goster'); });
            document.getElementById('siparislerim-btn').onclick = (e) => { e.preventDefault(); dropdown.classList.remove('goster'); window.viewOrdersModal(); };
            document.getElementById('adres-duzenle-btn').onclick = (e) => { e.preventDefault(); dropdown.classList.remove('goster'); window.editAddressModal(); };
            document.getElementById('profil-duzenle-btn').onclick = (e) => { e.preventDefault(); dropdown.classList.remove('goster'); window.editProfileModal(); };
            document.getElementById('cikis-yap-btn').onclick = async (e) => {
                e.preventDefault();
                // Oturum sunucuda da kapatılır; yalnızca tarayıcıyı temizlemek yetmez.
                try { await fetch('/api/logout', { method: 'POST' }); } catch (err) { }
                localStorage.removeItem('feyzay_user');
                // Hesap değiştirildiğinde bir önceki kullanıcının sepeti yeni hesapta görünmesin diye sepeti de temizliyoruz.
                localStorage.setItem('feyzay_sepet', JSON.stringify([]));
                window.location.reload();
            };
        }
    }
});

document.addEventListener('DOMContentLoaded', async () => {

    const btnLogin = document.getElementById('btn-login');
    const btnSignup = document.getElementById('btn-signup');
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');


    if (btnLogin && btnSignup && loginForm && signupForm) {

        if (await window.feyzayKimlik) window.location.href = 'index.html';

        btnLogin.onclick = () => {
            btnLogin.classList.add('active');
            btnSignup.classList.remove('active');
            loginForm.style.display = 'block';
            signupForm.style.display = 'none';
            setTimeout(() => {
                loginForm.classList.add('active-form');
                signupForm.classList.remove('active-form');
            }, 50);
        };

        btnSignup.onclick = () => {
            btnSignup.classList.add('active');
            btnLogin.classList.remove('active');
            signupForm.style.display = 'block';
            loginForm.style.display = 'none';
            setTimeout(() => {
                signupForm.classList.add('active-form');
                loginForm.classList.remove('active-form');
            }, 50);
        };
    }


    if (signupForm) {
        signupForm.onsubmit = async (e) => {
            e.preventDefault();

            const firstName = document.getElementById('signup-firstname').value.trim();
            const lastName = document.getElementById('signup-lastname').value.trim();
            const email = document.getElementById('signup-email').value.trim();
            const password = document.getElementById('signup-password').value;
            const passwordConfirm = document.getElementById('signup-password-confirm').value;

            if (!firstName || !lastName || !email || !password) return window.showToast('Lütfen tüm alanları doldurun!', 'error');
            if (password !== passwordConfirm) return window.showToast('Şifreler eşleşmiyor!', 'error');


            if (!(/^(?=.*[a-z])(?=.*[A-Z])(?!.*\s).{6,}$/.test(password))) {
                return window.showToast('Şifre en az 6 haneli, 1 büyük ve 1 küçük harf içermeli, boşluk içermemelidir!', 'error');
            }

            const uyelikOnay = document.getElementById('signup-uyelik-onay');
            const kvkkOnay = document.getElementById('signup-kvkk-onay');
            const pazarlamaOnay = document.getElementById('signup-pazarlama-onay');
            if (uyelikOnay && !uyelikOnay.checked) return window.showToast('Devam etmek için Üyelik Sözleşmesi\'ni onaylamalısınız.', 'error');
            if (kvkkOnay && !kvkkOnay.checked) return window.showToast('Devam etmek için KVKK Aydınlatma Metni\'ni onaylamalısınız.', 'error');
            const marketingConsent = pazarlamaOnay ? pazarlamaOnay.checked : false;


            const btn = signupForm.querySelector('button[type="submit"]');
            const originalText = btn ? btn.innerText : 'Hesap Oluştur';

            if (btn) {
                btn.innerText = 'Kayıt Yapılıyor...';
                btn.disabled = true;
            }

            try {
                const res = await fetch('/api/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ firstName, lastName, email, password, marketingConsent })
                });
                const d = await res.json();

                if (d.success) {

                    localStorage.setItem('feyzay_user', JSON.stringify({ firstName: d.firstName, lastName: lastName, email }));
                    window.showToast(d.message, 'success');
                    setTimeout(() => window.location.href = 'index.html', 1500);
                } else {
                    window.showToast(d.message, 'error');
                }
            } catch (err) {
                window.showToast('Sunucu hatası! Terminali kontrol edin.', 'error');
            } finally {

                if (btn) {
                    btn.innerText = originalText;
                    btn.disabled = false;
                }
            }
        };
    }


    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();

            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;

            const btn = loginForm.querySelector('button[type="submit"]');
            const originalText = btn ? btn.innerText : 'Giriş Yap';

            if (btn) {
                btn.innerText = 'Giriş Yapılıyor...';
                btn.disabled = true;
            }

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const d = await res.json();

                if (d.success) {
                    localStorage.setItem('feyzay_user', JSON.stringify({ firstName: d.firstName, lastName: d.lastName, email }));
                    window.showToast(d.message, 'success');
                    setTimeout(() => window.location.href = 'index.html', 1000);
                } else {
                    window.showToast(d.message, 'error');
                }
            } catch (err) {
                window.showToast('Sunucu hatası!', 'error');
            } finally {
                if (btn) {
                    btn.innerText = originalText;
                    btn.disabled = false;
                }
            }
        };
    }

    // Şifremi unuttum: giriş formunun altındaki satır içi form
    const forgotToggle = document.getElementById('forgot-toggle');
    const forgotForm = document.getElementById('forgot-form');
    if (forgotToggle && forgotForm) {
        forgotToggle.onclick = (e) => {
            e.preventDefault();
            forgotForm.style.display = forgotForm.style.display === 'none' ? 'block' : 'none';
        };

        const forgotSubmit = document.getElementById('forgot-submit');
        const forgotMessage = document.getElementById('forgot-message');
        forgotSubmit.onclick = async () => {
            const email = document.getElementById('forgot-email').value.trim();
            if (!email) {
                forgotMessage.textContent = 'Lütfen e-posta adresinizi girin.';
                forgotMessage.style.color = '#c0392b';
                forgotMessage.style.display = 'block';
                return;
            }

            forgotSubmit.innerText = 'Gönderiliyor...';
            forgotSubmit.disabled = true;
            try {
                const res = await fetch('/api/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const d = await res.json();
                forgotMessage.textContent = d.message;
                forgotMessage.style.color = d.success ? '#1a8f4c' : '#c0392b';
                forgotMessage.style.display = 'block';
            } catch (err) {
                forgotMessage.textContent = 'Sunucu hatası! Terminali kontrol edin.';
                forgotMessage.style.color = '#c0392b';
                forgotMessage.style.display = 'block';
            } finally {
                forgotSubmit.innerText = 'Sıfırlama Bağlantısı Gönder';
                forgotSubmit.disabled = false;
            }
        };
    }
});

document.addEventListener('DOMContentLoaded', () => {
    let sepet = JSON.parse(localStorage.getItem('feyzay_sepet')) || [];
    const sepetAcBtn = document.getElementById('sepet-ac-btn');
    const sepetKapatBtn = document.getElementById('sepet-kapat');
    const sepetSidebar = document.getElementById('sepet-sidebar');
    const sepetOverlay = document.getElementById('sepet-overlay');
    const sepetIcerik = document.getElementById('sepet-icerik');
    const sepetToplamText = document.getElementById('sepet-toplam-fiyat');

    const sepetiAc = (e) => { if (e) e.preventDefault(); if (sepetSidebar && sepetOverlay) { sepetSidebar.classList.add('aktif'); sepetOverlay.classList.add('aktif'); } };
    const sepetiKapat = () => { if (sepetSidebar && sepetOverlay) { sepetSidebar.classList.remove('aktif'); sepetOverlay.classList.remove('aktif'); } };

    if (sepetAcBtn) sepetAcBtn.onclick = sepetiAc;
    if (sepetKapatBtn) sepetKapatBtn.onclick = sepetiKapat;
    if (sepetOverlay) sepetOverlay.onclick = sepetiKapat;

    window.feyzay_sepetiGuncelle = function () {
        sepet = JSON.parse(localStorage.getItem('feyzay_sepet')) || [];
        let toplamUrun = 0; let toplamFiyat = 0; if (sepetIcerik) sepetIcerik.innerHTML = '';
        if (sepet.length === 0) { if (sepetIcerik) sepetIcerik.innerHTML = '<p style="text-align:center; color:#888; margin-top:20px;">Sepetiniz boş.</p>'; }
        else {
            sepet.forEach((urun) => {
                toplamUrun += urun.adet; toplamFiyat += (urun.fiyat * urun.adet);
                if (sepetIcerik) {
                    const ozellikMetni = [urun.beden || 'Standart', urun.renk].filter(Boolean).join(' - ');
                    const beden = urun.beden || 'Standart';
                    const renk = urun.renk || '';
                    sepetIcerik.innerHTML += `
                        <div class="sepet-item">
                            <img src="${feyzayEsc(urun.resim)}">
                            <div class="sepet-item-detay">
                                <h4>${feyzayEsc(urun.isim)} (${feyzayEsc(ozellikMetni)})</h4>
                                <p>${Number(urun.fiyat).toFixed(2)} TL</p>
                                <div class="adet-kontrol">
                                    <button data-qty-action="-1" data-id="${feyzayEsc(urun.id)}" data-beden="${feyzayEsc(beden)}" data-renk="${feyzayEsc(renk)}">-</button>
                                    <span>${feyzayEsc(urun.adet)}</span>
                                    <button data-qty-action="1" data-id="${feyzayEsc(urun.id)}" data-beden="${feyzayEsc(beden)}" data-renk="${feyzayEsc(renk)}">+</button>
                                </div>
                            </div>
                        </div>
                    `;
                }
            });
        }
        if (sepetAcBtn) sepetAcBtn.innerText = `Sepet (${toplamUrun})`;
        if (sepetToplamText) sepetToplamText.innerText = `${toplamFiyat.toFixed(2)} TL`;
    };

    window.changeQtyInCart = function (id, size, renk, change) {
        const renkKey = renk || '';
        let target = sepet.find(u => u.id === id && u.beden === size && (u.renk || '') === renkKey);
        if (target) {
            target.adet += change;
            if (target.adet <= 0) sepet = sepet.filter(u => !(u.id === id && u.beden === size && (u.renk || '') === renkKey));
            localStorage.setItem('feyzay_sepet', JSON.stringify(sepet));
            window.feyzay_sepetiGuncelle();
        }
    };

    // Satır içi onclick yerine delege edilmiş dinleyici: ürün adı/beden/renk
    // içindeki bir tırnak işareti artık HTML niteliğinden kaçamaz.
    if (sepetIcerik) {
        sepetIcerik.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-qty-action]');
            if (!btn) return;
            window.changeQtyInCart(btn.dataset.id, btn.dataset.beden, btn.dataset.renk, Number(btn.dataset.qtyAction));
        });
    }

    document.addEventListener('click', async (e) => {
        if (e.target.id === 'satin-al-btn' || e.target.classList.contains('satin-al-btn')) {
            e.preventDefault();
            if (sepet.length === 0) return window.showToast('Sepetiniz boş.', 'error');

            const aktifKullanici = JSON.parse(localStorage.getItem('feyzay_user'));
            const isGuest = !aktifKullanici;
            e.target.disabled = true;

            const resData = await window.askForAddress(isGuest);
            if (!resData) {
                window.showToast('İptal edildi.', 'error');
                e.target.disabled = false;
                return;
            }

            const { addressObj, guestData } = resData;
            const originalText = e.target.innerText;
            e.target.innerText = "Güvenli Ödemeye Bağlanıyor...";

            try {
                const res = await fetch('/api/checkout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        isGuest,
                        email: (isGuest ? guestData.email : aktifKullanici?.email) || '',
                        firstName: (isGuest ? guestData.firstName : (aktifKullanici?.name || aktifKullanici?.firstName)) || '',
                        lastName: (isGuest ? guestData.lastName : aktifKullanici?.lastName) || '',
                        addressObj,
                        cart: sepet
                    })
                });
                const d = await res.json();

                if (d.success && d.token) {
                    let overlay = document.querySelector('.feyzay-modal-overlay');
                    if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.className = 'feyzay-modal-overlay';
                        overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); z-index:9999; display:flex; align-items:center; justify-content:center;';
                        document.body.appendChild(overlay);
                    }
                    overlay.innerHTML = `
                        <div class="feyzay-modal" style="background:#fff; padding:10px; border-radius:8px; width:100%; max-width:600px; height:80vh; display:flex; flex-direction:column;">
                            <div style="text-align:right; padding-bottom:10px;"><button id="close-paytr" style="background:none; border:none; font-size:24px; cursor:pointer;">&times;</button></div>
                            <iframe src="https://www.paytr.com/odeme/guvenli/${d.token}" id="paytriframe" frameborder="0" scrolling="yes" style="width: 100%; height: 100%; flex:1;"></iframe>
                        </div>
                    `;
                    document.getElementById('close-paytr').onclick = () => {
                        overlay.remove();
                        window.showToast('Ödeme iptal edildi.', 'error');
                    };
                } else {
                    window.showToast(d.message || 'Ödeme başlatılamadı.', 'error');
                    let overlay = document.querySelector('.feyzay-modal-overlay');
                    if (overlay) overlay.remove();
                }
            } catch (err) {
                window.showToast('Sunucu hatası.', 'error');
            } finally {
                e.target.innerText = originalText;
                e.target.disabled = false;
            }
        }
    });

    window.addEventListener('message', function (event) {
        if (event.data === 'PAYTR_SUCCESS') {
            window.showToast('Ödeme Başarılı! Siparişiniz alındı.');
            localStorage.setItem('feyzay_sepet', JSON.stringify([]));
            if (window.feyzay_sepetiGuncelle) window.feyzay_sepetiGuncelle();
            let overlay = document.querySelector('.feyzay-modal-overlay');
            if (overlay) overlay.remove();

            const sidebar = document.getElementById('sepet-sidebar');
            const bgOverlay = document.getElementById('sepet-overlay');
            if (sidebar) sidebar.classList.remove('aktif');
            if (bgOverlay) bgOverlay.classList.remove('aktif');
        } else if (event.data === 'PAYTR_FAIL') {
            window.showToast('Ödeme Başarısız. Lütfen tekrar deneyin.', 'error');
            let overlay = document.querySelector('.feyzay-modal-overlay');
            if (overlay) overlay.remove();
        }
    });

    window.feyzay_sepetiGuncelle();
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment') === 'success') {
        localStorage.setItem('feyzay_sepet', JSON.stringify([]));
        window.history.replaceState(null, '', window.location.pathname);
        setTimeout(() => window.showToast('Ödeme Başarılı! Siparişiniz alındı.'), 500);
        window.feyzay_sepetiGuncelle();
    } else if (urlParams.get('payment') === 'fail') {
        window.history.replaceState(null, '', window.location.pathname);
        setTimeout(() => window.showToast('Ödeme başarısız oldu. Lütfen tekrar deneyin.', 'error'), 500);
    }
});