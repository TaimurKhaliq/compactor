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

export type FileRole = "source" | "test" | "config" | "docs" | "generated" | "lockfile" | "fixture" | "build-output" | "unknown";

export interface FileFrequency {
  filePath: string;
  commitCount: number;
  role: FileRole;
}

export interface DirectoryFrequency {
  directory: string;
  commitCount: number;
}

export interface CoChangePair {
  files: [string, string];
  weight: number;
  sharedCommits: string[];
}

export type FileRoleCounts = Record<FileRole, number>;

export interface LearnedSurface {
  id: string;
  displayName: string;
  commonDirectory: string;
  representativeFiles: string[];
  coChangingTestFiles: string[];
  coChangingConfigOrDocsFiles: string[];
  dominantExtensions: string[];
  repeatedTerms: string[];
  validationCommands: string[];
  confidence: number;
  commitCount: number;
  sourceFileCount: number;
  roleCounts: FileRoleCounts;
  coChangeEvidence: CoChangePair[];
}

export type SurfaceTaskKind = "commands" | "ui" | "api" | "database" | "config" | "docs" | "tests" | "source-workflow";

export interface RepoLearning {
  generatedAt: string;
  topFilesByFrequency: FileFrequency[];
  topDirectoriesByFrequency: DirectoryFrequency[];
  strongestCoChangePairs: CoChangePair[];
  fileClusters: LearnedSurface[];
  surfaces: LearnedSurface[];
  fileRoles: Record<string, FileRole>;
}

export interface SourceFingerprint {
  path: string;
  extension: string;
  roles: string[];
  frameworks: string[];
  libraries: string[];
  imports: string[];
  exportedSymbols: string[];
  classNames: string[];
  interfaceTypeNames: string[];
  functionNames: string[];
  testNames: string[];
  annotations: string[];
  decorators: string[];
  routeDefinitions: string[];
  cliOptionDefinitions: string[];
  schemaModelDefinitions: string[];
  migrationOperations: string[];
  componentTags: string[];
  configKeys: string[];
  concepts: string[];
}

export interface PatternFamilySimilarity {
  files: [string, string];
  score: number;
  sharedFeatures: string[];
}

export interface PatternFamily {
  id: string;
  name: string;
  representativeFiles: string[];
  frameworks: string[];
  libraries: string[];
  concepts: string[];
  roles: string[];
  confidence: number;
  fileCount: number;
  commitCount: number;
  sourceFiles: string[];
  directories: string[];
  similarityScores: PatternFamilySimilarity[];
  reasons: string[];
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
  repoLearning?: RepoLearning;
  fingerprints?: SourceFingerprint[];
  patternFamilies?: PatternFamily[];
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

export type WorkflowAction =
  | "added_function"
  | "modified_function"
  | "added_type_or_interface"
  | "added_cli_option"
  | "changed_cli_option"
  | "added_route_or_handler"
  | "changed_schema_or_model"
  | "changed_query_or_migration"
  | "changed_config_key"
  | "changed_validation_logic"
  | "changed_output_formatting"
  | "changed_error_handling"
  | "added_test_case"
  | "updated_fixture"
  | "updated_docs"
  | "updated_api_client"
  | "updated_component"
  | "updated_style"
  | "changed_package_script";

export interface WorkflowActionSummary {
  action: WorkflowAction;
  count: number;
  files: string[];
  commits: string[];
  group: "source" | "test" | "supporting";
}

export interface WorkflowStepEvidence {
  action: WorkflowAction | "validation";
  text: string;
  count: number;
  files: string[];
  tier?: "core" | "supporting";
}

export interface WorkflowProfile {
  actions: WorkflowActionSummary[];
  sourceActions: WorkflowActionSummary[];
  testActions: WorkflowActionSummary[];
  supportingArtifactActions: WorkflowActionSummary[];
  validationCommands: string[];
  primaryValidationCommands: string[];
  secondaryValidationCommands: string[];
  steps: WorkflowStepEvidence[];
  coreSteps: WorkflowStepEvidence[];
  supportingSteps: WorkflowStepEvidence[];
  usesGenericFallback: boolean;
}

export interface CandidateSkill {
  id: string;
  name: string;
  taskDescription?: string;
  outputType: "skill" | "pattern";
  promotion_level: "agent_ready" | "draft" | "pattern_candidate";
  primaryArea: "frontend" | "backend" | "db" | "infra" | "tests" | "docs" | "cli" | "mixed" | "unknown";
  primaryAreaShare: number;
  workflowQuality: number;
  generatedArtifactEvidenceShare: number;
  promotionReasons: string[];
  reviewNotes: string[];
  patternConfidence: number;
  namingConfidence: number;
  confidence: number;
  evidenceCommits: EvidenceCommit[];
  surfaceEvidenceCommits?: EvidenceCommit[];
  supportingEvidenceCommits?: EvidenceCommit[];
  rejectedEvidenceCommits?: EvidenceCommit[];
  rawEvidenceCommitCount?: number;
  surfaceRelevantCommitCount?: number;
  rejectedEvidenceCommitCount?: number;
  commonFiles: string[];
  commonDirectories: string[];
  observedConventions: string[];
  observedChanges: string[];
  workflowProfile?: WorkflowProfile;
  suggestedValidationCommands: string[];
  genericSignals: GenericSignal[];
  repeatedTerms: string[];
  domainTerms: string[];
  rejectedNoisyTerms: string[];
  genericCategory: string;
  genericFallbackName: string;
  namingReasons: string[];
  frameworkHints: string[];
  matchedPatterns: string[];
  pathSignals: string[];
  diffSignals: string[];
  confidenceFactors: string[];
  falsePositiveNotes: string[];
  rationale: string;
  generatedFrom?: Array<"learned_surface" | "pattern_family">;
  learnedSurface?: {
    id: string;
    displayName: string;
    commonDirectory: string;
    taskKind?: SurfaceTaskKind;
    confidence: number;
    matchShare: number;
    representativeFiles: string[];
    coChangingTestFiles: string[];
    coChangingConfigOrDocsFiles: string[];
    dominantExtensions?: string[];
    validationCommands: string[];
    repeatedTerms: string[];
    sourceTerms?: string[];
    coChangeEvidence: CoChangePair[];
    roleCounts: FileRoleCounts;
    reasons: string[];
  };
  patternFamily?: {
    id: string;
    name: string;
    confidence: number;
    fileCount: number;
    commitCount: number;
    frameworks: string[];
    libraries: string[];
    concepts: string[];
    roles: string[];
    representativeFiles: string[];
    sourceFiles: string[];
    similarityScores: PatternFamilySimilarity[];
    reasons: string[];
  };
}

export type SkillStatus = "fresh" | "draft" | "stale" | "drifting" | "deprecated" | "rejected";

export interface SkillPatternSignature {
  hash: string;
  generic_signals: string[];
  common_directories: string[];
  repeated_file_terms: string[];
  dominant_domain_terms: string[];
  validation_commands: string[];
}

export interface SkillMetadata {
  skill_id: string;
  name: string;
  task_description?: string;
  created_at: string;
  generated_from_head: string;
  evidence_commits: EvidenceCommit[];
  pattern_signature: SkillPatternSignature;
  generic_signals: string[];
  dominant_terms: string[];
  validation_commands: string[];
  pattern_confidence: number;
  naming_confidence: number;
  promotion_level?: "agent_ready" | "draft" | "pattern_candidate";
  workflow_quality?: number;
  status: SkillStatus;
  last_refreshed_at: string;
  managed_by?: "compactor" | "human";
  human_approved?: boolean;
  approved_at?: string;
  approved_by?: string;
  rejected_at?: string;
  rejected_by?: string;
  deprecated_at?: string;
  deprecated_by?: string;
  promoted_from_pattern?: string;
  human_named?: boolean;
  proposed_name?: string;
  human_edited?: boolean;
  renamed_at?: string;
  renamed_by?: string;
  validation_warnings?: string[];
  drift_reasons?: string[];
}

export interface DraftSkillReviewSummary {
  skill_id: string;
  name: string;
  confidence: number;
  learned_surface: string;
  representative_files: string[];
  validation_commands: string[];
  skill_path: string;
}

export interface SkillReviewReport {
  repoRoot: string;
  agentReadySkills: SkillMetadata[];
  draftSkills: DraftSkillReviewSummary[];
  patternCandidates: Array<{
    pattern_id: string;
    name: string;
    path: string;
  }>;
  archivedOrDeprecatedSkills: Array<{
    skill_id: string;
    name: string;
    status: SkillStatus;
    path: string;
  }>;
}

export interface SkillValidationSummary {
  skill_id: string;
  name: string;
  status: SkillStatus;
  human_approved: boolean;
  supporting_commits: EvidenceCommit[];
  drift_reasons: string[];
  validation_warnings: string[];
  suggested_human_review: boolean;
}

export interface SkillLifecycleReport {
  repoRoot: string;
  generatedAt: string;
  currentHead: string;
  fresh: SkillValidationSummary[];
  stale: SkillValidationSummary[];
  drifting: SkillValidationSummary[];
  deprecated: SkillValidationSummary[];
  validationCommandChanges: SkillValidationSummary[];
  suggestedHumanReview: SkillValidationSummary[];
}

export interface MiningResult {
  repoRoot: string;
  generatedAt: string;
  commitsAnalyzed: number;
  candidates: CandidateSkill[];
  duplicateHandling?: {
    mergedDuplicateDrafts: number;
    suppressedDuplicateDrafts: number;
  };
}

export interface GeneratedSkillFile {
  skillId: string;
  path: string;
  metadataPath?: string;
}

export interface GeneratedPatternFile {
  patternId: string;
  path: string;
}

export interface GenerationResult {
  repoRoot: string;
  generatedAt: string;
  agentsPath: string;
  skillFiles: GeneratedSkillFile[];
  draftSkillFiles: GeneratedSkillFile[];
  patternFiles: GeneratedPatternFile[];
  archivedSkillCount: number;
}

export type AgentIntegrationTarget = "codex" | "claude" | "cursor" | "copilot" | "all";

export interface AgentIntegrationFileChange {
  target: Exclude<AgentIntegrationTarget, "all">;
  path: string;
  action: "create" | "update" | "unchanged";
  changed: boolean;
}

export interface AgentIntegrationResult {
  repoRoot: string;
  generatedAt: string;
  dryRun: boolean;
  target: AgentIntegrationTarget;
  approvedSkillCount: number;
  draftSkillCount: number;
  patternCandidateCount: number;
  files: AgentIntegrationFileChange[];
}
