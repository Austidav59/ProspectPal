import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

import type { Environment } from "../config/environment";

export interface ResendSendInput {
  from: string;
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class ResendService {
  private readonly client: Resend | null;
  private readonly defaultFrom: string | null;

  constructor(config: ConfigService<Environment, true>) {
    const apiKey = config.get("RESEND_API_KEY", { infer: true });
    this.client = apiKey ? new Resend(apiKey) : null;
    this.defaultFrom = config.get("RESEND_FROM_EMAIL", { infer: true }) ?? null;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  getDefaultFrom(): string | null {
    return this.defaultFrom;
  }

  async sendMail(input: ResendSendInput): Promise<{ id: string }> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        "RESEND_API_KEY is not configured. Add it to your environment to send email campaigns.",
      );
    }

    const { data, error } = await this.client.emails.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
    });

    if (error || !data?.id) {
      throw new Error(error?.message ?? "Resend did not return a message id");
    }

    return { id: data.id };
  }
}
