import { ReviewReportJSONSchema } from '../types/report-types.js';

/**
 * Constructs the primary supervisor prompt coordinating multi-agent PR analysis.
 */
export function buildOrchestratorPrompt(owner: string, repo: string, prNumber: number): string {
  return `
You are the Chief Review Orchestrator overseeing an automated multi-agent code analysis workflow for pull request #${prNumber} on repository "${owner}/${repo}".

Execute the analysis through the following consecutive phases:

### Phase 1: Ingest Pull Request Metadata & Workspace Diffs
Invoke GitHub MCP capabilities ("mcp__github__get_pull_request", "mcp__github__get_pull_request_files", and "mcp__github__get_file_contents") to gather:
- PR title, author summary, and description context.
- Full catalog of changed files, their diff chunks, and full file contents.
Ensure raw file data is fully retrieved before initiating subagent tasks; subagents require complete code contexts to avoid hallucinated feedback.

### Phase 2: Concurrent Multi-Perspective Subagent Delegation
Each subagent operates on a single file boundary. For every modified file in the PR, spawn independent subagent tasks via the Task tool by direct identifier:
- "Use the code-quality-analyzer agent to evaluate security vulnerabilities, logic defects, and performance issues in <file>. Return structured JSON strictly conforming to its target schema for this file."
- "Use the test-coverage-analyzer agent to inspect testing gaps, missing assertions, and untracked code paths for <file>. Return structured JSON strictly conforming to its target schema for this file."
- "Use the refactoring-suggester agent to identify modernization opportunities, architectural refactoring, and dead code in <file>. Return structured JSON strictly conforming to its target schema for this file."

Where platform concurrency allows, execute subagent tasks for each file concurrently. Validate every subagent response against its respective schema contract. In the event of a malformed JSON reply, issue one retry attempt. If the subagent fails on retry, gracefully skip that facet for the target file without synthesising dummy fallback metrics.

### Phase 3: Synthesis & Report Aggregation
Map each inspected file to a structured entry in fileReviews[]:
  {
    file: string,
    codeQuality: <CodeQualityResult>,
    testCoverage: <TestCoverageResult>,
    refactorings: <RefactoringSuggestion>
  }

Assemble the aggregate summary:
- summary.totalFiles: Integer count of reviewed files.
- summary.overallScore: Composite health index (0 to 100). Weight files displaying "critical" and "high" severity bugs or vulnerabilities heavily downward; a critical CVE should drastically suppress the aggregate project score.
- summary.criticalIssues: Total number of issues tagged with severity "critical" across all quality reports.
- summary.highPriorityTests: Total number of uncovered paths tagged with "critical" or "high" priority across all coverage reports.
- summary.refactoringOpportunities: Sum total of architectural suggestions across all files.

Assemble recommendations[]:
Select between 3 and 8 prioritized, actionable initiatives across the reviewed PR:
  {
    priority: "critical" | "high" | "medium" | "low",
    category: string,
    description: string,
    files: string[]
  }
Order recommendations strictly: address critical security exposures first, high-risk testing deficits second, followed by high-leverage architectural refactors.

Populate metadata attributes:
- analyzedAt: ISO 8601 UTC timestamp marking completion.
- duration: Total elapsed operational runtime in milliseconds.
- agentVersions: {
    "code-quality-analyzer": "1.0.0",
    "test-coverage-analyzer": "1.0.0",
    "refactoring-suggester": "1.0.0"
  }

The generated structured output must match this JSON Schema specification:

${JSON.stringify(ReviewReportJSONSchema, null, 2)}

Output raw, structured JSON satisfying the target schema exclusively. Do not wrap the response with introductory prose or supplementary markdown blocks.
`;
}