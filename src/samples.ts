/** Builds sample request values from an OpenAPI 3 schema. */
type Schema = any;

export function resolveRef(spec: any, ref: string): Schema {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((node, key) => node?.[decodeURIComponent(key.replace(/~1/g, '/').replace(/~0/g, '~'))], spec);
}

export function sampleFromSchema(spec: any, schema: Schema, depth = 0, name = ''): any {
  if (!schema || depth > 6) return undefined;
  if (schema.$ref) return sampleFromSchema(spec, resolveRef(spec, schema.$ref), depth + 1, name);
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.allOf?.length) {
    return Object.assign({}, ...schema.allOf.map((s: Schema) => sampleFromSchema(spec, s, depth + 1, name) ?? {}));
  }
  const variant = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (variant) return sampleFromSchema(spec, variant, depth + 1, name);

  const type = schema.type ?? (schema.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const out: Record<string, any> = {};
      for (const [key, prop] of Object.entries<Schema>(schema.properties ?? {})) {
        const v = sampleFromSchema(spec, prop, depth + 1, key);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
    case 'array': {
      const item = sampleFromSchema(spec, schema.items, depth + 1, name);
      return item === undefined ? [] : [item];
    }
    case 'integer':
    case 'number':
      return Math.max(schema.minimum ?? 1, 1);
    case 'boolean':
      return false;
    case 'string':
      return stringSample(schema, name);
    default:
      return undefined;
  }
}

function stringSample(schema: Schema, name: string): string {
  switch (schema.format) {
    case 'date-time': return '2026-01-01T00:00:00Z';
    case 'date': return '2026-01-01';
    case 'uuid': return '00000000-0000-0000-0000-000000000001';
    case 'email': return 'qa.automation@example.com';
    case 'uri': return 'https://example.com';
  }
  if (/guid/i.test(name)) return '00000000-0000-0000-0000-000000000001';
  if (/date/i.test(name)) return '2026-01-01T00:00:00Z';
  const base = name ? `test-${name}` : 'test';
  return base.slice(0, schema.maxLength ?? base.length);
}
