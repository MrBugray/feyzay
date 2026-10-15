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

    const waybillNo = "FZ" + Date.now().toString().slice(-6) + orderId;
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
            db.run(`UPDATE orders SET cargo_state = 1, aras_waybill = ?, cargo_tracking_code = ?, aras_error = NULL WHERE id = ?`,
                [waybillNo, waybillNo, orderId]);
            console.log(`[ARAS] Sipariş aktarımı BAŞARILI (Sipariş ID: ${orderId}, Takip: ${waybillNo})`);
            return responseText;
        }

        const hata = responseText.slice(0, 500);
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, [hata, orderId]);
        console.error(`[ARAS] Aktarım HATASI (Sipariş ID: ${orderId}):`, responseText);
        return null;
    } catch (error) {
        db.run(`UPDATE orders SET aras_error = ? WHERE id = ?`, [String(error.message || error), orderId]);
        console.error("[ARAS] Sunucu Hatası:", error);
        return null;
    }
}

module.exports = { xmlKacis, cdataKacis, sendToArasKargo };
