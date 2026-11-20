import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
    to: string;
    subject: string;
    /** Plain text; an HTML version is made from it */
    text: string;
}

/**
 * Optional bonus: sends emails (ACC-02 verification, ACC-07 password reset, email notifications).
 *
 * Configure SMTP in backend/.env (for example a Gmail account with an App Password):
 *   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_SECURE=true
 *   SMTP_USER=you@gmail.com   SMTP_PASS=<16-letter app password>
 *   MAIL_FROM="Travel Platform <you@gmail.com>"
 * Without SMTP_HOST nothing is sent: each email is printed in the server log instead,
 * so links can still be copied from the terminal while developing.
 * Sending never throws: a failed email is logged and the action that caused it continues.
 */
@Injectable()
export class MailService {
    private readonly logger = new Logger('Mail');
    private readonly transporter: Transporter | null;
    private readonly from: string;

    constructor(private readonly config: ConfigService) {
        const host = this.config.get<string>('SMTP_HOST');
        const port = Number(this.config.get('SMTP_PORT') ?? 587);
        this.from = this.config.get<string>('MAIL_FROM') || this.config.get<string>('SMTP_USER') || 'Travel Platform <no-reply@travel.local>';
        this.transporter = host
            ? createTransport({
                host,
                port,
                secure: String(this.config.get('SMTP_SECURE') ?? port === 465) === 'true',
                auth: this.config.get('SMTP_USER')
                    ? { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') }
                    : undefined,
            })
            : null;
        if (!this.transporter) {
            this.logger.log('SMTP is not configured: emails are printed here instead of being sent');
        }
    }

    get isConfigured() {
        return !!this.transporter;
    }

    /** The public address of this backend, used in email links (e.g. http://localhost:3000) */
    get baseUrl(): string {
        const url = this.config.get<string>('APP_URL') || `http://localhost:${this.config.get('PORT') ?? 3000}`;
        return url.replace(/\/$/, '');
    }

    async send(message: MailMessage): Promise<boolean> {
        if (!this.transporter) {
            this.logger.log(`[not sent] To: ${message.to} | Subject: ${message.subject}\n${message.text}`);
            return false;
        }
        try {
            await this.transporter.sendMail({
                from: this.from,
                to: message.to,
                subject: message.subject,
                text: message.text,
                html: toHtml(message.text),
            });
            return true;
        } catch (err) {
            this.logger.error(`Could not email ${message.to}: ${(err as Error).message}`);
            return false;
        }
    }
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Paragraphs from blank lines, clickable links */
function toHtml(text: string): string {
    const body = escape(text)
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`)
        .join('');
    return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}</div>`;
}
