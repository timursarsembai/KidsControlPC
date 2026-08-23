// Outgoing mail.
//
// Deliberately optional: until kidscontrol.kz is delegated there is no mailbox
// to send from, and the service has to run without one. When SMTP is not
// configured, sending is a no-op that says so in the log — the routes above
// still behave correctly, they simply have nothing to deliver.
//
// It also must never take a request down. A parent asking to recover their
// password gets the same answer whether or not the mail server is reachable;
// the alternative leaks which addresses are registered and turns a mail outage
// into a broken sign-in page.

import { config } from '../config.js'

let transportPromise = null

export const mailEnabled = Boolean(config.smtp.host && config.smtp.from)

async function transport() {
  if (!mailEnabled) return null
  if (!transportPromise) {
    transportPromise = (async () => {
      const { default: nodemailer } = await import('nodemailer')
      return nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this wrong
        // fails in a way that reads like a wrong password.
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
      })
    })()
  }
  return transportPromise
}

/**
 * Sends one message. Returns true if it went out.
 *
 * Never throws: callers are request handlers whose answer must not depend on
 * the mail server being up.
 */
export async function sendMail({ to, subject, text, html }, log) {
  if (!to) {
    // Caught once already: the template carries the subject and body, and the
    // recipient has to come from the caller. Missing it produced a cheerful
    // "ok" to the parent and nothing in their inbox.
    log?.error(`refusing to send "${subject}": no recipient`)
    return false
  }
  if (!mailEnabled) {
    log?.warn(`mail not configured — "${subject}" to ${to} was not sent`)
    return false
  }
  try {
    const mailer = await transport()
    await mailer.sendMail({ from: config.smtp.from, to, subject, text, html })
    return true
  } catch (err) {
    log?.error(`could not send "${subject}" to ${to}: ${err.message}`)
    return false
  }
}
