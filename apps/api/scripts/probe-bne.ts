/**
 * Conferencia manual do coletor do BNE contra o site de verdade.
 *
 *   npx tsx scripts/probe-bne.ts
 *
 * Nao escreve nada no banco: so coleta e imprime o que o parser leu.
 */
import 'reflect-metadata';

import { AxiosHttpClient } from '@/infra/http/axios-http-client';
import { BneScraperProvider } from '@/infra/scrapers/bne-scraper-provider';

async function main(): Promise<void> {
  const provider = new BneScraperProvider(
    new AxiosHttpClient(),
    { getLastRunAt: async () => null },
    [
      { role: 'desenvolvedor', city: 'salvador-ba' },
      { role: 'desenvolvedor-full-stack', homeOffice: true },
    ],
    undefined,
    6,
  );

  const jobs = await provider.scrape();

  console.log(`${jobs.length} vaga(s) lida(s)\n`);

  for (const job of jobs) {
    console.log(`[${job.publishedAt?.toISOString().slice(0, 10)}] ${job.title}`);
    console.log(`   ${job.company} | ${job.location} | ${job.workModel}`);
    console.log(`   ${job.url}`);
    console.log(`   ${(job.description ?? '').slice(0, 90).replace(/\n/g, ' ')}\n`);
  }
}

void main();
