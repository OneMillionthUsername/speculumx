/** @jest-environment node */
import { describe, it, expect, jest } from '@jest/globals';

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

describe('contactMailService transport', () => {
  it('passes the TLS certificate verification setting to nodemailer', async () => {
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });

    await contactMailService.sendContactMail({
      name: 'Max',
      email: 'max@example.com',
      message: 'Hallo, eine Testnachricht.',
      ip: '203.0.113.1',
      userAgent: 'jest',
    });

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com',
      tls: { rejectUnauthorized: true },
    }));
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com', replyTo: 'max@example.com' }));
  });
});
