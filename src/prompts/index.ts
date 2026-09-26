/**
 * Centralized prompt management
 *
 * TODO: Export all your prompts here
 *
 * Example:
 * export { buildOrchestratorPrompt } from './orchestrator.prompt';
 * export { CODE_QUALITY_ANALYZER_PROMPT } from './code-quality-analyzer.prompt';
 * export { TEST_COVERAGE_ANALYZER_PROMPT } from './test-coverage-analyzer.prompt';
 * export { REFACTORING_SUGGESTER_PROMPT } from './refactoring-suggester.prompt';
 
export * from './code-quality-analyzer.prompt.js';
export * from './test-coverage-analyzer.prompt.js';
export * from './refactoring-suggester.prompt.js';
export * from './orchestrator.prompt.js';
*/

export { buildOrchestratorPrompt } from './orchestrator.prompt';
export { CODE_QUALITY_ANALYZER_PROMPT } from './code-quality-analyzer.prompt';
export { TEST_COVERAGE_ANALYZER_PROMPT } from './test-coverage-analyzer.prompt';
export { REFACTORING_SUGGESTER_PROMPT } from './refactoring-suggester.prompt';