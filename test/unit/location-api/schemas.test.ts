import {
  createLocationSchema,
  listLocationsSchema,
  updateLocationSchema,
} from '../../../src/lambda-functions/location-api/definitions/schemas';

const validLocation = {
  name: '  Seattle Center  ',
  city: ' Seattle ',
  state: ' WA ',
  country: ' United States ',
};

describe('createLocationSchema', () => {
  it('trims whitespace from every field', () => {
    expect(createLocationSchema.parse(validLocation)).toEqual({
      name: 'Seattle Center',
      city: 'Seattle',
      state: 'WA',
      country: 'United States',
    });
  });

  it.each([
    ['name', 'ab'], // min 3
    ['city', ''], // min 1
    ['state', 'W'], // min 2
    ['country', 'USA'], // min 4
  ] as const)('rejects an invalid %s', (field, value) => {
    const result = createLocationSchema.safeParse({
      ...validLocation,
      [field]: value,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([field]);
  });

  it.each([
    ['name', 'a'.repeat(513)],
    ['city', 'a'.repeat(257)],
    ['state', 'a'.repeat(65)],
    ['country', 'a'.repeat(65)],
  ] as const)('rejects a %s above the maximum length', (field, value) => {
    const result = createLocationSchema.safeParse({
      ...validLocation,
      [field]: value,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual([field]);
  });

  it('rejects non-string values', () => {
    const result = createLocationSchema.safeParse({
      ...validLocation,
      name: 123,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['name']);
  });
});

describe('updateLocationSchema', () => {
  it('trims a single partial field', () => {
    expect(updateLocationSchema.parse({ city: ' Portland ' })).toEqual({
      city: 'Portland',
    });
  });

  it('accepts multiple partial fields', () => {
    expect(
      updateLocationSchema.parse({ city: 'Portland', state: 'Maine' }),
    ).toEqual({ city: 'Portland', state: 'Maine' });
  });

  it('rejects an empty patch', () => {
    const result = updateLocationSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      'At least one field must be provided',
    );
  });

  it('rejects an invalid field even when another field is valid', () => {
    const result = updateLocationSchema.safeParse({
      name: 'Valid updated name',
      city: 'a'.repeat(257),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['city']);
  });
});

describe('listLocationsSchema', () => {
  it('defaults page to 1 and pageSize to 100', () => {
    expect(listLocationsSchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 100,
    });
  });

  it('parses query-string pagination parameters', () => {
    expect(
      listLocationsSchema.parse({ page: '2', pageSize: '25' }),
    ).toMatchObject({
      page: 2,
      pageSize: 25,
    });
  });

  it('rejects a non-numeric page', () => {
    expect(listLocationsSchema.safeParse({ page: 'abc' }).success).toBe(false);
  });

  it('rejects a non-numeric pageSize', () => {
    expect(listLocationsSchema.safeParse({ pageSize: 'abc' }).success).toBe(false);
  });

  it('rejects a non-positive page', () => {
    expect(listLocationsSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects a non-positive pageSize', () => {
    expect(listLocationsSchema.safeParse({ pageSize: '0' }).success).toBe(false);
  });

  it('rejects a pageSize above the maximum', () => {
    expect(listLocationsSchema.safeParse({ pageSize: '1001' }).success).toBe(false);
  });
});
