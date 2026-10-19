import { expect } from '@playwright/test';
import { IDS, PostCall } from './types';

// Every Notification "send" endpoint emails or texts a real person on success, so ONLY failing bodies are tested here:
// each one breaks exactly ONE rule and must be rejected with 400 before anything is sent. (GetReceiptLink is covered in tests/flows/receipt.flow.spec.ts.)
// dmsDealerId must be the DMS dealer our user owns (199301001), otherwise the dealer filter answers 403 before validation runs.
const dms = 199301001;
const email = 'iffahmuzaffar110@gmail.com'; // the tester's own address; never reached because every body below is rejected
const phone = '0000000000'; // not a real number
const trusted = 'https://targetumh.example.com/file.png';
const rejected = (needle: string) => (body: any) => expect(JSON.stringify(body)).toContain(needle);

const message = '/api/v1/Notification/SendMessage';
const receiptEmail = '/api/v1/Notification/SendReceiptToEmail';
const payLink = '/api/v1/Notification/SendPayByLinkEmail';
const filesEmail = '/api/v1/Notification/SendFilesToEmail';
const filesSms = '/api/v1/Notification/SendFilesToSms';
const receiptText = '/api/v1/Notification/SendReceiptToText';

const messageBody = { dmsDealerId: dms, customerId: IDS.customerId, from: 'QA', to: phone, message: 'QA validation' };
const receiptBody = { dmsDealerId: dms, dealerId: IDS.dealerId, orderId: IDS.orderId, customerId: IDS.customerId, invoiceId: 1 };
const payBody = { dmsDealerId: dms, dealerId: IDS.dealerId, orderId: IDS.orderId, emailTo: email, payByLinkUrl: 'https://pay.adyen.link/PL123' };
const file = { fileName: 'a.png', fileUrl: trusted, fileType: 'image/png' };
const filesEmailBody = { dmsDealerId: dms, dealerId: IDS.dealerId, emailTo: email, files: [file] };
const filesSmsBody = { dmsDealerId: dms, dealerId: IDS.dealerId, to: phone, fileUrls: [trusted] };

const bad = (name: string, path: string, body: unknown, needle: string): PostCall => ({ name, path, body, expectStatus: [400], check: rejected(needle) });

export const notificationPostCalls: PostCall[] = [
  // SendMessage (text message)
  bad('Message with customerId 0 is rejected with 400', message, { ...messageBody, customerId: 0 }, 'CustomerId is required'),
  bad('Message with a sender over 11 characters is rejected with 400', message, { ...messageBody, from: 'F'.repeat(12) }, 'From must not exceed 11 characters'),
  bad('Message without a recipient is rejected with 400', message, { ...messageBody, to: '' }, 'To is required'),
  bad('Message to a number over 15 characters is rejected with 400', message, { ...messageBody, to: '1'.repeat(16) }, 'To must not exceed 15 characters'),
  bad('Message without text is rejected with 400', message, { ...messageBody, message: '' }, 'Message is required'),
  // SendReceiptToEmail
  bad('Receipt email with dealerId 0 is rejected with 400', receiptEmail, { ...receiptBody, dealerId: 0 }, 'DealerId must be greater than 0'),
  bad('Receipt email with orderId 0 is rejected with 400', receiptEmail, { ...receiptBody, orderId: 0 }, 'OrderId must be greater than 0'),
  bad('Receipt email with customerId 0 is rejected with 400', receiptEmail, { ...receiptBody, customerId: 0 }, 'CustomerId must be greater than 0'),
  bad('Receipt email with invoiceId 0 is rejected with 400', receiptEmail, { ...receiptBody, invoiceId: 0 }, 'InvoiceId must be greater than 0'),
  // SendPayByLinkEmail
  bad('Pay-by-link email with dealerId 0 is rejected with 400', payLink, { ...payBody, dealerId: 0 }, 'DealerId is required'),
  bad('Pay-by-link email with orderId 0 is rejected with 400', payLink, { ...payBody, orderId: 0 }, 'OrderId is required'),
  bad('Pay-by-link email without a recipient is rejected with 400', payLink, { ...payBody, emailTo: '' }, 'EmailTo is required'),
  bad('Pay-by-link email to a malformed address is rejected with 400', payLink, { ...payBody, emailTo: 'not-an-email' }, 'Recipient email is not valid'),
  bad('Pay-by-link email without a link is rejected with 400', payLink, { ...payBody, payByLinkUrl: '' }, 'PayByLinkUrl is required'),
  bad('Pay-by-link email with a plain http link is rejected with 400', payLink, { ...payBody, payByLinkUrl: 'http://pay.adyen.link/PL123' }, 'Payment URL must use HTTPS'),
  bad('Pay-by-link email with a link from an untrusted domain is rejected with 400', payLink, { ...payBody, payByLinkUrl: 'https://example.com/pay' }, 'Untrusted domain'),
  // SendFilesToEmail
  bad('Files email with neither customer nor address is rejected with 400', filesEmail, { ...filesEmailBody, emailTo: '' }, 'Either CustomerId or EmailTo must be provided'),
  bad('Files email to a malformed address is rejected with 400', filesEmail, { ...filesEmailBody, emailTo: 'not-an-email' }, 'EmailTo must be a valid email address'),
  bad('Files email with no files is rejected with 400', filesEmail, { ...filesEmailBody, files: [] }, 'At least one file is required'),
  bad('Files email with a file without a name is rejected with 400', filesEmail, { ...filesEmailBody, files: [{ ...file, fileName: '' }] }, 'FileName is required'),
  bad('Files email with a plain http file link is rejected with 400', filesEmail, { ...filesEmailBody, files: [{ ...file, fileUrl: 'http://targetumh.example.com/a.png' }] }, 'FileUrl must use HTTPS'),
  bad('Files email with a file link from an untrusted domain is rejected with 400', filesEmail, { ...filesEmailBody, files: [{ ...file, fileUrl: 'https://example.com/a.png' }] }, 'trusted TargetUMH domain'),
  bad('Files email with an unsupported file type is rejected with 400', filesEmail, { ...filesEmailBody, files: [{ ...file, fileType: 'text/plain' }] }, 'FileType must be a supported type'),
  // SendFilesToSms
  bad('Files text with neither customer nor number is rejected with 400', filesSms, { ...filesSmsBody, to: '' }, 'Either CustomerId or To must be provided'),
  bad('Files text to a number over 15 characters is rejected with 400', filesSms, { ...filesSmsBody, to: '1'.repeat(16) }, 'To must not exceed 15 characters'),
  bad('Files text with no file links is rejected with 400', filesSms, { ...filesSmsBody, fileUrls: [] }, 'At least one FileUrl is required'),
  bad('Files text with a plain http file link is rejected with 400', filesSms, { ...filesSmsBody, fileUrls: ['http://targetumh.example.com/a.png'] }, 'FileUrl must use HTTPS'),
  bad('Files text with a file link from an untrusted domain is rejected with 400', filesSms, { ...filesSmsBody, fileUrls: ['https://example.com/a.png'] }, 'trusted TargetUMH domain'),
  // SendReceiptToText
  bad('Receipt text with dmsDealerId 0 is rejected with 400', receiptText, { ...receiptBody, dmsDealerId: 0 }, 'DmsDealerId must be greater than 0'),
  bad('Receipt text with dealerId 0 is rejected with 400', receiptText, { ...receiptBody, dealerId: 0 }, 'DealerId must be greater than 0'),
  bad('Receipt text with orderId 0 is rejected with 400', receiptText, { ...receiptBody, orderId: 0 }, 'OrderId must be greater than 0'),
  bad('Receipt text with customerId 0 is rejected with 400', receiptText, { ...receiptBody, customerId: 0 }, 'CustomerId must be greater than 0'),
  bad('Receipt text with invoiceId 0 is rejected with 400', receiptText, { ...receiptBody, invoiceId: 0 }, 'InvoiceId must be greater than 0'),
  {
    name: 'Sending for a dmsDealerId the user does not own is refused with 403',
    path: receiptText,
    body: { ...receiptBody, dmsDealerId: IDS.dealerId },
    expectStatus: [403],
    check: rejected('Dealer authorization failed'),
  },
];
