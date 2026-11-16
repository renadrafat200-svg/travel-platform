import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { HOTEL_JOB_EVERY_MS } from '../hotels/hotel.constants';
import { HotelBookingsService } from './hotel-bookings.service';

/**
 * Background job, every minute:
 *   - HTL-18: unpaid holds older than 10 minutes become Expired and their rooms are released
 *   - HTL-23: confirmed reservations whose check-out has passed become Completed
 */
@Injectable()
export class HotelHoldExpiryJob {
  private readonly logger = new Logger(HotelHoldExpiryJob.name);
  private running = false;

  constructor(private readonly bookings: HotelBookingsService) {}

  @Interval(HOTEL_JOB_EVERY_MS)
  async run() {
    if (this.running) return; // the previous run is still going
    this.running = true;
    try {
      const expired = await this.bookings.expireOverdue();
      const completed = await this.bookings.completeFinished();
      if (expired)
        this.logger.log(
          `Released the rooms of ${expired} expired hotel hold(s)`,
        );
      if (completed)
        this.logger.log(`Marked ${completed} finished stay(s) as completed`);
    } catch (err) {
      this.logger.error('Hotel booking job failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}
