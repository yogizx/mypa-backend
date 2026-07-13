'use strict';

const https = require('https');
const nodemailer = require('nodemailer');

let _transporter = null;

function _getTransporter() {
  if (_transporter) return _transporter;

  // 1) Custom SMTP (Gmail, etc.) — tried first because Resend free tier blocks
  //    sending to non-verified recipients
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    _transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log(`[Mailer] Using SMTP ${smtpHost}:${process.env.SMTP_PORT || 587}`);
    return _transporter;
  }

  // 2) SendGrid SMTP
  const sgKey = process.env.SENDGRID_API_KEY;
  if (sgKey) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: { user: 'apikey', pass: sgKey },
    });
    console.log('[Mailer] Using SendGrid');
    return _transporter;
  }

  // 3) Resend HTTPS API (last resort — free tier only sends to account owner)
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    _transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log(`[Mailer] Using SMTP ${smtpHost}:${process.env.SMTP_PORT || 587}`);
    return _transporter;
  }

  console.warn('[Mailer] No email provider configured — set RESEND_API_KEY, SENDGRID_API_KEY, or SMTP_HOST');
  return null;
}

async function _sendWithRetry(mailOptions, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    const t = _getTransporter();
    if (!t) {
      console.warn('[Mailer] Skipped — no transporter configured');
      return;
    }
    try {
      if (t.type === 'resend') {
        await _sendViaResend(t.key, mailOptions);
      } else {
        const info = await t.sendMail(mailOptions);
        console.log('[Mailer] Sent:', info.messageId);
      }
      return;
    } catch (err) {
      lastErr = err;
      console.error(`[Mailer] Attempt ${i + 1}/${retries} failed:`, err.message);
      if (i < retries - 1) {
        const delay = Math.pow(2, i) * 1000;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  console.error('[Mailer] All retries exhausted:', lastErr.message);
  throw lastErr;
}

function _sendViaResend(apiKey, mailOptions) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      html: mailOptions.html,
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('[Mailer] Resend sent:', body);
          resolve();
        } else {
          const err = new Error(`Resend API error ${res.statusCode}: ${body}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sendOtpEmail = async (to, otp, type = 'verify') => {
  const subject =
    type === 'reset'
      ? 'MY PA — Password Reset OTP'
      : 'MY PA — Verify Your Email';

  const heading =
    type === 'reset' ? 'Reset Your Password' : 'Verify Your Email Address';

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
      <h2 style="color:#6366f1;">${heading}</h2>
      <p>Use the OTP below. It expires in <strong>10 minutes</strong>.</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:12px;text-align:center;padding:24px;background:#f3f4f6;border-radius:8px;margin:24px 0;">
        ${otp}
      </div>
      <p style="color:#6b7280;font-size:13px;">If you didn't request this, ignore this email.</p>
    </div>
  `;

  const fromEmail = process.env.REMINDER_FROM_EMAIL || 'noreply@mypa.app';
  await _sendWithRetry({
    from: `"MY PA" <${fromEmail}>`,
    to,
    subject,
    html,
  });
};

const sendMeetingReminderEmail = async ({ to, userName, title, meetingTime, type }) => {
  const labels = {
    onCreate: 'Meeting Created',
    at30:     '30 Minutes Until Meeting',
    at15:     '15 Minutes Until Meeting',
    atStart:  'Meeting Starting Now',
  };
  const label = labels[type] || 'Meeting Reminder';

  const timeStr = meetingTime.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px;">
      <h2 style="color:#6366f1;">${label}</h2>
      <p>Hi <strong>${userName}</strong>,</p>
      <div style="padding:20px;background:#f3f4f6;border-radius:8px;margin:20px 0;">
        <p style="margin:0 0 8px;font-size:18px;font-weight:700;">${title}</p>
        <p style="margin:0;color:#6b7280;">${timeStr}</p>
      </div>
      ${type === 'atStart' ? '<p style="color:#059669;font-weight:600;">This meeting is starting now!</p>' : ''}
      ${type === 'onCreate' ? '<p style="color:#6b7280;font-size:13px;">Reminders will also be sent 30 min, 15 min, and at the start time.</p>' : ''}
      <p style="color:#6b7280;font-size:13px;">— MY PA</p>
    </div>
  `;

  const fromEmail = process.env.REMINDER_FROM_EMAIL || 'noreply@mypa.app';
  await _sendWithRetry({
    from: `"MY PA" <${fromEmail}>`,
    to,
    subject: `[MY PA] ${label}: ${title}`,
    html,
  });
};

module.exports = { sendOtpEmail, sendMeetingReminderEmail };
