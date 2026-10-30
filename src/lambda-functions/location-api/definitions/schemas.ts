import { z } from 'zod';

export const createLocationSchema = z.object({
  name: z.string().trim().min(3).max(512),
  city: z.string().trim().min(1).max(256),
  state: z.string().trim().min(2).max(64),
  country: z.string().trim().min(4).max(64),
});

export const updateLocationSchema = z.object({
  name: z.string().trim().min(3).max(512).optional(),
  city: z.string().trim().min(1).max(256).optional(),
  state: z.string().trim().min(2).max(64).optional(),
  country: z.string().trim().min(4).max(64).optional(),
}).refine((body) =>{
  return body.name !== undefined ||
         body.city !== undefined ||
         body.state !== undefined ||
         body.country !== undefined;
}, {
  message: 'At least one field must be provided',
  path: [],
});

export const listLocationsSchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 100))
    .pipe(z.number().int().positive().max(1000)),
  nextToken: z.string().optional()
});

const singleLocationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

export const listLocationsResponseSchema = z.object({
  items: z.array(singleLocationResponseSchema),
  nextToken: z.string().nullable()
});
