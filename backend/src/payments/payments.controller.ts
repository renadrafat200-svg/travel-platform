import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthUser } from '../common/interfaces/auth-user.interface';
import { CreatePaymentDto, RetryPaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiCookieAuth('access_token')
@ApiServiceUnavailableResponse({ description: 'STRIPE_SECRET_KEY is not set in backend/.env' })
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start paying for a Pending Payment booking (PAY-01)',
    description:
      'Creates a Stripe PaymentIntent (USD) and returns its clientSecret for Stripe Elements. ' +
      'The policies must be accepted first (PAY-02). The booking is confirmed only by the Stripe webhook. ' +
      'For Swagger testing with a test key, set testPaymentMethod to pm_card_visa (succeeds) or pm_card_chargeDeclined (fails).',
  })
  @ApiCreatedResponse({ description: '{ paymentId, clientSecret, amount, currency, status, holdExpiresAt }' })
  @ApiBadRequestResponse({ description: 'Policies not accepted, booking not pending, or hold expired' })
  @ApiConflictResponse({ description: 'Already paid' })
  @ApiForbiddenResponse({ description: 'Not your booking' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  /** Stripe calls this; it is not for users. Declared before ":id" routes. */
  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Stripe webhook (PAY-01, PAY-03) - called by Stripe, not by users',
    description:
      'Verifies the Stripe-Signature header with STRIPE_WEBHOOK_SECRET. Locally: ' +
      'stripe listen --forward-to localhost:3000/api/payments/webhook',
  })
  @ApiHeader({ name: 'stripe-signature', required: true })
  @ApiOkResponse({ description: '{ received: true }' })
  @ApiBadRequestResponse({ description: 'Bad signature' })
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    return this.payments.handleWebhook(req.rawBody, signature);
  }

  @Post(':id/retry')
  @ApiOperation({
    summary: 'Try again after a failed payment, while the hold lasts (PAY-01)',
    description: 'Creates a new PaymentIntent for the same booking and cancels any open one.',
  })
  @ApiParam({ name: 'id', description: 'Payment id from POST /api/payments' })
  @ApiCreatedResponse({ description: 'Same shape as POST /api/payments' })
  @ApiBadRequestResponse({ description: 'Hold expired or booking no longer pending' })
  @ApiConflictResponse({ description: 'Already paid' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RetryPaymentDto) {
    return this.payments.retry(user, id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Payment status (PAY-01). Owner or admin.' })
  @ApiParam({ name: 'id', description: 'Payment id' })
  @ApiOkResponse({ description: 'Payment with its current status (and lastError if the card was declined)' })
  @ApiForbiddenResponse({ description: 'Not your payment' })
  @ApiNotFoundResponse({ description: 'Payment not found' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.findOne(user, id);
  }
}
