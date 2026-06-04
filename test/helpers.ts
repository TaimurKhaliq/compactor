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
      addedExports: values(fileSignals, "exported-symbol"),
      addedTestNames: values(fileSignals, "test-name"),
      addedCliCommands: values(fileSignals, "cli-command"),
      addedCliOptions: values(fileSignals, "cli-option"),
      changedPackageScripts: values(fileSignals, "package-script"),
      addedConfigKeys: values(fileSignals, "config-key"),
      addedRoutes: values(fileSignals, "api-route"),
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
