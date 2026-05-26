const BRAND = "Signpack Maker";
const ACCENT = "#ffa500";
const HEADER_BG = "#1c1c1c";
const LOGO_URL =
  "https://gamearoo.top/ram-api-img/bc91c29e-d0af-460f-a30e-541cd5b57179.png";

function supportEmail() {
  return require("../config").supportEmail;
}

function footerBlock() {
  const support = supportEmail();
  return `
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e8e8e8;color:#777777;font-size:13px;line-height:1.5;text-align:center;">
      You received this because you use ${BRAND}.
    </p>
    <p style="margin:8px 0 0;color:#777777;font-size:13px;text-align:center;">
      Support: <a href="mailto:${support}" style="color:${ACCENT};text-decoration:none;">${support}</a>
    </p>
  `;
}

function emailShell({ title, bodyHtml, preheader }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0f0f0f;font-family:Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;">${preheader || title}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0f0f0f;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#f8f8f8;border-radius:12px;overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,0.4);">
          <tr>
            <td style="background-color:${HEADER_BG};padding:28px 24px;text-align:center;border-bottom:4px solid ${ACCENT};">
              <img src="${LOGO_URL}" alt="${BRAND}" width="72" height="72" style="display:block;margin:0 auto 12px;border-radius:8px;" />
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:#ffffff;font-weight:700;">${BRAND}</h1>
              <p style="margin:8px 0 0;font-size:12px;color:#aaaaaa;">Traffic Control Mod</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px;background-color:#ffffff;color:#333333;font-size:16px;line-height:1.55;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;background-color:#ffffff;">
              ${footerBlock()}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function plainFooter() {
  return [
    "",
    `You received this because you use ${BRAND}.`,
    `Support: ${supportEmail()}`,
  ].join("\n");
}

function otpEmail(code) {
  const subject = `Your verification code for ${BRAND}`;
  const text = [
    `${BRAND} — verification code`,
    "",
    `Your one-time code: ${code}`,
    "",
    "Enter this code on the login page to continue.",
    "If you did not request this code, you can safely ignore this email.",
    plainFooter(),
  ].join("\n");

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#1c1c1c;">Your verification code</h2>
    <p style="margin:0 0 20px;color:#555555;">Use this code to finish signing in to <strong>${BRAND}</strong>.</p>
    <div style="text-align:center;margin:24px 0;">
      <div style="display:inline-block;padding:16px 28px;background-color:#1c1c1c;border-radius:10px;border:2px solid ${ACCENT};">
        <span style="font-size:32px;font-weight:700;letter-spacing:6px;color:${ACCENT};font-family:Consolas,Monaco,monospace;">${code}</span>
      </div>
    </div>
    <p style="margin:0;color:#555555;font-size:14px;">Never share this code. It expires after use.</p>
  `;

  return {
    subject,
    text,
    html: emailShell({ title: subject, preheader: `Your code is ${code}`, bodyHtml }),
  };
}

function resetPasswordEmail(resetLink) {
  const subject = `${BRAND} — reset your password`;
  const text = [
    `${BRAND} — password reset`,
    "",
    "Open this link to reset your password:",
    resetLink,
    "",
    "If you did not request this, ignore this email.",
    plainFooter(),
  ].join("\n");

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#1c1c1c;">Reset your password</h2>
    <p style="margin:0 0 20px;color:#555555;">We received a request to reset your <strong>${BRAND}</strong> password.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${resetLink}" style="display:inline-block;padding:14px 28px;background-color:${ACCENT};color:#1c1c1c;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;">Reset password</a>
    </div>
    <p style="margin:0;word-break:break-all;font-size:13px;color:#666666;"><a href="${resetLink}" style="color:${ACCENT};">${resetLink}</a></p>
  `;

  return {
    subject,
    text,
    html: emailShell({ title: subject, preheader: "Reset your password", bodyHtml }),
  };
}

function passwordChangedEmail() {
  const subject = `${BRAND} — password changed`;
  const text = [
    `${BRAND} — password changed`,
    "",
    "Your password was changed successfully.",
    "If you did not make this change, contact support immediately.",
    plainFooter(),
  ].join("\n");

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#1c1c1c;">Password updated</h2>
    <p style="margin:0 0 16px;color:#555555;">Your <strong>${BRAND}</strong> password was changed successfully.</p>
    <p style="margin:0;color:#555555;font-size:14px;">If you did not make this change, contact support right away.</p>
  `;

  return {
    subject,
    text,
    html: emailShell({ title: subject, preheader: "Your password was changed", bodyHtml }),
  };
}

function accountDeletedEmail() {
  const subject = `${BRAND} — account deleted`;
  const text = [
    `${BRAND} — account deleted`,
    "",
    "Your account and associated signpack data on the website have been deleted.",
    "This action cannot be undone.",
    plainFooter(),
  ].join("\n");

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#1c1c1c;">Account deleted</h2>
    <p style="margin:0 0 16px;color:#555555;">Your <strong>${BRAND}</strong> account has been permanently deleted, including website-stored signpacks.</p>
    <p style="margin:0;color:#555555;font-size:14px;">If you did not request this, contact support immediately.</p>
  `;

  return {
    subject,
    text,
    html: emailShell({ title: subject, preheader: "Your account was deleted", bodyHtml }),
  };
}

function welcomeEmail({ name, loginUrl }) {
  const subject = `Welcome to ${BRAND}`;
  const text = [
    `Welcome to ${BRAND}${name ? ", " + name : ""}!`,
    "",
    "Your account is ready. Sign in to create and manage signpacks for the Traffic Control Mod.",
    loginUrl ? `Sign in: ${loginUrl}` : "",
    plainFooter(),
  ].filter(Boolean).join("\n");

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#1c1c1c;">Welcome${name ? ", " + name : ""}!</h2>
    <p style="margin:0 0 20px;color:#555555;">Thanks for joining <strong>${BRAND}</strong>. You can start building signpacks for the Traffic Control Mod in the web editor or desktop app.</p>
    ${loginUrl ? `<div style="text-align:center;margin:24px 0;"><a href="${loginUrl}" style="display:inline-block;padding:14px 28px;background-color:${ACCENT};color:#1c1c1c;font-size:16px;font-weight:700;text-decoration:none;border-radius:8px;">Open Signpack Maker</a></div>` : ""}
  `;

  return {
    subject,
    text,
    html: emailShell({ title: subject, preheader: "Welcome to Signpack Maker", bodyHtml }),
  };
}

/** Generic security/support notice template for future use */
function securityNoticeEmail({ title, message, actionUrl, actionLabel }) {
  const subject = `${BRAND} — ${title}`;
  const text = [title, "", message, actionUrl || "", plainFooter()].filter(Boolean).join("\n");

  const bodyHtml = `
    <h2 style="margin:0 0 12px;font-size:20px;color:#1c1c1c;">${title}</h2>
    <p style="margin:0 0 16px;color:#555555;">${message}</p>
    ${actionUrl && actionLabel ? `<div style="text-align:center;margin:24px 0;"><a href="${actionUrl}" style="display:inline-block;padding:12px 24px;background-color:${ACCENT};color:#1c1c1c;font-weight:700;text-decoration:none;border-radius:8px;">${actionLabel}</a></div>` : ""}
  `;

  return {
    subject,
    text,
    html: emailShell({ title: subject, preheader: title, bodyHtml }),
  };
}

module.exports = {
  otpEmail,
  resetPasswordEmail,
  passwordChangedEmail,
  accountDeletedEmail,
  welcomeEmail,
  securityNoticeEmail,
  supportEmail,
};
