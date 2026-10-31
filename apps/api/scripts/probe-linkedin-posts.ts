/**
 * Mostra, passo a passo, o que a busca de publicacoes do LinkedIn devolve.
 *
 *   npm run posts:probe --workspace @devradar/api
 *
 * Nao escreve nada no banco: so consulta, decodifica a data pelo snowflake e
 * roda cada publicacao pelo motor de regras, imprimindo o veredito.
 */
import 'reflect-metadata';
import 'dotenv/config';

import { Job } from '@/domain/entities/job';
import { JobRuleEngine } from '@/domain/services/job-rule-engine';
import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { AxiosHttpClient } from '@/infra/http/axios-http-client';
import { LinkedinPostsScraperProvider } from '@/infra/scrapers/linkedin-posts-scraper-provider';

async function main(): Promise<void> {
  const provider = new LinkedinPostsScraperProvider(new AxiosHttpClient());

  console.log('Consulta enviada ao buscador:\n');
  console.log(`  ${provider.query}\n`);
  console.log('Buscando...\n');

  const posts = await provider.scrape();

  if (posts.length === 0) {
    console.log('Nenhuma publicacao voltou. Confira SERP_API_KEY no .env.');

    return;
  }

  console.log(`${posts.length} publicacao(oes) reconhecida(s) como post do LinkedIn:\n`);

  const engine = new JobRuleEngine();
  const now = new Date();
  const aprovadas: RawJobProps[] = [];

  for (const props of posts) {
    const job = toJob(props, now);
    const evaluation = job
      ? engine.evaluate(job, now, { tags: props.tags ?? [], origin: 'SOCIAL_POST' })
      : undefined;

    const idade = props.publishedAt
      ? `${Math.round((now.getTime() - props.publishedAt.getTime()) / 3_600_000)}h`
      : '?';

    const veredito = !evaluation
      ? 'ENTIDADE INVALIDA'
      : evaluation.approved
        ? 'APROVADA'
        : evaluation.rejectionReasons.join(', ');

    console.log(`  [${idade.padStart(4)}] ${props.company}`);
    console.log(`         ${props.title.slice(0, 92)}`);
    console.log(`         ${veredito}`);

    if (evaluation?.approved && job) {
      aprovadas.push(props);
    }
  }

  reportApproved(aprovadas);
}

function reportApproved(aprovadas: readonly RawJobProps[]): void {
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${aprovadas.length} publicacao(oes) APROVADA(S) pelo motor de regras\n`);

  for (const props of aprovadas) {
    console.log(`  ${props.title}`);
    console.log(`     publicada por : ${props.company}`);
    console.log(`     publicada em  : ${props.publishedAt?.toISOString()} (do snowflake)`);
    console.log(`     link          : ${props.url}`);
    console.log('');
  }
}

function toJob(props: RawJobProps, reference: Date): Job | undefined {
  try {
    return Job.create({
      title: props.title,
      company: props.company,
      source: props.source,
      url: props.url,
      publishedAt: props.publishedAt ?? reference,
      description: props.description ?? '',
      location: props.location ?? '',
      workModel: props.workModel ?? 'UNKNOWN',
    });
  } catch {
    return undefined;
  }
}

main().catch((error: unknown) => {
  console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
