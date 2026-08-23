import { z } from 'zod';

export const emailSchema = z.string().trim().email().max(254).transform((email) => email.toLowerCase());
export const passwordSchema = z.string().min(12, 'Use at least 12 characters.').max(128);
export const displayNameSchema = z.string().trim().min(2).max(100);
export const phoneSchema = z.string().trim().regex(/^\+212[5-7]\d{8}$/, 'Use a Moroccan number in +212XXXXXXXXX format.');
export const optionalPhoneSchema = z.union([phoneSchema, z.literal(''), z.null()]).transform((value) => value || null);
export const publicIdSchema = z.string().uuid();
export const productIdSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/);
