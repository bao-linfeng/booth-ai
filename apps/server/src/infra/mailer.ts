import { createTransport } from 'nodemailer';
import type { SmtpConfig } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export type MailSender = (message: MailMessage) => Promise<void>;

export class MailDeliveryError extends Error {
  // permanent：收件地址或内容被服务器拒绝（5xx），重试无意义
  constructor(
    public readonly code: string,
    public readonly permanent: boolean,
  ) {
    super(code);
  }
}

// 单封最坏耗时：连接 10 秒 + 问候 10 秒 + socket 空闲 20 秒，另留余量；投递批次据此判断租约内还能否再发一封
export const SMTP_MAX_SEND_MS = 45_000;

export function createSmtpSender(smtp: SmtpConfig): MailSender {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? '' } } : {}),
  });
  return async message => {
    try {
      // 收件人以地址对象传入，避免被当作逗号分隔的多收件人列表解析
      await transport.sendMail({
        from: smtp.from,
        to: { name: '', address: message.to },
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      const responseCode = (error as { responseCode?: unknown }).responseCode;
      const code = (error as { code?: unknown }).code;
      const permanent = code === 'EENVELOPE' || (typeof responseCode === 'number' && responseCode >= 550 && responseCode <= 553);
      throw new MailDeliveryError(
        typeof code === 'string' && /^[A-Z0-9_]{2,64}$/.test(code) ? `SMTP_${code}`.slice(0, 64) : 'SMTP_UNAVAILABLE',
        permanent,
      );
    }
  };
}
