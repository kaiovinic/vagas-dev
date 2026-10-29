/**
 * Roda os coletores e mostra POR QUE cada vaga foi reprovada.
 *
 *   npm run jobs:analyze --workspace @devradar/api
 *
 * A captura normal nao guarda vaga reprovada — so o contador. Este script
 * existe para responder a pergunta que o contador nao responde: o filtro esta
 * descartando vaga legitima?
 *
 * Nao escreve nada no banco.
 */
import 'reflect-metadata';
import 'dotenv/config';

import { Job } from '@/domain/entities/job';
import { JobRejectionReason, JobRuleEngine } from '@/domain/services/job-rule-engine';
import { LOCATION_KEYWORDS, REMOTE_LOCATION_LABEL } from '@/domain/services/job-rule-catalog';
import { normalizeForMatching } from '@/domain/value-objects/text-normalizer';
import type { RawJobProps } from '@/domain/dtos/raw-job-props';
import { AxiosHttpClient } from '@/infra/http/axios-http-client';
import { CoodeshScraperProvider } from '@/infra/scrapers/coodesh-scraper-provider';
import { GithubIssuesScraperProvider } from '@/infra/scrapers/github-issues-scraper-provider';
import { GupyScraperProvider } from '@/infra/scrapers/gupy-scraper-provider';
import { LinkedinGuestScraperProvider } from '@/infra/scrapers/linkedin-guest-scraper-provider';
import { ProgramathorScraperProvider } from '@/infra/scrapers/programathor-scraper-provider';
import { RemotarScraperProvider } from '@/infra/scrapers/remotar-scraper-provider';
import { SolidesScraperProvider } from '@/infra/scrapers/solides-scraper-provider';

/** Municipios de Salvador e Regiao Metropolitana, sem o rotulo de remoto. */
const LOCAL_LABELS = LOCATION_KEYWORDS.filter(
  (group) => group.label !== REMOTE_LOCATION_LABEL,
).flatMap((group) => group.aliases.map((alias) => normalizeForMatching(alias)));

async function main(): Promise<void> {
  const http = new AxiosHttpClient();
  const providers = [
    new GupyScraperProvider(http),
    new GithubIssuesScraperProvider(http),
    new LinkedinGuestScraperProvider(http),
    new RemotarScraperProvider(http),
    new ProgramathorScraperProvider(http),
    new SolidesScraperProvider(http),
    new CoodeshScraperProvider(http),
  ];

  console.log('Coletando de todas as fontes...\n');

  const collected = await Promise.all(providers.map((provider) => provider.scrape()));
  const raw = collected.flat();
  const engine = new JobRuleEngine();
  const now = new Date();

  const motivos = new Map<string, number>();
  const locaisDescartados: { props: RawJobProps; reasons: readonly string[] }[] = [];
  let aprovadas = 0;

  for (const props of raw) {
    const job = toJob(props, now);

    if (!job) {
      increment(motivos, 'ENTIDADE_INVALIDA');
      continue;
    }

    const evaluation = engine.evaluate(job, now, props.tags ?? []);

    if (evaluation.approved) {
      aprovadas += 1;
      continue;
    }

    for (const reason of evaluation.rejectionReasons) {
      increment(motivos, reason);
    }

    if (mentionsLocal(props)) {
      locaisDescartados.push({ props, reasons: evaluation.rejectionReasons });
    }
  }

  console.log(`${raw.length} vagas coletadas | ${aprovadas} aprovadas\n`);
  console.log('Motivos de reprovacao (uma vaga pode ter mais de um):');

  for (const [motivo, total] of [...motivos].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${motivo.padEnd(22)} ${total}`);
  }

  reportLocal(locaisDescartados);
}

/** O coracao da investigacao: o que Salvador e a RMS estao perdendo. */
function reportLocal(
  descartadas: readonly { props: RawJobProps; reasons: readonly string[] }[],
): void {
  console.log(`\n${descartadas.length} vaga(s) citando Salvador/RMS foram reprovadas.`);

  const soPorStack = descartadas.filter(
    (entry) =>
      entry.reasons.length === 1 && entry.reasons[0] === JobRejectionReason.StackNotMatched,
  );

  if (descartadas.length > 0) {
    console.log('\nTodas, com o motivo:');

    for (const { props, reasons } of descartadas.slice(0, 30)) {
      console.log(`  [${reasons.join(', ')}]`);
      console.log(`     ${props.title.slice(0, 70)} — ${props.company.slice(0, 30)}`);
      console.log(`     ${(props.location ?? '(sem local)').slice(0, 50)} | ${props.source}`);
    }
  }

  console.log(
    `\n>>> ${soPorStack.length} reprovada(s) EXCLUSIVAMENTE por stack ` +
      '(passariam no resto do filtro).',
  );

  for (const { props } of soPorStack) {
    console.log(`     ${props.title.slice(0, 70)} — ${props.company.slice(0, 30)}`);
  }
}

function mentionsLocal(props: RawJobProps): boolean {
  const text = normalizeForMatching(
    [props.title, props.location ?? '', props.description ?? '', ...(props.tags ?? [])].join(' '),
  );

  return LOCAL_LABELS.some((label) => text.includes(label));
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

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

main().catch((error: unknown) => {
  console.error(`\nFalhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
