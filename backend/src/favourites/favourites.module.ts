import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FavouritesController } from './favourites.controller';
import { FavouritesService } from './favourites.service';
import { Favourite, FavouriteSchema } from './schemas/favourite.schema';

/** Optional bonus: favourite hotels, public itineraries and blog posts */
@Module({
  imports: [MongooseModule.forFeature([{ name: Favourite.name, schema: FavouriteSchema }])],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
