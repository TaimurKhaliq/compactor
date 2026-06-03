import type { CandidateSkill, MiningResult, ScanResult } from "../types.js";

export function generateReport(scan: ScanResult, mining: MiningResult): string {
  const repeatedOccurrences = mining.candidates.reduce(
    (sum, candidate) => sum + Math.max(0, candidate.evidenceCommits.length - 1),
    0
  );
  const estimatedTokens = repeatedOccurrences * 1200;

  return [
    "Compactor Report",
    "",
    `Commits analyzed: ${scan.commitsAnalyzed}`,
    `Candidate skills found: ${mining.candidates.length}`,
    `Estimated token-saving rationale: ${renderTokenRationale(repeatedOccurrences, estimatedTokens)}`,
    "",
    "Top repeated patterns:",
    ...renderTopPatterns(scan),
    "",
    "Candidate skills:",
    ...renderCandidateSkills(mining.candidates),
    ""
  ].join("\n");
}

function renderTokenRationale(repeatedOccurrences: number, estimatedTokens: number): string {
  if (repeatedOccurrences === 0) {
    return "No repeated candidates yet; scan more history after several feature commits.";
  }

  return `${repeatedOccurrences} repeated occurrences could avoid roughly ${estimatedTokens.toLocaleString()} rediscovery tokens by moving conventions into reusable skills.`;
}

function renderTopPatterns(scan: ScanResult): string[] {
  if (scan.repeatedPathPatterns.length === 0) {
    return ["- No repeated path patterns found in the scanned commit range."];
  }

  return scan.repeatedPathPatterns.slice(0, 8).map((pattern) => `- ${pattern.pattern}: ${pattern.count} commits`);
}

function renderCandidateSkills(candidates: CandidateSkill[]): string[] {
  if (candidates.length === 0) {
    return ["- No candidate skills found. Try increasing --limit or scan after more commits land."];
  }

  return candidates.map((candidate) => {
    const directories = candidate.commonDirectories.slice(0, 2).join(", ") || "mixed directories";
    return `- ${candidate.name} (${Math.round(candidate.confidence * 100)}%): ${candidate.evidenceCommits.length} commits; common area: ${directories}`;
  });
}
