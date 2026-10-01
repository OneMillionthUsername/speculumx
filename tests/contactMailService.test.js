/** @jest-environment node */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn();
jest.unstable_mockModule('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));
jest.unstable_mockModule('../config/config.js', () => ({
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  SMTP_USER: '',
  SMTP_PASS: '',
  SMTP_TLS_REJECT_UNAUTHORIZED: true,
  SMTP_CLIENT_NAME: 'mail.example.com',
  CONTACT_FORM_TO: 'owner@example.com',
  CONTACT_FORM_FROM: 'no-reply@example.com',
  CONTACT_FORM_SUBJECT_PREFIX: '[Blog Kontakt]',
  COMMENT_NOTIFY_ENABLED: true,
  COMMENT_NOTIFY_TO: '',
  COMMENT_NOTIFY_SUBJECT_PREFIX: '[Neuer Kommentar]',
}));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { default: contactMailService } = await import('../services/contactMailService.js');

const contact = {
  name: 'Max',
  email: 'max@example.com',
  message: 'Hallo, eine Testnachricht.',
  ip: '203.0.113.1',
  userAgent: 'jest',
};

describe('contactMailService', () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    // The transporter is cached after the first mail, so only the first call reaches this
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
  });

  it('creates the transport with TLS verification and the client name for EHLO/HELO', async () => {
    await contactMailService.sendContactMail(contact);

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      name: 'mail.example.com',
      tls: { rejectUnauthorized: true },
    }));
  });

  it('sends the contact mail from the recipient address and keeps the visitor in Reply-To', async () => {
    await contactMailService.sendContactMail(contact);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.from).toEqual({ name: 'Blog Kontakt', address: 'owner@example.com' });
    expect(mail.to).toBe('owner@example.com');
    expect(mail.replyTo).toBe('max@example.com');
    expect(mail.subject).toBe('[Blog Kontakt] Max');
  });

  it('does not let the visitor influence the sender address', async () => {
    await contactMailService.sendContactMail({ ...contact, email: 'evil@example.org', name: 'Eve\r\nBcc: x@example.org' });

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.from.address).toBe('owner@example.com');
    expect(mail.replyTo).toBe('evil@example.org');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('keeps the configured sender for comment notifications, without Reply-To', async () => {
    await contactMailService.sendCommentNotificationMail({
      postId: 7,
      postTitle: 'Ein Beitrag',
      postUrl: 'https://example.com/blogpost/id/7',
      username: 'Anna',
      text: 'Ein Kommentar',
      ip: '203.0.113.2',
      userAgent: 'jest',
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.from).toBe('no-reply@example.com');
    expect(mail.to).toBe('owner@example.com');
    expect(mail).not.toHaveProperty('replyTo');
    expect(mail.subject).toBe('[Neuer Kommentar] Ein Beitrag');
  });
});
