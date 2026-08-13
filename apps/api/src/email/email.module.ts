import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { GmailController } from "./gmail.controller";
import { GmailService } from "./gmail.service";
import { ResendService } from "./resend.service";

@Module({
  imports: [AuthModule],
  controllers: [GmailController],
  providers: [GmailService, ResendService],
  exports: [GmailService, ResendService],
})
export class EmailModule {}
