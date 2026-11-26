import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { emptyCheck, probe, ServiceCheck } from './probe';
import { MonitoringStore } from './monitoring.store';
import { ServiceName, targets } from './targets';

const INTERVAL_MS = 30_000;

@Injectable()
export class MonitoringService implements OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly targets = targets();
  private current = new Map<ServiceName, ServiceCheck>();
  private timer?: NodeJS.Timeout;
  private active?: Promise<void>;
  private stopped = false;

  constructor(private readonly store: MonitoringStore) {}

  async start(): Promise<void> {
    const recovered = await this.store.latest();
    this.current = new Map(recovered.map((check) => [check.service, check]));
    if (this.stopped) return;
    this.run();
    this.timer = setInterval(() => this.run(), INTERVAL_MS);
  }

  private run(): void {
    if (this.active || this.stopped) return;
    this.active = this.sample().catch(() => {
      this.logger.error('El ciclo de sondeo terminó con un error.');
    }).finally(() => {
      this.active = undefined;
    });
  }

  private async sample(): Promise<void> {
    const checks = await Promise.all(
      this.targets.map((target) => probe(target, this.current.get(target.service) ?? emptyCheck(target))),
    );
    this.current = new Map(checks.map((check) => [check.service, check]));
    await this.store.persist(checks);
  }

  latest(): ServiceCheck[] {
    return this.targets.map((target) => this.current.get(target.service) ?? emptyCheck(target));
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.active;
  }
}
