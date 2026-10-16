// Aras Kargo canlı sipariş iletimi (SetOrder) ve XML yardımcıları.
const { db } = require('../db');
const config = require('../config');

function xmlKacis(deger) {
    return String(deger ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[ch]);
}

function cdataKacis(deger) {
    return String(deger ?? '').replace(/]]>/g, ']]]]><![CDATA[>');
}

async function sendToArasKargo(orderId, orderObj) {
    const apiUrl = "https://customerws.araskargo.com.tr/arascargoservice.asmx"; // CANLI ORTAM
    //const apiUrl = "https://customerservicestest.araskargo.com.tr/arascargoservice/arascargoservice.asmx";//test
    const userName = config.env.ARAS_USERNAME;
    const password = config.env.ARAS_PASSWORD;

    if (!userName || !password) {
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, ['Aras Kargo API bilgileri (.env) eksik.', orderId]);
        console.error("Aras Kargo API bilgileri (.env) eksik. Kargo entegrasyonu atlanıyor.");
        return null;
    }

    const integrationCode = "FZ-" + orderId;
    // Gönderi ve durum sorguları aynı şemayı kullansın diye irsaliye no = entegrasyon kodu.
    // Yeniden gönderimde çakışma olursa (irsaliye/barkod daha önce kullanılmış) eski
    // zaman damgası şemasıyla bir kez daha denenir.
    const sonuc = await setOrderGonder(apiUrl, userName, password, orderId, orderObj, integrationCode);
    if (sonuc.basarili) return sonuc.responseText;

    if (sonuc.cakisma) {
        console.log(`[ARAS] Sipariş ID: ${orderId} için ${integrationCode} çakıştı, yedek numarayla deneniyor.`);
        const yedek = "FZ" + Date.now().toString().slice(-6) + orderId;
        return (await setOrderGonder(apiUrl, userName, password, orderId, orderObj, yedek)).responseText;
    }
    return null;
}

async function setOrderGonder(apiUrl, userName, password, orderId, orderObj, waybillNo) {
    const barcodeNo = waybillNo + "01";
    const integrationCode = "FZ-" + orderId;

    const aliciAdi = `${orderObj.firstName || ''} ${orderObj.lastName || ''}`.trim();

    const xmlPayload = `
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="http://tempuri.org/">
       <soap:Header/>
       <soap:Body>
          <SetOrder xmlns="http://tempuri.org/">
             <orderInfo>
                <Order>
                   <UserName>${xmlKacis(userName)}</UserName>
                   <Password>${xmlKacis(password)}</Password>
                   <TradingWaybillNumber>${xmlKacis(waybillNo)}</TradingWaybillNumber>
                   <ReceiverName>${xmlKacis(aliciAdi)}</ReceiverName>
                   <ReceiverAddress>${xmlKacis(orderObj.addressObj && orderObj.addressObj.street)}</ReceiverAddress>
                   <ReceiverPhone1>${xmlKacis(orderObj.phone || '05555555555')}</ReceiverPhone1>
                   <ReceiverCityName>${xmlKacis(orderObj.addressObj && orderObj.addressObj.city)}</ReceiverCityName>
                   <ReceiverTownName>${xmlKacis(orderObj.addressObj && orderObj.addressObj.district)}</ReceiverTownName>
                   <PieceCount>1</PieceCount>
                   <IntegrationCode>${xmlKacis(integrationCode)}</IntegrationCode>
                   <PayorTypeCode>1</PayorTypeCode>
                   <IsWorldWide>0</IsWorldWide>
                   <PieceDetails>
                      <PieceDetail>
                         <VolumetricWeight>1</VolumetricWeight>
                         <Weight>1</Weight>
                         <BarcodeNumber>${xmlKacis(barcodeNo)}</BarcodeNumber>
                         <ProductNumber />
                         <Description>Web Siparis ID: ${xmlKacis(orderId)}</Description>
                      </PieceDetail>
                   </PieceDetails>
                </Order>
             </orderInfo>
             <userName>${xmlKacis(userName)}</userName>
             <password>${xmlKacis(password)}</password>
          </SetOrder>
       </soap:Body>
    </soap:Envelope>
    `;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/soap+xml; charset=utf-8'
            },
            body: xmlPayload
        });

        const responseText = await response.text();

        if (responseText.includes('<ResultCode>0</ResultCode>')) {
            // cargo_state bilinçli olarak 0 bırakılır: gerçek takip numarası Aras
            // geri bildirimi (irsaliye/kurye taraması) gelene kadar "Kurye Bekleniyor"
            // aşamasındadır. cargo_tracking_code ancak o geri bildirimle dolar.
            db.run(`UPDATE orders SET aras_waybill = ?, aras_error = NULL, cancel_reason = NULL WHERE id = ?`,
                [waybillNo, orderId]);
            console.log(`[ARAS] Sipariş aktarımı BAŞARILI (Sipariş ID: ${orderId}, Takip: ${waybillNo})`);
            return { basarili: true, cakisma: false, responseText };
        }

        // İrsaliye/barkod daha önce gönderildiyse yeniden denemeye değer.
        const cakisma = /daha\s+önce|70027/i.test(responseText);
        const hata = responseText.slice(0, 500);
        if (!cakisma) {
            db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, [hata, orderId]);
        }
        console.error(`[ARAS] Aktarım HATASI (Sipariş ID: ${orderId}):`, responseText);
        return { basarili: false, cakisma, responseText: null };
    } catch (error) {
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, [String(error.message || error), orderId]);
        console.error("[ARAS] Sunucu Hatası:", error);
        return { basarili: false, cakisma: false, responseText: null };
    }
}

function readArasKargoOrders(orderId, orderObj, callback) {
    const apiUrl = "https://customerws.araskargo.com.tr/arascargoservice.asmx"; // CANLI ORTAM
    //const apiUrl = "https://customerservicestest.araskargo.com.tr/arascargoservice/arascargoservice.asmx";//test
    const userName = config.env.ARAS_USERNAME;
    const password = config.env.ARAS_PASSWORD;

    const orderDetails = [];

    // Get all orders.
    db.all(`SELECT * FROM orders WHERE id = ?`, [orderId], async (err, rows) => {
        if (err) {
            console.error("Veri çekilirken hata:", err);
            callback([{ orderId, status: 'error', error: String(err.message || err) }]);
            return;
        }

        if (rows.length === 0) {
            console.log(`Sipariş bulunamadı: ID ${orderId}`);
            callback([{ orderId, status: 'not_found', error: 'Sipariş bulunamadı' }]);
            return;
        }

        for (const order of rows) {
            const integrationCode = "FZ-" + order.id;

            const xmlPayload = `
            <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="http://tempuri.org/">
               <soap:Header/>
               <soap:Body>       
                    <GetOrderWithIntegrationCode xmlns="http://tempuri.org/">
                        <userName>${xmlKacis(userName)}</userName>
                        <password>${xmlKacis(password)}</password>
                        <integrationCode>${xmlKacis(integrationCode)}</integrationCode>
                    </GetOrderWithIntegrationCode>
               </soap:Body>
            </soap:Envelope>
            `;

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/soap+xml; charset=utf-8'
                    },
                    body: xmlPayload
                });

                const responseText = await response.text();

                // Read status. Aras, kayıt bulunamadığında bile "<Order>... Kayıt
                // Bulunamadı ...</Order>" şablonu döndürüyor; bu yüzden her iki
                // koşul da kontrol edilmeli. İptal edilen kayıt silinmez,
                // SpecialField3'e "İptal Tarihi" yazılır.
                if (!responseText.includes('<GetOrderWithIntegrationCodeResult>') ||
                    !responseText.includes('<Order>') ||
                    responseText.includes('Kayıt Bulunamadı')) {
                    // This order has not been sent to Aras Kargo yet.
                    orderDetails.push({ orderId: order.id, status: 'not_sent', response: responseText });
                    console.log(`[ARAS] Sipariş aktarılmamış (Sipariş ID: ${order.id})`);
                    continue;
                }

                if (responseText.includes('İptal Tarihi')) {
                    orderDetails.push({ orderId: order.id, status: 'cancelled', response: responseText });
                    console.log(`[ARAS] Sipariş iptal edilmiş (Sipariş ID: ${order.id})`);
                    continue;
                }

                orderDetails.push({ orderId: order.id, status: 'sent', response: responseText });
                console.log(`[ARAS] Sipariş aktarılmış (Sipariş ID: ${order.id})`);
            } catch (error) {
                console.error("[ARAS] Sunucu Hatası:", error);
                orderDetails.push({ orderId: order.id, status: 'error', error: String(error.message || error) });
            }
        }

        console.log("Aras Kargo sipariş durumu sorgulama tamamlandı:", orderDetails);
        callback(orderDetails);
    });
}

// SetOrder ile Aras sistemine yansıyıp yansımadığını kontrol eder.
// Dönüş: { sent: boolean, raw: string }
async function getOrderWithIntegrationCode(integrationCode) {
    const apiUrl = "https://customerws.araskargo.com.tr/arascargoservice.asmx"; // CANLI ORTAM
    const userName = config.env.ARAS_USERNAME;
    const password = config.env.ARAS_PASSWORD;

    if (!userName || !password) {
        throw new Error('Aras Kargo API bilgileri (.env) eksik.');
    }

    const xmlPayload = `
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="http://tempuri.org/">
       <soap:Header/>
       <soap:Body>
            <GetOrderWithIntegrationCode xmlns="http://tempuri.org/">
                <userName>${xmlKacis(userName)}</userName>
                <password>${xmlKacis(password)}</password>
                <integrationCode>${xmlKacis(integrationCode)}</integrationCode>
            </GetOrderWithIntegrationCode>
       </soap:Body>
    </soap:Envelope>
    `;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
        body: xmlPayload
    });
    const responseText = await response.text();
    const match = responseText.match(/<GetOrderWithIntegrationCodeResult>([\s\S]*?)<\/GetOrderWithIntegrationCodeResult>/);
    const raw = match ? match[1] : responseText;
    // Kayıt yoksa Aras "<Order><IntegrationCode>FZ-x Kayıt Bulunamadı.</IntegrationCode></Order>"
    // şablonu döndürüyor; bu yüzden yalnızca <Order> varlığına bakmak yanıltır.
    // İptal edilen kayıt silinmez; SpecialField3'e "İptal Tarihi: ..." yazılır (canlı testle doğrulandı).
    const sent = raw.includes('<Order>') && !raw.includes('Kayıt Bulunamadı');
    const cancelled = sent && raw.includes('İptal Tarihi');
    return { sent, cancelled, raw };
}

// SetOrder ile gönderilen kaydı iptal eder (irsaliyesi kesilmemişse).
// NOT: Canlı servis parametreyi <orderCode> değil <integrationCode> adıyla bekliyor
// (dökümandaki "orderCode" adıyla çağrılırsa -1 Kayıt Bulunamadı dönüyor; canlı testle doğrulandı).
// Dönüş kodları (döküman): 0 Başarılı · 1 "<kod> Başarılı bir şekilde silindi." ·
// -1 Kayıt bulunamadı · -2 Kullanıcı adı/şifre hatalı · 999 İrsaliyesi kesilmiş iptal edilemez · 936 Hata
async function cancelDispatch(integrationCode) {
    const apiUrl = "https://customerws.araskargo.com.tr/arascargoservice.asmx"; // CANLI ORTAM
    const userName = config.env.ARAS_USERNAME;
    const password = config.env.ARAS_PASSWORD;

    if (!userName || !password) {
        throw new Error('Aras Kargo API bilgileri (.env) eksik.');
    }

    const xmlPayload = `
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tem="http://tempuri.org/">
       <soap:Header/>
       <soap:Body>
          <CancelDispatch xmlns="http://tempuri.org/">
             <integrationCode>${xmlKacis(integrationCode)}</integrationCode>
             <userName>${xmlKacis(userName)}</userName>
             <password>${xmlKacis(password)}</password>
          </CancelDispatch>
       </soap:Body>
    </soap:Envelope>
    `;

    // Canlı servis ara sıra bağlantıyı sıfırlayabiliyor (ECONNRESET); ağ hatasında bir kez tekrar dene.
    let responseText = null;
    for (let deneme = 1; deneme <= 2; deneme++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
                body: xmlPayload
            });
            responseText = await response.text();
            break;
        } catch (e) {
            if (deneme === 2) throw e;
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    const match = responseText.match(/<CancelDispatchResult>([\s\S]*?)<\/CancelDispatchResult>/);
    const result = (match ? match[1] : responseText).trim();
    // Sonuç düz "0"/"1 ..." ya da <ResultCode>/<ResultMessage> sarmalı gelebiliyor.
    const rcMatch = result.match(/<ResultCode>\s*(-?\d+)\s*<\/ResultCode>/);
    const rmMatch = result.match(/<ResultMessage>([\s\S]*?)<\/ResultMessage>/);
    const code = rcMatch ? rcMatch[1] : result.split(/\s/)[0];
    const message = rmMatch ? rmMatch[1].trim() : result;
    const success = code === '0' || code === '1';
    return { success, code, message };
}

// Müşteri Bilgi Sorgulama Servisi (GetQueryJSON, QueryType=11): entegrasyon koduyla
// kargonun canlı durumunu döndürür. Bulunamazsa null.
async function queryCargoByIntegrationCode(integrationCode) {
    const userName = config.env.ARAS_QUERY_USERNAME;
    const password = config.env.ARAS_QUERY_PASSWORD;
    const customerCode = config.env.ARAS_MUSTERI_KODU || '2623003491526';

    if (!userName || !password) {
        throw new Error('Kargo sorgulama API bilgileri (.env) eksik.');
    }

    const loginInfo = `<LoginInfo><UserName>${xmlKacis(userName)}</UserName><Password>${xmlKacis(password)}</Password><CustomerCode>${xmlKacis(customerCode)}</CustomerCode></LoginInfo>`;
    const queryInfo = `<QueryInfo><QueryType>11</QueryType><IntegrationCode>${xmlKacis(integrationCode)}</IntegrationCode></QueryInfo>`;

    const soapPayload = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
       <soapenv:Header/>
       <soapenv:Body>
          <tem:GetQueryJSON>
             <tem:loginInfo><![CDATA[${cdataKacis(loginInfo)}]]></tem:loginInfo>
             <tem:queryInfo><![CDATA[${cdataKacis(queryInfo)}]]></tem:queryInfo>
          </tem:GetQueryJSON>
       </soapenv:Body>
    </soapenv:Envelope>`;

    const response = await fetch("https://customerservices.araskargo.com.tr/ArasCargoCustomerIntegrationService/ArasCargoIntegrationService.svc", {
        method: "POST",
        headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "http://tempuri.org/IArasCargoIntegrationService/GetQueryJSON"
        },
        body: soapPayload
    });

    const text = await response.text();
    const match = text.match(/<GetQueryJSONResult>([\s\S]*?)<\/GetQueryJSONResult>/);
    if (!match || !match[1]) return null;

    const cleanJsonStr = match[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const parsedData = JSON.parse(cleanJsonStr);
    if (parsedData && Array.isArray(parsedData.QueryResult) && parsedData.QueryResult.length > 0) {
        return parsedData.QueryResult[0];
    }
    return null;
}

module.exports = {
    xmlKacis,
    cdataKacis,
    sendToArasKargo,
    readArasKargoOrders,
    getOrderWithIntegrationCode,
    cancelDispatch,
    queryCargoByIntegrationCode
};