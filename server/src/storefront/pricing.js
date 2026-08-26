import { z } from 'zod';
import { deliveryFeeCents } from '../money.js';

const safeCentsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const pricingQuoteSchema = z.object({
  deliveryRevision: z.string().regex(/^(0|[1-9][0-9]{0,19})$/),
  subtotalCents: safeCentsSchema,
  deliveryFeeCents: safeCentsSchema,
  totalCents: safeCentsSchema
}).strict().superRefine((quote, context) => {
  if (quote.subtotalCents + quote.deliveryFeeCents !== quote.totalCents) {
    context.addIssue({ code: 'custom', path: ['totalCents'], message: 'Pricing total is inconsistent.' });
  }
});

export function createPricingQuote(settings, subtotalCents) {
  const feeCents = deliveryFeeCents(subtotalCents, settings);
  return {
    deliveryRevision: settings.revision,
    subtotalCents,
    deliveryFeeCents: feeCents,
    totalCents: subtotalCents + feeCents
  };
}

export function pricingQuotesEqual(left, right) {
  return left?.deliveryRevision === right?.deliveryRevision &&
    left?.subtotalCents === right?.subtotalCents &&
    left?.deliveryFeeCents === right?.deliveryFeeCents &&
    left?.totalCents === right?.totalCents;
}
