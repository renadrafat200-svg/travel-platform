import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { HotelsService } from '../hotels/hotels.service';

/**
 * ACC-15: an admin deactivates or reactivates an airline or a hotel.
 * A deactivated provider disappears from search and cannot be booked (Members 2, 3 and 4 already
 * check isActive), while existing confirmed bookings stay valid. Here we only flip the flag.
 */
@Injectable()
export class AdminProvidersService {
  constructor(
    private readonly airlines: AirlinesService,
    private readonly hotels: HotelsService,
    private readonly audit: AuditService,
  ) {}

  async setAirlineActive(admin: AuthUser, id: string, active: boolean, reason?: string) {
    const airline = await this.airlines.getBasic(id); // null if the id is invalid or unknown
    if (!airline) throw new NotFoundException('Airline not found');
    if (airline.isActive === active) {
      throw new BadRequestException(`Airline is already ${active ? 'active' : 'deactivated'}`);
    }

    const updated = await this.airlines.setActive(id, active);
    await this.audit.log(admin, {
      action: active ? 'airline.reactivate' : 'airline.deactivate',
      targetType: 'airline',
      targetId: id,
      details: { reason, name: airline.name },
    });
    // TODO (Member 6): notify this airline's moderators, and users with upcoming confirmed bookings.
    return {
      message: active ? 'Airline reactivated' : 'Airline deactivated',
      airline: updated,
    };
  }

  async setHotelActive(admin: AuthUser, id: string, active: boolean, reason?: string) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Hotel not found');
    const hotel = await this.hotels.getById(id); // 404 if it does not exist
    if (hotel.isActive === active) {
      throw new BadRequestException(`Hotel is already ${active ? 'active' : 'deactivated'}`);
    }

    const updated = await this.hotels.setActive(id, active);
    await this.audit.log(admin, {
      action: active ? 'hotel.reactivate' : 'hotel.deactivate',
      targetType: 'hotel',
      targetId: id,
      details: { reason, name: hotel.name },
    });
    // TODO (Member 6): notify this hotel's moderators, and users with upcoming confirmed bookings.
    return {
      message: active ? 'Hotel reactivated' : 'Hotel deactivated',
      hotel: updated,
    };
  }
}
