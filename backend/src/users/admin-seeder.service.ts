import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '../common/enums/role.enum';
import { UsersService } from './users.service';

/**
 * Administrator accounts cannot register themselves, so one is seeded.
 * On startup, if no admin exists yet, it creates one from ADMIN_EMAIL / ADMIN_PASSWORD in backend/.env.
 * Runs once per database; restarting the app does nothing if an admin already exists.
 */
@Injectable()
export class AdminSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminSeeder');

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set in .env, skipping admin seed');
      return;
    }

    if (await this.users.adminExists()) return;

    const taken = await this.users.findByEmail(email);
    if (taken) {
      this.logger.warn(`${email} already exists as a ${taken.role}; admin not seeded`);
      return;
    }

    await this.users.create({
      email,
      password,
      firstName: 'Platform',
      lastName: 'Admin',
      role: Role.ADMIN,
    });
    this.logger.log(`Seeded admin account ${email}`);
  }
}
