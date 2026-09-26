import { query } from '@anthropic-ai/claude-agent-sdk';
import { mcpServersConfig } from './config/mcp.config.js';
import { agents } from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import { ReviewReportSchema, ReviewReportJSONSchema, type ReviewReport } from './types/report-types.js';
import { logger } from './utils/logger.js';
import { withRetry, withTimeout, ReviewError, ErrorCodes, formatError } from './utils/error-handler.js';
import { RateLimiter, globalRateLimiter, type RateLimiterConfig } from './utils/rate-limiter.js';

const DEFAULT_TIMEOUT_WINDOW_MS = 8 * 60 * 1000;
const FALLBACK_MAX_TURNS = 60;
const ESTIMATED_REVIEW_BUDGET_TOKENS = 30000;

const ENABLED_AGENT_TOOLS = [
  'Task',
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_file_contents',
  'mcp__eslint__lint-files',
] as const;

/**
 * Initialization parameters for the review orchestrator pipeline.
 */
export interface OrchestratorOptions {
  /** Custom throttle controller (falls back to shared instance) */
  rateLimiter?: RateLimiter;
  /** Parameters used to instantiate an isolated RateLimiter */
  rateLimitConfig?: Partial<RateLimiterConfig>;
  /** Model identifier override; defaults to ANTHROPIC_MODEL environment variable */
  model?: string;
  /** Maximum conversational interaction iterations */
  maxTurns?: number;
}

/**
 * Superintends delegated code analysis across specialist agents.
 */
export class CodeReviewOrchestrator {
  private readonly limiter: RateLimiter;
  private readonly targetModel?: string;
  private readonly turnLimit: number;

  constructor(options: OrchestratorOptions = {}) {
    this.limiter =
      options.rateLimiter ??
      (options.rateLimitConfig ? new RateLimiter(options.rateLimitConfig) : globalRateLimiter);
    this.targetModel = options.model;
    this.turnLimit = options.maxTurns ?? FALLBACK_MAX_TURNS;
  }

  /**
   * Dispatches and aggregates automated multi-agent code analysis for a target pull request.
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const selectedModel = this.targetModel ?? process.env.ANTHROPIC_MODEL;
    if (!selectedModel) {
      throw new ReviewError(
        'ANTHROPIC_MODEL environment variable is required',
        ErrorCodes.INVALID_CONFIG
      );
    }

    const initiationTimestamp = Date.now();
    logger.info('Starting code review', { owner, repo, prNumber });

    await this.limiter.acquire(ESTIMATED_REVIEW_BUDGET_TOKENS);
    try {
      const rawReportPayload = await withRetry(
        () =>
          withTimeout(
            () => this.executeAgentQuery(owner, repo, prNumber, selectedModel),
            DEFAULT_TIMEOUT_WINDOW_MS,
            `Review of ${owner}/${repo}#${prNumber} timed out`
          ),
        3,
        1000
      );

      const validation = ReviewReportSchema.safeParse(rawReportPayload);
      if (!validation.success) {
        throw new ReviewError(
          `Orchestrator output failed schema validation: ${validation.error.message}`,
          ErrorCodes.STRUCTURED_OUTPUT_FAILED,
          { issues: validation.error.issues }
        );
      }

      logger.info('Code review completed', {
        owner,
        repo,
        prNumber,
        score: validation.data.summary.overallScore,
        duration: Date.now() - initiationTimestamp,
        status: 'success',
      });

      return validation.data;
    } catch (err) {
      logger.error('Code review failed', {
        owner,
        repo,
        prNumber,
        error: formatError(err),
        status: 'failed',
      });
      throw err;
    } finally {
      this.limiter.release();
    }
  }

  private async executeAgentQuery(
    owner: string,
    repo: string,
    prNumber: number,
    model: string
  ): Promise<unknown> {
    const userPrompt = buildOrchestratorPrompt(owner, repo, prNumber);

    const stream = query({
      prompt: userPrompt,
      options: {
        model,
        maxTurns: this.turnLimit,
        permissionMode: 'default',
        mcpServers: mcpServersConfig,
        agents,
        allowedTools: [...ENABLED_AGENT_TOOLS],
        outputFormat: {
          type: 'json_schema',
          schema: ReviewReportJSONSchema,
        },
      },
    });

    let extractedOutput: unknown = null;
    let failureDetail: string | null = null;

    for await (const chunk of stream) {
      if (chunk.type === 'result') {
        if (chunk.subtype === 'success' && chunk.structured_output) {
          extractedOutput = chunk.structured_output;
        } else if (chunk.subtype !== 'success') {
          failureDetail = chunk.subtype;
        }
      } else if (chunk.type === 'assistant') {
        logger.debug('Orchestrator turn', { content: chunk.message?.content });
      }
    }

    if (!extractedOutput) {
      const failureReason = failureDetail
        ? `Orchestrator run ended with SDK failure subtype "${failureDetail}"`
        : 'Orchestrator did not produce a structured_output payload';

      throw new ReviewError(failureReason, ErrorCodes.AGENT_FAILED, {
        owner,
        repo,
        prNumber,
        failureSubtype: failureDetail,
      });
    }

    return extractedOutput;
  }
}