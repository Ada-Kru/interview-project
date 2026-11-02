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
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(1000).default(100),
});

const singleLocationResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  createdAt: z.string(),
});

export const listLocationsResponseSchema = z.object({
  items: z.array(singleLocationResponseSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
