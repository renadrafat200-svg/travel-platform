import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class AppController {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  // GET /api/health — quick check that the API is up and connected to MongoDB
  @Public()
  @Get()
  @ApiOkResponse({ description: 'API status and database connection state' })
  check() {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    return {
      status: 'ok',
      database: states[this.connection.readyState] ?? 'unknown',
      databaseName: this.connection.name,
      time: new Date().toISOString(),
    };
  }
}
