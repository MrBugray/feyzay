// E-posta gönderimi (nodemailer).
const nodemailer = require('nodemailer');
const config = require('../config');

const transporter = nodemailer.createTransport({
    host: config.env.SMTP_HOST || 'smtp.gmail.com',
    port: config.env.SMTP_PORT || 587,
    secure: false, // 587 portu için false olmalı
    auth: {
        user: config.env.SMTP_USER,
        pass: config.env.SMTP_PASS
    }
});

async function sendMail(to, subject, htmlContent) {
    if (!config.env.SMTP_USER) return false;
    try {
        await transporter.sendMail({
            from: `"Feyzay" <${config.env.SMTP_USER}>`,
            to,
            subject,
            html: htmlContent
        });
        console.log(`[MAIL] ${to} adresine e-posta gönderildi: ${subject}`);
        return true;
    } catch (err) {
        console.error(`[MAIL HATASI] Gönderilemedi:`, err.message);
        return false;
    }
}

module.exports = { sendMail };
