import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { EXPIRY_JOB_EVERY_MS } from './flight-booking.constants';
import { FlightBookingsService } from './flight-bookings.service';

/**
 * Background job (FLT-22): every minute, unpaid holds whose time ran out are marked
 * "expired" and their seats go back on sale.
 */
@Injectable()
export class HoldExpiryJob {
    private readonly logger = new Logger(HoldExpiryJob.name);
    private running = false;

    constructor(private readonly bookings: FlightBookingsService) { }

    @Interval(EXPIRY_JOB_EVERY_MS)
    async run() {
        if (this.running) return; // the previous run is still going
        this.running = true;
        try {
            const count = await this.bookings.expireOverdue();
            if (count) this.logger.log(`Released seats of ${count} expired flight hold(s)`);
        } catch (err) {
            this.logger.error('Hold expiry job failed', err as Error);
        } finally {
            this.running = false;
        }
    }
}