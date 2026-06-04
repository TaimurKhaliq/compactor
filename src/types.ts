export type LikelyArea = "frontend" | "backend" | "tests" | "config" | "docs" | "mixed" | "unknown";
export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "unknown";

export interface DiffSignal {
  type:
    | "exported-symbol"
    | "test-name"
    | "cli-command"
    | "cli-option"
    | "package-script"
    | "config-key"
    | "api-route"
    | "route-handler";
  value: string;
  filePath: string;
  detail?: string;
}

export interface FileDiffSummary {
  filePath: string;
  oldPath?: string;
  status: FileChangeStatus;
  addedLineCount: number;
  deletedLineCount: number;
  addedExports: string[];
  addedTestNames: string[];
  addedCliCommands: string[];
  addedCliOptions: string[];
  changedPackageScripts: string[];
  addedConfigKeys: string[];
  addedRoutes: string[];
  signals: DiffSignal[];
}

export interface DiffSummary {
  files: FileDiffSummary[];
  totalAddedLines: number;
  totalDeletedLines: number;
  signals: DiffSignal[];
}

export interface RawCommit {
  hash: string;
  date: string;
  message: string;
  changedFiles: string[];
  diffSummary: DiffSummary;
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
  packageScripts: string[];
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
  diffSignals: string[];
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
  observedChanges: string[];
  suggestedValidationCommands: string[];
  matchedPatterns: string[];
  pathSignals: string[];
  diffSignals: string[];
  confidenceFactors: string[];
  falsePositiveNotes: string[];
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
