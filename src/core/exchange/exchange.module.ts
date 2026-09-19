import { Module, OnModuleInit } from '@nestjs/common';
import { ExchangeRegistry } from './exchange-registry';
import { registerAllAdapters } from '../../adapters';

@Module({
  providers: [ExchangeRegistry],
  exports: [ExchangeRegistry],
})
export class ExchangeModule implements OnModuleInit {
  constructor(private readonly registry: ExchangeRegistry) {}

  onModuleInit() {
    registerAllAdapters(this.registry);
  }
}
