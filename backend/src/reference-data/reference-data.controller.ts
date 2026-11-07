import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AirportQueryDto, AttractionQueryDto, CityQueryDto } from './dto/reference-query.dto';
import { ReferenceDataService } from './reference-data.service';

/** Public lookups: guests need these to search flights and hotels */
@ApiTags('Reference data')
@Public()
@Controller()
export class ReferenceDataController {
  constructor(private readonly reference: ReferenceDataService) {}

  @Get('airports')
  @ApiOperation({ summary: 'List airports with their IANA time zones (FLT-02)' })
  @ApiOkResponse({ description: 'Airports from the official dataset' })
  airports(@Query() q: AirportQueryDto) {
    return this.reference.listAirports(q);
  }

  @Get('countries')
  @ApiOperation({ summary: 'List countries and their currencies' })
  @ApiOkResponse({ description: 'Countries from the official dataset' })
  countries() {
    return this.reference.listCountries();
  }

  @Get('currencies')
  @ApiOperation({ summary: 'Supported currency codes (from Countries.csv)' })
  @ApiOkResponse({ description: 'e.g. ["AED","EGP","EUR",...]' })
  currencies() {
    return this.reference.supportedCurrencies();
  }

  @Get('cities')
  @ApiOperation({ summary: 'List cities, optionally by country' })
  @ApiOkResponse({ description: 'Cities from the official dataset' })
  cities(@Query() q: CityQueryDto) {
    return this.reference.listCities(q);
  }

  @Get('attractions')
  @ApiOperation({ summary: 'List attractions, optionally by city' })
  @ApiOkResponse({ description: 'Attractions from the official dataset' })
  attractions(@Query() q: AttractionQueryDto) {
    return this.reference.listAttractions(q);
  }
}
