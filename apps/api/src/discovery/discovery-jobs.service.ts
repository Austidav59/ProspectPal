import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  CampaignRunStatus,
  JobStatus,
  type CampaignRun,
  type DiscoveryJob,
  type SearchSource,
} from "../generated/prisma";

import { PrismaService } from "../database/prisma.service";
import { DiscoveryProcessor } from "./discovery.processor";

@Injectable()
export class DiscoveryJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryJobsService.name);
  private timer: NodeJS.Timeout | undefined;
  private catchUpTimer: NodeJS.Timeout | undefined;
  private draining = false;
  private catchingUp = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: DiscoveryProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    const now = new Date();
    await this.prisma.discoveryJob.updateMany({
      where: { status: JobStatus.RUNNING },
      data: {
        status: JobStatus.QUEUED,
        lockedAt: null,
        availableAt: now,
      },
    });

    this.timer = setInterval(() => void this.drain(), 1_000);
    this.timer.unref();
    this.catchUpTimer = setInterval(
      () => void this.catchUpStuckScans(),
      15_000,
    );
    this.catchUpTimer.unref();
    void this.drain();
    void this.catchUpStuckScans();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.catchUpTimer) clearInterval(this.catchUpTimer);
  }

  async enqueue(
    campaignId: string,
    source: SearchSource,
    ownerUserId: string,
  ): Promise<CampaignRun> {
    const run = await this.prisma.$transaction(async (transaction) => {
      const createdRun = await transaction.campaignRun.create({
        data: {
          campaignId,
          source,
          ownerUserId,
          status: CampaignRunStatus.QUEUED,
        },
      });
      await transaction.discoveryJob.create({
        data: {
          runId: createdRun.id,
          availableAt: new Date(),
        },
      });
      return createdRun;
    });
    void this.drain();
    return run;
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let job = await this.claimNextJob();
      while (job) {
        await this.processJob(job);
        job = await this.claimNextJob();
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown queue failure";
      this.logger.error(`Discovery queue drain failed: ${message}`);
    } finally {
      this.draining = false;
    }
  }

  private async claimNextJob(): Promise<DiscoveryJob | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const job = await transaction.discoveryJob.findFirst({
          where: {
            status: JobStatus.QUEUED,
            availableAt: { lte: new Date() },
          },
          orderBy: { availableAt: "asc" },
        });
        if (!job) return null;

        const now = new Date();
        const updated = await transaction.discoveryJob.updateMany({
          where: { id: job.id, status: JobStatus.QUEUED },
          data: {
            status: JobStatus.RUNNING,
            attempts: job.attempts + 1,
            lockedAt: now,
          },
        });

        return updated.count === 1
          ? {
              ...job,
              status: JobStatus.RUNNING,
              attempts: job.attempts + 1,
              lockedAt: now,
            }
          : null;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }

  private async processJob(job: DiscoveryJob): Promise<void> {
    try {
      await this.processor.process(job.runId);
      await this.prisma.discoveryJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPLETED,
          lockedAt: null,
          errorMessage: null,
        },
      });
    } catch (error: unknown) {
      const finalAttempt = job.attempts >= job.maxAttempts;
      const delay = 2_000 * 2 ** Math.max(0, job.attempts - 1);
      const message =
        error instanceof Error ? error.message : "Unknown discovery failure";
      this.logger.error(
        `Discovery job ${job.id} attempt ${job.attempts}/${job.maxAttempts} failed: ${message}`,
      );
      await this.prisma.discoveryJob.update({
        where: { id: job.id },
        data: {
          status: finalAttempt ? JobStatus.FAILED : JobStatus.QUEUED,
          availableAt: finalAttempt
            ? job.availableAt
            : new Date(Date.now() + delay),
          lockedAt: null,
          errorMessage: message.slice(0, 1_000),
        },
      });
    }
  }

  private async catchUpStuckScans(): Promise<void> {
    if (this.catchingUp || this.draining) return;
    this.catchingUp = true;
    try {
      // Fair batching: up to 8 orgs, 5 leads each, so one busy org can't starve others.
      await this.processor.enrichPendingLeads(5, 8);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown enrichment failure";
      this.logger.error(`Contact enrichment catch-up failed: ${message}`);
    } finally {
      this.catchingUp = false;
    }
  }
}
