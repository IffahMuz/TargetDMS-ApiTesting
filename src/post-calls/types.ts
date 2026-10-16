import { GetCtx } from '../get-calls/types';

export { IDS } from '../get-calls/types';

export interface PostCall {
  /** Short human name shown in the report. */
  name: string;
  /** Swagger path template, e.g. /api/v1/Customer/GetCustomerUnits. Identifies the endpoint. */
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number> | ((ctx: GetCtx) => Record<string, string | number>);
  body: unknown;
  /** Defaults to 200/201/204. Set for negative tests, e.g. [400]. */
  expectStatus?: number[];
  /** Checks on the parsed response body. For 2xx responses `data` is body.data; for errors it is the whole body. */
  check: (data: any) => void;
}
