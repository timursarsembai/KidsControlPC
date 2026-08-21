const { escapeHtml } = require('../mailer')

function buildVerificationEmailHtml({ email, link }) {
  const safeEmail = escapeHtml(email)
  const safeLink = escapeHtml(link)

  return `
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Подтверждение email — KidsControlPC</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f5f9;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">Подтвердите ваш email, чтобы начать пользоваться KidsControlPC.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e6e9f2;box-shadow:0 18px 45px rgba(15,23,42,.08);">
            <tr>
              <td style="padding:28px 28px 18px;background:#111827;">
                <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.02em;">KidsControl<span style="display:inline-block;margin-left:5px;padding:2px 7px;border-radius:999px;background:#635bff;color:#ffffff;font-size:12px;vertical-align:middle;">PC</span></div>
                <div style="margin-top:8px;color:#c7d2fe;font-size:14px;">Подтверждение email</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px;">
                <div style="margin:0 0 20px;width:56px;height:56px;border-radius:50%;background:#f0f0ff;display:flex;align-items:center;justify-content:center;">
                  <span style="font-size:28px;">✉️</span>
                </div>
                <h1 style="margin:0 0 12px;color:#111827;font-size:22px;line-height:1.3;font-weight:800;">Подтвердите ваш email</h1>
                <p style="margin:0 0 8px;color:#4b5563;font-size:15px;line-height:1.6;">Вы зарегистрировались в <strong>KidsControlPC</strong>.</p>
                <p style="margin:0 0 28px;color:#4b5563;font-size:15px;line-height:1.6;">Нажмите кнопку ниже, чтобы подтвердить адрес:</p>
                <div style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;">Email</div>
                <div style="margin:0 0 28px;font-size:15px;font-weight:700;color:#111827;word-break:break-all;">${safeEmail}</div>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 28px;">
                  <tr>
                    <td style="border-radius:12px;background:#635bff;">
                      <a href="${safeLink}" style="display:inline-block;padding:16px 28px;color:#ffffff;text-decoration:none;font-size:16px;font-weight:800;letter-spacing:-.01em;">Подтвердить email →</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 12px;color:#6b7280;font-size:13px;line-height:1.6;">Ссылка действует 24 часа. Если вы не регистрировались в KidsControlPC — просто проигнорируйте это письмо.</p>
                <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">Если кнопка не работает, скопируйте ссылку в браузер:<br><a href="${safeLink}" style="color:#4f46e5;word-break:break-all;">${safeLink}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e5e7eb;">
                <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© KidsControlPC · Родительский контроль</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
}

function buildVerificationEmailText({ link }) {
  return [
    'Подтвердите ваш email, чтобы начать пользоваться KidsControlPC.',
    '',
    `Перейдите по ссылке: ${link}`,
    '',
    'Ссылка действует 24 часа. Если вы не регистрировались — проигнорируйте письмо.'
  ].join('\n')
}

module.exports = { buildVerificationEmailHtml, buildVerificationEmailText }
