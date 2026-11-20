import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper around the Stripe SDK (test mode). The key comes from STRIPE_SECRET_KEY in backend/.env.
 * The app still starts without a key; only payment routes answer 503 until one is set.
 */
@Injectable()
export class StripeService {
  private client?: Stripe;

  constructor(private readonly config: ConfigService) {}

  get stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!key) {
        throw new ServiceUnavailableException(
          'Payments are not configured: set STRIPE_SECRET_KEY (sk_test_...) in backend/.env',
        );
      }
      this.client = new Stripe(key);
    }
    return this.client;
  }

  get isConfigured(): boolean {
    return !!this.config.get<string>('STRIPE_SECRET_KEY');
  }

  /** Server-side test confirmations (pm_card_visa ...) are only allowed with a test key */
  get isTestMode(): boolean {
    return (this.config.get<string>('STRIPE_SECRET_KEY') ?? '').startsWith('sk_test_');
  }

  /** Runs a Stripe call and turns Stripe's own errors into clear HTTP errors */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const e = err as { type?: string; message?: string };
      if (e.type === 'StripeAuthenticationError') {
        throw new ServiceUnavailableException('Stripe rejected STRIPE_SECRET_KEY; check the key in backend/.env');
      }
      if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError') {
        throw new BadGatewayException(`Stripe is not reachable right now: ${e.message}`);
      }
      if (e.type === 'StripeInvalidRequestError' || e.type === 'StripeCardError') {
        throw new BadRequestException(`Stripe: ${e.message}`);
      }
      throw err;
    }
  }

  /** Verifies the Stripe-Signature header against the raw request body */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException(
        'Webhook not configured: set STRIPE_WEBHOOK_SECRET (whsec_...) in backend/.env',
      );
    }
    return this.stripe.webhooks.constructEvent(rawBody, signature, secret);
  }
}

/** PAY-04: Stripe works in the smallest currency unit (cents for USD) */
export const toCents = (amount: number) => Math.round(amount * 100);
export const fromCents = (cents: number) => Math.round(cents) / 100;
