import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HotelSearchService } from './hotel-search.service';
import { HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomInventoryService } from './room-inventory.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { RoomBlock, RoomBlockSchema } from './schemas/room-block.schema';
import { RoomNight, RoomNightSchema } from './schemas/room-night.schema';
import { RoomRange, RoomRangeSchema } from './schemas/room-range.schema';
import { Room, RoomSchema } from './schemas/room.schema';

/**
 * Hotels (Member 4): hotel profiles, photos and policies, rooms, bookable ranges, blocked dates,
 * the room calendar, available rooms and hotel search (HTL-01 to HTL-15).
 * Exports HotelsService (Member 1: exists(), setActive(); Member 5: setRating()) and
 * RoomInventoryService, which hotel bookings use to take and free room nights.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomNight.name, schema: RoomNightSchema },
      { name: RoomBlock.name, schema: RoomBlockSchema },
      { name: RoomRange.name, schema: RoomRangeSchema },
    ]),
  ],
  controllers: [HotelsController, RoomsController],
  providers: [
    HotelsService,
    RoomsService,
    RoomInventoryService,
    HotelSearchService,
  ],
  exports: [
    HotelsService,
    RoomsService,
    RoomInventoryService,
    HotelSearchService,
    MongooseModule,
  ],
})
export class HotelsModule {}
