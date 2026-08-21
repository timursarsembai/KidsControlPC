const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { auth } = require('./firebaseAdmin')
const { REGION, requireAuth, getAppBaseUrl } = require('./config')
const { getMailTransport } = require('./mailer')
const { buildVerificationEmailHtml, buildVerificationEmailText } = require('./emailTemplates/verificationEmail')

const sendVerificationEmail = onCall({ region: REGION, secrets: ['SMTP_PASS'] }, async (request) => {
  const uid = requireAuth(request)
  const userRecord = await auth.getUser(uid)

  if (userRecord.emailVerified) {
    throw new HttpsError('failed-precondition', 'Email already verified.')
  }

  getMailTransport()

  const continueUrl = `${getAppBaseUrl()}/action`
  const link = await auth.generateEmailVerificationLink(userRecord.email, { url: continueUrl, handleCodeInApp: false })

  const transport = getMailTransport()
  const from = process.env.MAIL_FROM || process.env.SMTP_USER
  const templateData = { email: userRecord.email, link }

  await transport.sendMail({
    from,
    to: userRecord.email,
    subject: 'Подтвердите ваш email — KidsControlPC',
    text: buildVerificationEmailText(templateData),
    html: buildVerificationEmailHtml(templateData)
  })
})

module.exports = { sendVerificationEmail }
