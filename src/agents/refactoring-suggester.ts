import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_SUGGESTER_PROMPT } from '../prompts/refactoring-suggester.prompt.js';

/**
 * Subagent dedicated to detecting code smells, dead code sections,
 * modern syntax upgrade candidates, and pattern-oriented refactoring targets.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Discovers architectural refinement opportunities, redundant logic branches, ' +
    'and modernization candidates within an individual source file. Produces a ' +
    'RefactoringSuggestion JSON record. Trigger this worker when code structure ' +
    'and maintainability require optimization.',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  model: 'inherit',
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
};