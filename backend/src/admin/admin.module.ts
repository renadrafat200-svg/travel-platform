import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminAccountsController } from './admin-accounts.controller';
import { AdminAccountsService } from './admin-accounts.service';

/**
 * Admin features. AuditService comes from the global AuditModule.
 * Later: reports, provider deactivation and admin bookings are added here too.
 */
@Module({
  imports: [UsersModule],
  controllers: [AdminAccountsController],
  providers: [AdminAccountsService],
})
export class AdminModule {}