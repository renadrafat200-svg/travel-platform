import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ExchangeRatesService } from './exchange-rates.service';

/** ITN-18: lets you see which cached rates the budget totals use, and their date */
@ApiTags('Exchange rates')
@Controller('exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      'The cached exchange rates (base USD) of the supported currencies and their date (ITN-18)',
  })
  @ApiOkResponse({ description: '{ base, date, fetchedAt, isToday, rates }' })
  @ApiServiceUnavailableResponse({
    description: 'No rates cached yet and FXRatesAPI unreachable',
  })
  view() {
    return this.rates.view();
  }

  @Post('refresh')
  @HttpCode(200)
  @Roles(Role.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary:
      'Admin: fetch today’s rates from FXRatesAPI now (normally automatic once per day)',
  })
  @ApiOkResponse({ description: 'The rates that are now cached' })
  @ApiForbiddenResponse({ description: 'Admins only' })
  @ApiServiceUnavailableResponse({
    description: 'FXRatesAPI unreachable; the last cached rates stay in use',
  })
  async refresh() {
    await this.rates.refresh();
    return this.rates.view();
  }
}
