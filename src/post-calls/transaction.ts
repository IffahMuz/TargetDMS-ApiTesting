import { expect } from '@playwright/test';
import { IDS, PostCall } from './types';

// Both endpoints call the TargetPay payment service, and a successful call creates a real payment token / pay-by-link page.
// So ONLY failing bodies are tested: each breaks exactly ONE rule and must be rejected with 400 before TargetPay is called.
// (GetPaymentTypes is a GET and is covered in src/get-calls/other.ts.)
const token = '/api/v1/Transaction/GetTransactionToken';
const url = '/api/v1/Transaction/GetPaymentURL';

const tokenBody = {
  dealerId: IDS.dealerId, transactionType: 'CreditSale', transactionReference: 'QA-VALIDATION', amount: 1, salesTaxAmount: 0,
  cashierId: 'QA', customerId: String(IDS.customerId), customerName: 'QA Validation', customerPhone: '', customerEmail: '',
  agent: 'TargetEngine', userId: 1, saveCard: false,
};
const urlBody = {
  dealerId: IDS.dealerId, transactionReference: 'QA-VALIDATION', amount: 1, cashierId: 'QA', customerId: IDS.customerId,
  customerName: 'QA Validation', forwardResponseHook: '', memo: '', moreInfo: '', isBatch: false, agent: 'TargetEngine',
};

const bad = (name: string, path: string, body: unknown, needle: string): PostCall => ({
  name, path, body, expectStatus: [400], check: (res: any) => expect(JSON.stringify(res)).toContain(needle),
});

export const transactionPostCalls: PostCall[] = [
  // GetTransactionToken
  bad('Transaction token with dealerId 0 is rejected with 400', token, { ...tokenBody, dealerId: 0 }, 'DealerId must be greater than 0'),
  bad('Transaction token with userId 0 is rejected with 400', token, { ...tokenBody, userId: 0 }, 'UserId must be greater than 0'),
  bad('Transaction token with an unknown transactionType is rejected with 400', token, { ...tokenBody, transactionType: 'Refund' }, 'TransactionType must be a valid value'),
  bad('Transaction token with an unknown agent is rejected with 400', token, { ...tokenBody, agent: 'Other' }, 'Agent must be a valid value'),
  bad('Transaction token without a reference is rejected with 400', token, { ...tokenBody, transactionReference: '' }, 'TransactionReference is required'),
  bad('Transaction token with a reference over 15 characters is rejected with 400', token, { ...tokenBody, transactionReference: 'R'.repeat(16) }, 'TransactionReference must not exceed 15 characters'),
  bad('Transaction token with amount 0 is rejected with 400', token, { ...tokenBody, amount: 0 }, 'Amount must be greater than 0'),
  bad('Transaction token with a null cashierId is rejected with 400', token, { ...tokenBody, cashierId: null }, 'CashierId is required'),
  bad('Transaction token without a customerId is rejected with 400', token, { ...tokenBody, customerId: '' }, 'CustomerId is required'),
  bad('Transaction token without a customer name is rejected with 400', token, { ...tokenBody, customerName: '' }, 'CustomerName is required'),
  bad('Transaction token with a phone over 15 characters is rejected with 400', token, { ...tokenBody, customerPhone: '1'.repeat(16) }, 'CustomerPhone must not exceed 15 characters'),
  bad('Transaction token with an email over 250 characters is rejected with 400', token, { ...tokenBody, customerEmail: 'e'.repeat(251) }, 'CustomerEmail must not exceed 250 characters'),
  // GetPaymentURL
  bad('Payment link with dealerId 0 is rejected with 400', url, { ...urlBody, dealerId: 0 }, 'DealerId is required'),
  bad('Payment link without a reference is rejected with 400', url, { ...urlBody, transactionReference: '' }, 'TransactionReference is required'),
  bad('Payment link with a reference over 15 characters is rejected with 400', url, { ...urlBody, transactionReference: 'R'.repeat(16) }, 'TransactionReference must not exceed 15 characters'),
  bad('Payment link with amount 0 is rejected with 400', url, { ...urlBody, amount: 0 }, 'Amount must be greater than 0'),
  bad('Payment link with a cashierId over 15 characters is rejected with 400', url, { ...urlBody, cashierId: 'C'.repeat(16) }, 'CashierId must not exceed 15 characters'),
  bad('Payment link with customerId 0 is rejected with 400', url, { ...urlBody, customerId: 0 }, 'CustomerId is required'),
  bad('Payment link without a customer name is rejected with 400', url, { ...urlBody, customerName: '' }, 'CustomerName is required'),
  bad('Payment link with a null memo is rejected with 400', url, { ...urlBody, memo: null }, 'Memo is required'),
];
