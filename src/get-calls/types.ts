import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

/** Shared test values (testdata/params.json) - the single source of IDs for generic and explicit tests. */
const values: Record<string, any> = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', 'testdata', 'params.json'), 'utf8'),
).values;

export const IDS = {
  dealerGuid: config.dealerGuid,
  dealerId: values.dealerid as number,
  customerId: values.customerid as number,
  workOrderId: values.workorderid as number,
  orderId: values.orderid as number,
  userId: values.userid as string,
  roleId: values.roleid as string,
  inspectionSessionId: values.inspectionsessionid as string,
  invoiceGuid: values.invoiceguid as string,
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
