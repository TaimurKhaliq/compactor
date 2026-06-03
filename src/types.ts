export type LikelyArea = "frontend" | "backend" | "tests" | "config" | "docs" | "mixed" | "unknown";

export interface RawCommit {
  hash: string;
  date: string;
  message: string;
  changedFiles: string[];
}

export interface CommitMetadata extends RawCommit {
  shortHash: string;
  fileExtensions: string[];
  likelyArea: LikelyArea;
  repeatedPathPatterns: string[];
  touchedDirectories: string[];
  commitUrl?: string;
}

export interface PatternCount {
  pattern: string;
  count: number;
  commits: string[];
}

export interface ScanResult {
  repoRoot: string;
  repositorySource?: "local" | "remote";
  repositoryInput?: string;
  workspacePath?: string;
  remoteUrl?: string;
  generatedAt: string;
  commitsAnalyzed: number;
  commits: CommitMetadata[];
  repeatedPathPatterns: PatternCount[];
}

export interface EvidenceCommit {
  hash: string;
  shortHash: string;
  message: string;
  changedFiles: string[];
  url?: string;
}

export interface CandidateSkill {
  id: string;
  name: string;
  confidence: number;
  evidenceCommits: EvidenceCommit[];
  commonFiles: string[];
  commonDirectories: string[];
  observedConventions: string[];
  suggestedValidationCommands: string[];
  matchedPatterns: string[];
  rationale: string;
}

export interface MiningResult {
  repoRoot: string;
  generatedAt: string;
  commitsAnalyzed: number;
  candidates: CandidateSkill[];
}

export interface GeneratedSkillFile {
  skillId: string;
  path: string;
}

export interface GenerationResult {
  repoRoot: string;
  generatedAt: string;
  agentsPath: string;
  skillFiles: GeneratedSkillFile[];
}
