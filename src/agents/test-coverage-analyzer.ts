import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts/test-coverage-analyzer.prompt.js';

/**
 * Subagent dedicated to statically analyzing test suite completeness,
 * detecting uncovered logic branches, and formulating actionable unit tests.
 */
export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Assesses test coverage and missing assertions for a specified modified file, ' +
    'mapping untracked execution paths and generating production-ready test snippets. ' +
    'Outputs a structured TestCoverageResult payload. Invoke this worker to verify ' +
    'testing completeness across modified files.',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
};