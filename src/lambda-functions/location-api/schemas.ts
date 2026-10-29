import { z } from 'zod';

export const createLocationSchema = z.object({
  name: z.string().min(3).max(512),
  city: z.string().min(1).max(256),
  state: z.string().min(2).max(64),
  country: z.string().min(4).max(64),
});

export const updateLocationSchema = z.object({
  name: z.string().min(3).max(512).optional(),
  city: z.string().min(1).max(256).optional(),
  state: z.string().min(2).max(64).optional(),
  country: z.string().min(4).max(64).optional(),
}).refine((body) =>{
  return body.name !== undefined ||
         body.city !== undefined ||
         body.state !== undefined ||
         body.country !== undefined;
}, {
  message: 'At least one field must be provided',
  path: [],
});
