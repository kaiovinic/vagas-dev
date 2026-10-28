import { Controller, Get } from '@nestjs/common';

import {
  GetMarketInsightsUseCase,
  type MarketInsights,
} from '@/application/use-cases/get-market-insights.use-case';

@Controller('api/market')
export class MarketController {
  constructor(private readonly market: GetMarketInsightsUseCase) {}

  /** Aba `Mercado`: stacks mais pedidas, senioridade e modalidade nas ultimas 72h. */
  @Get()
  async getInsights(): Promise<MarketInsights> {
    return this.market.execute();
  }
}
