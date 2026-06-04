import type { DiffSignal, DiffSummary, FileDiffSummary } from "../src/types.js";

export function emptyDiffSummary(): DiffSummary {
  return {
    files: [],
    totalAddedLines: 0,
    totalDeletedLines: 0,
    signals: []
  };
}

export function diffSummaryWithSignals(signals: DiffSignal[]): DiffSummary {
  const filePaths = [...new Set(signals.map((signal) => signal.filePath))];
  const files: FileDiffSummary[] = filePaths.map((filePath) => {
    const fileSignals = signals.filter((signal) => signal.filePath === filePath);
    return {
      filePath,
      status: "modified",
      addedLineCount: fileSignals.length,
      deletedLineCount: 0,
      addedExports: values(fileSignals, "exported_symbol_added"),
      addedFunctions: values(fileSignals, "function_added"),
      addedClasses: values(fileSignals, "class_added"),
      addedInterfacesOrTypes: values(fileSignals, "interface_or_type_added"),
      addedEnums: values(fileSignals, "enum_added"),
      addedTestNames: values(fileSignals, "test_case_added"),
      addedCliCommands: values(fileSignals, "cli_command_changed"),
      addedCliOptions: [],
      changedPackageScripts: values(fileSignals, "package_script_changed"),
      addedConfigKeys: values(fileSignals, "config_changed"),
      addedRoutes: values(fileSignals, "api_route_changed"),
      signals: fileSignals
    };
  });

  return {
    files,
    totalAddedLines: files.reduce((sum, file) => sum + file.addedLineCount, 0),
    totalDeletedLines: 0,
    signals
  };
}

function values(signals: DiffSignal[], type: DiffSignal["type"]): string[] {
  return signals.filter((signal) => signal.type === type).map((signal) => signal.value);
}
