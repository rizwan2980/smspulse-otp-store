const nodemailer = require('nodemailer');
const { readData } = require('../db');

function getGmailTransporter() {
  const pass = process.env.GMAIL_APP_PASS || Buffer.from('bGdhbWJmbWRhcmtuaXdhcw==', 'base64').toString('utf8');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'rizwansaeed2980@gmail.com',
      pass: pass
    }
  });
}

function getResendKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY.trim();
  try {
    const settings = readData('settings');
    if (settings && settings.resendApiKey) return settings.resendApiKey.trim();
  } catch (e) {}
  return Buffer.from('cmVfOEhRNzhUbmFfS2FOa25zdjk4ZkcyNTZTRjFycGVnMXA1', 'base64').toString('utf8');
}

async function sendViaResend(toEmail, subject, html) {
  const apiKey = getResendKey();
  if (!apiKey) return { success: false, error: 'No Resend API key' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SMSPulse Security <onboarding@resend.dev>',
        to: [toEmail],
        subject: subject,
        html: html
      })
    });
    const data = await res.json();
    if (res.ok && data.id) {
      console.log(`[RESEND EMAIL DELIVERED] To: ${toEmail} | ID: ${data.id}`);
      return { success: true, id: data.id };
    } else {
      return { success: false, error: data.message };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendVerificationEmail(toEmail, code, type = 'Verification') {
  const subject = `🔐 ${code} is your SMSPulse ${type} Code`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 28px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: #ffffff; box-shadow: 0 4px 16px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #0284c7; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">SMSPulse</h2>
        <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Virtual Numbers & Instant SMS Verification</p>
      </div>

      <div style="padding: 24px 20px; background: #f8fafc; border-radius: 12px; text-align: center; border: 1px solid #e2e8f0;">
        <p style="color: #334155; font-size: 15px; margin: 0 0 12px 0; font-weight: 600;">Your 6-Digit ${type} Code is:</p>
        <div style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 900; letter-spacing: 10px; color: #0284c7; margin: 16px 0; padding: 12px 16px; background: #ffffff; border: 2px dashed #0284c7; border-radius: 10px; display: inline-block;">${code}</div>
        <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 12px 0 0 0;">
          This code is valid for <strong>10 minutes</strong>. Do NOT share this code with anyone.<br>
          If you did not request this verification, please ignore this email.
        </p>
      </div>

      <div style="margin-top: 24px; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        <span style="font-size: 11px; color: #94a3b8;">© ${new Date().getFullYear()} SMSPulse Security Team. All rights reserved.</span>
      </div>
    </div>
  `;

  // 1. Primary: Official Gmail SMTP Engine (100% inbox delivery to ALL recipients)
  try {
    const transporter = getGmailTransporter();
    const info = await transporter.sendMail({
      from: '"SMSPulse Security" <rizwansaeed2980@gmail.com>',
      to: toEmail,
      subject,
      html
    });
    console.log(`[GMAIL SMTP DELIVERED] To: ${toEmail} | MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[GMAIL SMTP ERROR] Failed sending to ${toEmail}:`, err.message);
  }

  // 2. Secondary: Resend API fallback
  const resendResult = await sendViaResend(toEmail, subject, html);
  if (resendResult && resendResult.success) {
    return resendResult;
  }

  return { success: false, reason: 'Failed to deliver email via Gmail and Resend' };
}

module.exports = {
  sendVerificationEmail,
  getGmailTransporter
};
