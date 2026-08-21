const { escapeHtml } = require('../mailer')

function buildPasswordSection(safePassword, hasTemporaryPassword) {
  return hasTemporaryPassword
    ? `
      <div style="margin:24px 0;padding:18px 20px;border-radius:14px;background:#111827;border:1px solid #5b6cff;">
        <div style="margin:0 0 10px;color:#aeb7ff;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Временный пароль</div>
        <div style="font-family:Consolas,Menlo,Monaco,monospace;font-size:26px;line-height:1.25;font-weight:800;letter-spacing:.08em;color:#ffffff;word-break:break-all;">${safePassword}</div>
      </div>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;line-height:1.6;">Используйте этот пароль только для принятия приглашения. После подтверждения приложение попросит задать новый пароль.</p>
    `
    : `
      <div style="margin:24px 0;padding:16px 18px;border-radius:14px;background:#f3f4f6;border:1px solid #e5e7eb;color:#374151;font-size:14px;line-height:1.6;">
        Используйте ваш текущий пароль KidsControlPC, чтобы принять приглашение.
      </div>
    `
}

// Renders the HTML body for the parent-invitation email.
function buildInvitationEmailHtml({ email, ownerEmail, link, temporaryPassword, expiresAtText }) {
  const safeOwnerEmail = escapeHtml(ownerEmail || 'Родитель KidsControlPC')
  const safeEmail = escapeHtml(email)
  const safeLink = escapeHtml(link)
  const safePassword = escapeHtml(temporaryPassword)
  const passwordHtml = buildPasswordSection(safePassword, Boolean(temporaryPassword))

  return `
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Приглашение KidsControlPC</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f5f9;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">${safeOwnerEmail} приглашает вас управлять устройствами семьи в KidsControlPC.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f9;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e6e9f2;box-shadow:0 18px 45px rgba(15,23,42,.08);">
            <tr>
              <td style="padding:28px 28px 18px;background:#111827;">
                <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.02em;">KidsControl<span style="display:inline-block;margin-left:5px;padding:2px 7px;border-radius:999px;background:#635bff;color:#ffffff;font-size:12px;vertical-align:middle;">PC</span></div>
                <div style="margin-top:8px;color:#c7d2fe;font-size:14px;">Приглашение родителя</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 14px;color:#111827;font-size:24px;line-height:1.25;">Вас пригласили в KidsControlPC</h1>
                <p style="margin:0 0 22px;color:#4b5563;font-size:15px;line-height:1.6;">${safeOwnerEmail} приглашает вас управлять устройствами семьи.</p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;border-collapse:separate;border-spacing:0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;">
                  <tr>
                    <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;">
                      <div style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Владелец</div>
                      <div style="margin-top:5px;color:#111827;font-size:15px;font-weight:700;word-break:break-word;">${safeOwnerEmail}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="color:#6b7280;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;">Ваш email</div>
                      <div style="margin-top:5px;color:#111827;font-size:15px;font-weight:700;word-break:break-word;">${safeEmail}</div>
                    </td>
                  </tr>
                </table>

                ${passwordHtml}

                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:12px;background:#635bff;">
                      <a href="${safeLink}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;">Открыть приглашение</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 14px;color:#6b7280;font-size:13px;line-height:1.6;">Приглашение действует до ${escapeHtml(expiresAtText)}. Если вы не примете его, приглашение и временный аккаунт будут удалены автоматически.</p>
                <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">Если кнопка не открывается, скопируйте ссылку в браузер:<br><a href="${safeLink}" style="color:#4f46e5;word-break:break-all;">${safeLink}</a></p>
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

function buildInvitationEmailText({ ownerEmail, link, temporaryPassword, expiresAtText }) {
  const passwordBlock = temporaryPassword
    ? `\nВременный пароль: ${temporaryPassword}\nИспользуйте его только для принятия приглашения. После подтверждения приложение попросит задать новый пароль.\n`
    : '\nИспользуйте ваш текущий пароль KidsControlPC, чтобы принять приглашение.\n'

  return [
    `${ownerEmail || 'Родитель KidsControlPC'} приглашает вас управлять устройствами семьи в KidsControlPC.`,
    '',
    `Откройте ссылку, чтобы принять или отклонить приглашение: ${link}`,
    passwordBlock,
    `Приглашение действует до ${expiresAtText}. Если вы не примете его, приглашение и временный аккаунт будут удалены автоматически.`,
    '',
    'Если вы не ожидали это приглашение, проигнорируйте письмо или отклоните приглашение по ссылке.'
  ].join('\n')
}

module.exports = { buildInvitationEmailHtml, buildInvitationEmailText }
