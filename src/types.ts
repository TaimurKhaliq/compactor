export type LikelyArea = "frontend" | "backend" | "tests" | "config" | "docs" | "mixed" | "unknown";
export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed" | "unknown";
export type GenericSignal =
  | "ui_changed"
  | "component_changed"
  | "page_or_screen_changed"
  | "route_view_changed"
  | "style_changed"
  | "frontend_test_changed"
  | "backend_changed"
  | "api_route_changed"
  | "controller_changed"
  | "service_layer_changed"
  | "repository_or_dao_changed"
  | "middleware_changed"
  | "auth_changed"
  | "validation_changed"
  | "serialization_changed"
  | "background_job_changed"
  | "queue_or_event_handler_changed"
  | "db_changed"
  | "migration_changed"
  | "schema_changed"
  | "model_or_entity_changed"
  | "seed_data_changed"
  | "query_changed"
  | "index_changed"
  | "config_changed"
  | "env_changed"
  | "package_or_dependency_changed"
  | "ci_changed"
  | "docker_changed"
  | "terraform_or_infra_changed"
  | "deployment_changed"
  | "unit_test_changed"
  | "integration_test_changed"
  | "e2e_test_changed"
  | "contract_test_changed"
  | "fixture_changed"
  | "test_case_added"
  | "exported_symbol_added"
  | "function_added"
  | "class_added"
  | "interface_or_type_added"
  | "enum_added"
  | "cli_command_changed"
  | "package_script_changed"
  | "docs_changed"
  | "readme_changed"
  | "adr_or_design_doc_changed"
  | "changelog_changed";

export interface DiffSignal {
  type: GenericSignal;
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
  addedFunctions: string[];
  addedClasses: string[];
  addedInterfacesOrTypes: string[];
  addedEnums: string[];
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
  pathSignals: GenericSignal[];
  diffSignals: GenericSignal[];
  genericSignals: GenericSignal[];
  frameworkHints: string[];
  filenameTerms: string[];
  messageTerms: string[];
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
  validationCommands: string[];
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
  pathSignals: string[];
  url?: string;
}

export interface CandidateSkill {
  id: string;
  name: string;
  patternConfidence: number;
  namingConfidence: number;
  confidence: number;
  evidenceCommits: EvidenceCommit[];
  commonFiles: string[];
  commonDirectories: string[];
  observedConventions: string[];
  observedChanges: string[];
  suggestedValidationCommands: string[];
  genericSignals: GenericSignal[];
  repeatedTerms: string[];
  frameworkHints: string[];
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
