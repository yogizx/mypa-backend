'use strict';

const nodemailer = require('nodemailer');

/**
 * ── IMPORTANT: Render free-tier instances block ALL outbound SMTP ports
 *    (25, 465, 587) as of Sept 26, 2025 — this is a hard network-level
 *    firewall rule, not a provider-specific issue. It applies to Gmail,
 *    Resend, SendGrid, or any other SMTP host equally.
 *
 * ── Fix: use Resend's HTTPS REST API instead of SMTP. HTTPS (443) is not
 *    blocked. Set RESEND_API_KEY in the Render dashboard and this file will
 *    automatically send via the API instead of SMTP.
 *
 * ── Local development fallback: if RESEND_API_KEY is not set, this falls
 *    back to SMTP via nodemailer (Gmail works fine here since your local
 *    machine's outbound ports aren't blocked).
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendViaResendApi({ to, from, subject, html, text }) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }

  return res.json();
}

function createSmtpTransport() {
  const host = (process.env.SMTP_HOST || '').trim().toLowerCase();

  if (host === 'smtp.resend.com') {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 587,
      secure: false,
      auth: { user: 'resend', pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }

  if (host === 'smtp.sendgrid.net') {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      auth: { user: 'apikey', pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }

  return nodemailer.createTransport({
    host: host || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 465,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
    },
  });
}

let _smtpTransporter = null;
function getSmtpTransporter() {
  if (!_smtpTransporter) {
    _smtpTransporter = createSmtpTransport();
    _smtpTransporter.verify()
      .then((ok) => {
        if (ok) console.log('[Mailer] SMTP server is ready.');
      })
      .catch((err) => {
        console.error('[Mailer] SMTP verify error:', err.message);
        console.warn('  → If deployed on Render, this is expected: free-tier Render blocks outbound SMTP ports entirely. Set RESEND_API_KEY instead.');
      });
  }
  return _smtpTransporter;
}

if (RESEND_API_KEY) {
  console.log('[Mailer] Using Resend HTTPS API for email delivery.');
} else {
  console.log('[Mailer] RESEND_API_KEY not set — falling back to SMTP (local dev only).');
  console.log('[Mailer] This will fail on Render free tier because outbound SMTP ports are blocked.');
}

async function _send({ to, subject, html, text }) {
  const from = `MY PA <${process.env.REMINDER_FROM_EMAIL || 'noreply@mypa.app'}>`;

  if (RESEND_API_KEY) {
    await sendViaResendApi({ to, from, subject, html, text });
    return;
  }

  await getSmtpTransporter().sendMail({ from, to, subject, html, text });
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

  const text = `${heading}

${type === 'reset' ? 'We received a request to reset your password.' : 'Thank you for creating an account with MY PA.'} Use the code below to complete this step. It expires in 10 minutes.

${otp}

If you didn't request this, you can safely ignore this email.

---
MY PA — Your Personal Assistant`;

  await _send({ to, subject, html, text });
};

const sendMeetingReminderEmail = async ({ to, userName, title, meetingTime, type }) => {
  const labels = {
    onCreate: 'Meeting Created',
    at30: '30 Minutes Until Meeting',
    at15: '15 Minutes Until Meeting',
    atStart: 'Meeting Starting Now',
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

  await _send({
    to,
    subject: `[MY PA] ${label}: ${title}`,
    html,
    text: `${label}\n\n${title}\n${timeStr}\n\n— MY PA`,
  });
};

module.exports = { sendOtpEmail, sendMeetingReminderEmail };