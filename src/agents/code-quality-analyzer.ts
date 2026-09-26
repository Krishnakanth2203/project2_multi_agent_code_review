import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts/code-quality-analyzer.prompt.js';

/**
 * Subagent responsible for inspecting an isolated file for runtime security hazards,
 * performance bottlenecks, and general code hygiene violations.
 */
export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Performs an in-depth security and hygiene audit on a single source module, ' +
    'uncovering logic bugs, architectural debt, and execution inefficiencies. ' +
    'Emits a structured CodeQualityResult object. Delegate to this worker whenever ' +
    'evaluating static code health or vulnerability risks.',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__eslint__lint-files'],
};