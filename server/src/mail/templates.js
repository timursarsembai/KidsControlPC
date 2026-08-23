// The two letters this backend sends.
//
// Plain text first, HTML as a courtesy: these arrive at people who are dealing
// with a lost password, often on a phone, and a message that renders as a wall
// of broken markup in some client is worse than no markup at all.
//
// Russian only for now. The panel is bilingual (ru/kk), and these should follow
// once there is a mailbox to send them from and someone to check the wording —
// a clumsy translation in a security email reads as a scam.

const BRAND = 'KidsControlPC'

function layout(title, body, action) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2430">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
    <div style="font-size:18px;font-weight:600;margin-bottom:16px">${title}</div>
    <div style="font-size:15px;line-height:1.55;color:#3b4252">${body}</div>
    ${action ? `<div style="margin:24px 0"><a href="${action.url}" style="display:inline-block;background:#2f6fed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${action.label}</a></div>
    <div style="font-size:13px;color:#6b7280;word-break:break-all">Если кнопка не работает, откройте ссылку вручную:<br>${action.url}</div>` : ''}
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9099a8">${BRAND}</div>
  </div>
</body></html>`
}

export function passwordResetEmail({ url, ttlMinutes }) {
  const text = [
    'Восстановление пароля в KidsControlPC.',
    '',
    `Чтобы задать новый пароль, откройте ссылку (действует ${ttlMinutes} минут):`,
    url,
    '',
    // Said plainly: someone who did not ask for this needs to know whether to
    // worry, and the honest answer is that nothing has happened yet.
    'Если вы не запрашивали восстановление, просто удалите это письмо —',
    'пароль останется прежним, ссылка сама перестанет работать.'
  ].join('\n')

  return {
    subject: 'Восстановление пароля — KidsControlPC',
    text,
    html: layout(
      'Восстановление пароля',
      `<p>Чтобы задать новый пароль, нажмите кнопку ниже. Ссылка действует ${ttlMinutes} минут.</p>
       <p style="color:#6b7280">Если вы не запрашивали восстановление, просто удалите это письмо — пароль останется прежним.</p>`,
      { url, label: 'Задать новый пароль' }
    )
  }
}

export function emailVerificationEmail({ url, ttlHours }) {
  const text = [
    'Подтверждение адреса в KidsControlPC.',
    '',
    `Откройте ссылку, чтобы подтвердить адрес (действует ${ttlHours} ч):`,
    url,
    '',
    'Если вы не создавали аккаунт, удалите это письмо.'
  ].join('\n')

  return {
    subject: 'Подтвердите адрес — KidsControlPC',
    text,
    html: layout(
      'Подтвердите адрес',
      `<p>Остался один шаг. Ссылка действует ${ttlHours} часов.</p>
       <p style="color:#6b7280">Если вы не создавали аккаунт, удалите это письмо.</p>`,
      { url, label: 'Подтвердить адрес' }
    )
  }
}
