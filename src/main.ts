import * as dotenv from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { logger } from './utils/logger.js';
import { ReviewError, formatError } from './utils/error-handler.js';

dotenv.config();

const MANDATORY_ENVIRONMENT_KEYS = ['ANTHROPIC_MODEL', 'GITHUB_TOKEN'] as const;
const OUTPUT_DIRECTORY = 'reports';

function parseCliParameters(): { org: string; repository: string; pullId: number } {
  const [, , org, repository, pullInput] = process.argv;

  if (!org || !repository || !pullInput) {
    console.error('Usage: npm run dev -- <owner> <repo> <pr-number>');
    console.error('Example: npm run dev -- facebook react 12345');
    process.exit(1);
  }

  const pullId = Number(pullInput);
  const isValidInteger = Number.isInteger(pullId) && pullId > 0 && String(pullId) === pullInput;

  if (!isValidInteger) {
    console.error('Error: pr-number must be a positive integer.');
    process.exit(1);
  }

  return { org, repository, pullId };
}

function assertAuthenticationConfig(): void {
  const unsetKeys = MANDATORY_ENVIRONMENT_KEYS.filter((key) => !process.env[key]);

  const hasAnthropicDirectKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasBedrockConfig = Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION
  );

  if (unsetKeys.length > 0 || (!hasAnthropicDirectKey && !hasBedrockConfig)) {
    console.error('Missing required environment configuration:');
    unsetKeys.forEach((key) => console.error(`  - ${key}`));
    console.error('Also set either ANTHROPIC_API_KEY or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION.');
    process.exit(1);
  }

  const authMechanism = hasBedrockConfig && !hasAnthropicDirectKey
    ? 'AWS Bedrock authentication'
    : 'Anthropic API authentication';

  console.log(`Lock Using ${authMechanism}`);
}

async function bootstrap(): Promise<void> {
  const { org, repository, pullId } = parseCliParameters();
  assertAuthenticationConfig();

  logger.info(`Starting review of ${org}/${repository} PR #${pullId}...`);

  try {
    const orchestrator = new CodeReviewOrchestrator();
    const reviewData = await orchestrator.reviewPullRequest(org, repository, pullId);

    const formatter = new ReportGenerator();
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });

    const jsonContent = formatter.generateJSONReport(reviewData);
    const mdContent = formatter.generateMarkdownReport(reviewData);
    const htmlContent = formatter.generateHTMLReport(reviewData);

    const canonicalOutputs = {
      json: resolve(OUTPUT_DIRECTORY, 'report.json'),
      markdown: resolve(OUTPUT_DIRECTORY, 'report.md'),
      html: resolve(OUTPUT_DIRECTORY, 'report.html'),
    };

    const archivedPrefix = `${org}_${repository}_${pullId}`;
    const archivedOutputs = {
      json: resolve(OUTPUT_DIRECTORY, `${archivedPrefix}.json`),
      markdown: resolve(OUTPUT_DIRECTORY, `${archivedPrefix}.md`),
      html: resolve(OUTPUT_DIRECTORY, `${archivedPrefix}.html`),
    };

    await Promise.all([
      // Canonical outputs required by rubric
      writeFile(canonicalOutputs.json, jsonContent, 'utf-8'),
      writeFile(canonicalOutputs.markdown, mdContent, 'utf-8'),
      writeFile(canonicalOutputs.html, htmlContent, 'utf-8'),
      // Historical/archive records
      writeFile(archivedOutputs.json, jsonContent, 'utf-8'),
      writeFile(archivedOutputs.markdown, mdContent, 'utf-8'),
      writeFile(archivedOutputs.html, htmlContent, 'utf-8'),
    ]);

    logger.info('Review complete. Canonical reports written:');
    logger.info(`  JSON:     ${canonicalOutputs.json}`);
    logger.info(`  Markdown: ${canonicalOutputs.markdown}`);
    logger.info(`  HTML:     ${canonicalOutputs.html}`);
    logger.info(`  Overall score: ${reviewData.summary.overallScore}/100`);
  } catch (failure) {
    if (failure instanceof ReviewError) {
      console.error(`Review failed [${failure.code}]: ${failure.message}`);
    } else {
      console.error('Error:', formatError(failure));
    }
    process.exit(1);
  }
}

bootstrap();