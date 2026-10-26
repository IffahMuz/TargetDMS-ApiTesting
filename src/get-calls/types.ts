import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { DATA } from '../testdata';

/** Shared test values: .env (dealer, customer) and testdata/dealers/<dealerId>.json (ids of existing records). */
const values = DATA.ids;

export const IDS = {
  dealerGuid: config.dealerGuid,
  dealerId: config.dealerId,
  customerId: config.customerId,
  workOrderId: values.workOrderId,
  orderId: values.orderId,
  userId: values.userId,
  roleId: values.roleId,
  inspectionSessionId: values.inspectionSessionId,
  invoiceGuid: values.invoiceGuid,
};

export interface GetCtx {
  token: string;
}

export interface GetCall {
  /** Short human name shown in the report. */
  name: string;
  /** Swagger path template, e.g. /api/v1/Customer/Balance/{dealerGuid}. Identifies the endpoint. */
  path: string;
  /** Values for {placeholders} in the path. {dealerGuid} is filled in automatically. */
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number> | ((ctx: GetCtx) => Record<string, string | number>);
  /** Response checks on body.data. Status 200/201/204 and success=true are always checked first. */
  check: (data: any) => void;
}
