/**
 * Outgoing mail. Uses SMTP when it's configured; otherwise writes each
 * message to the server log, so email logins work in development.
 */

import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  const smtp = config.smtp;
  if (!smtp) {
    log.warn('Neither MAILTRAP_TOKEN nor SMTP_HOST is set; email login codes will be written to this log');
    return {
      async send(to, subject, text) {
        log.info({ to, subject }, `Email (not sent, no SMTP): ${text}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}
