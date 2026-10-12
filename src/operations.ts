import * as fs from 'fs';
import * as path from 'path';
import { config, specPath } from './config';
import { resolveRef, sampleFromSchema } from './samples';

export interface Operation {
  id: string; // "GET /api/v1/Customer/All"
  method: string;
  path: string; // template, e.g. /api/v1/Customer/{dealerGuid}
  tag: string;
  summary: string;
  url: string; // resolved path + query string
  body?: unknown;
  hasBody: boolean;
}

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

type Overrides = Record<
  string,
  { path?: Record<string, any>; query?: Record<string, any>; body?: unknown; skip?: boolean }
>;

function loadOverrides(): Overrides {
  const file = path.resolve(__dirname, '..', 'testdata', 'overrides.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function loadParamDefaults(): Record<string, any> {
  const file = path.resolve(__dirname, '..', 'testdata', 'params.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).values ?? {} : {};
}
const paramDefaults = loadParamDefaults();

function paramValue(spec: any, param: any, source: 'path' | 'query'): any {
  const name: string = param.name;
  if (name.toLowerCase() === 'token') return '{{TOKEN}}';
  if (name.toLowerCase() in paramDefaults) return paramDefaults[name.toLowerCase()];
  if (/dealerguid/i.test(name)) return config.dealerGuid;
    if (param.example !== undefined) return param.example;
  const v = sampleFromSchema(spec, param.schema ?? {}, 0, name);
  if (v !== undefined) return v;
  return source === 'path' ? 1 : 'test';
}

/** Reads the cached spec and turns every path+method into a concrete request. */
export function loadOperations(): Operation[] {
  if (!fs.existsSync(specPath)) {
    throw new Error(`Spec cache missing (${specPath}). Run via "npx playwright test" so global setup can download it.`);
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const overrides = loadOverrides();
  const ops: Operation[] = [];

  for (const [pathTemplate, item] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const id = `${method.toUpperCase()} ${pathTemplate}`;
      if (config.methods.length && !config.methods.includes(method.toUpperCase())) continue;
      if (config.exclude.some((x) => pathTemplate.includes(x))) continue;
      const ov = overrides[id] ?? {};
      if (ov.skip) continue;

      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p: any) =>
        p.$ref ? resolveRef(spec, p.$ref) : p,
      );

      let url = pathTemplate;
      for (const p of params.filter((p: any) => p.in === 'path')) {
        const val = ov.path?.[p.name] ?? paramValue(spec, p, 'path');
        url = url.replace(`{${p.name}}`, encodeURIComponent(String(val)));
      }

      const qs = new URLSearchParams();
      for (const p of params.filter((p: any) => p.in === 'query')) {
        const hasOverride = !!ov.query && p.name in ov.query;
        const always = /^(dealerguid|pagenumber|pagesize|token)$/i.test(p.name) || p.name.toLowerCase() in paramDefaults;
        if (!p.required && !hasOverride && !always) continue;
        let val: any;
        if (hasOverride) val = ov.query![p.name];
        else if (/^pagenumber$/i.test(p.name)) val = 1;
        else if (/^pagesize$/i.test(p.name)) val = 10;
        else val = paramValue(spec, p, 'query');
        if (val === null) continue; // override with null = omit this param
        if (Array.isArray(val)) val.forEach((x) => qs.append(p.name, String(x)));
        else qs.append(p.name, String(val));
      }
      const query = qs.toString();
      if (query) url += `?${query}`;

      let body: unknown;
      let hasBody = false;
      const content = op.requestBody?.content;
      if (content) {
        hasBody = true;
        const media = content['application/json'] ?? content['text/json'] ?? Object.values<any>(content)[0];
        body = ov.body ?? sampleFromSchema(spec, media?.schema) ?? {};
      }

      ops.push({
        id,
        method: method.toUpperCase(),
        path: pathTemplate,
        tag: (op.tags?.[0] as string) ?? 'Untagged',
        summary: op.summary ?? '',
        url,
        body,
        hasBody,
      });
    }
  }
  return ops;
}
