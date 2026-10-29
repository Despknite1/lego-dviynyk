// Надсилання листів (наприклад, для скидання пароля). SMS поки не підключено.
// Pluggable notifications. MAIL_PROVIDER = resend | smtp | console (dev only). SMS_PROVIDER = stub (not implemented).
const log = require('./log');
async function sendEmail(to, subject, text) {
  const p = (process.env.MAIL_PROVIDER || '').toLowerCase(), from = process.env.MAIL_FROM;
  if (p === 'resend') {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text }) });
    if (!r.ok) throw new Error('resend ' + r.status); return true;
  }
  if (p === 'smtp') {
    const nm = require('nodemailer');
    const t = nm.createTransport({ host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587), secure: +(process.env.SMTP_PORT || 587) === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
    await t.sendMail({ from, to, subject, text }); return true;
  }
  if (p === 'console' && process.env.NODE_ENV !== 'production') { log.warn({ evt: 'mail.dev_console', subject }, 'DEV mail (body below, never in production)'); process.stdout.write(`[dev-mail] ${subject}\n${text}\n`); return true; }
  throw new Error('email provider not configured');
}
async function sendSms(/* to, text */) { throw new Error('SMS provider not configured (stub)'); }
const emailReady = () => { const p = (process.env.MAIL_PROVIDER || '').toLowerCase(); return (p === 'resend' && !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM) || (p === 'smtp' && !!process.env.SMTP_HOST && !!process.env.MAIL_FROM) || (p === 'console' && process.env.NODE_ENV !== 'production'); };
const smsReady = () => false;
module.exports = { sendEmail, sendSms, emailReady, smsReady };
