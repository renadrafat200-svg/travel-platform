import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';

/** Optional bonus: email sending. @Global so any module can inject MailService. */
@Global()
@Module({
    providers: [MailService],
    exports: [MailService],
})
export class MailModule { }
