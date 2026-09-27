import { describe, it, expect, vi } from 'vitest';
import { ReviewReportSchema, type ReviewReport } from '../src/types/report-types.js';
import {
  withRetry,
  withTimeout,
  ReviewError,
  ErrorCodes,
  formatError,
  isReviewError,
} from '../src/utils/error-handler.js';
import { ReportGenerator } from '../src/utils/report-generator.js';

const validReport: ReviewReport = {
  pullRequest: {
    owner: 'octocat',
    repo: 'Hello-World',
    number: 1,
  },
  fileReviews: [],
  summary: {
    totalFiles: 0,
    overallScore: 100,
    criticalIssues: 0,
    highPriorityTests: 0,
    refactoringOpportunities: 0,
  },
  recommendations: [],
  metadata: {
    analyzedAt: new Date().toISOString(),
    duration: 1,
    agentVersions: {},
  },
};

describe('ReviewReportSchema validation', () => {
  it('accepts a valid review report', () => {
    const result = ReviewReportSchema.safeParse(validReport);
    expect(result.success).toBe(true);
  });

  it('rejects an invalid report missing required summary metrics', () => {
    const invalidReport = {
      ...validReport,
      summary: undefined,
    };
    const result = ReviewReportSchema.safeParse(invalidReport);
    expect(result.success).toBe(false);
  });

  it('rejects an invalid report missing pull request metadata', () => {
    const invalidReport = {
      ...validReport,
      pullRequest: { owner: 'octocat' }, // missing repo and number
    };
    const result = ReviewReportSchema.safeParse(invalidReport);
    expect(result.success).toBe(false);
  });
});

describe('withRetry utility', () => {
  it('retries transient failures before succeeding', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) throw new Error('temporary');
        return 'ok';
      },
      3,
      1
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });

  it('resolves immediately when first attempt succeeds', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(mockFn, 3, 5);

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('throws ReviewError with RETRY_EXHAUSTED when all retries fail', async () => {
    const alwaysFails = async () => {
      throw new Error('persistent network issue');
    };

    await expect(withRetry(alwaysFails, 2, 5)).rejects.toThrowError(
      expect.objectContaining({
        code: ErrorCodes.RETRY_EXHAUSTED,
      })
    );
  });
});

describe('withTimeout utility', () => {
  it('returns result when callback resolves within timeout window', async () => {
    const quickTask = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('done'), 10));

    const result = await withTimeout(quickTask, 100);
    expect(result).toBe('done');
  });

  it('rejects with AGENT_TIMEOUT when callback exceeds timeout limit', async () => {
    const slowTask = () =>
      new Promise<string>((resolve) => setTimeout(() => resolve('delayed'), 100));

    await expect(withTimeout(slowTask, 20)).rejects.toThrowError(
      expect.objectContaining({
        code: ErrorCodes.AGENT_TIMEOUT,
      })
    );
  });
});

describe('Error handling utilities', () => {
  it('identifies ReviewError instances with isReviewError', () => {
    const domainError = new ReviewError('Invalid configuration', ErrorCodes.INVALID_CONFIG);
    const standardError = new Error('Generic error');

    expect(isReviewError(domainError)).toBe(true);
    expect(isReviewError(standardError)).toBe(false);
  });

  it('formats error messages correctly', () => {
    const error = new ReviewError('Resource not found', ErrorCodes.FILE_NOT_FOUND);
    expect(formatError(error)).toBe(`[${ErrorCodes.FILE_NOT_FOUND}] Resource not found`);
  });
});

describe('ReportGenerator', () => {
  const generator = new ReportGenerator();

  it('generates valid JSON report matching input structure', () => {
    const jsonString = generator.generateJSONReport(validReport);
    const parsed = JSON.parse(jsonString);

    expect(parsed.pullRequest.owner).toBe('octocat');
    expect(parsed.pullRequest.repo).toBe('Hello-World');
    expect(parsed.summary.overallScore).toBe(100);
  });

 it('generates non-empty Markdown report', () => {
    const md = generator.generateMarkdownReport(validReport);
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('Code Review Report');
  });

  it('generates non-empty HTML report', () => {
    const html = generator.generateHTMLReport(validReport);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('<!DOCTYPE html>');
  });
});