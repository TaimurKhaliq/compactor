import type { GenericSignal } from "../../types.js";

export function detectTestAndDocsPathSignals(filePath: string): GenericSignal[] {
  const lower = filePath.toLowerCase();
  const signals = new Set<GenericSignal>();

  if (/(\.spec\.|\.(test|tests)\.)|(^|\/)__tests__(\/|$)|(^|\/)tests?(\/|$)/.test(lower)) {
    signals.add("unit_test_changed");
  }
  if (/(^|\/)(integration|integ)(\/|$)|integration\.(spec|test)\./.test(lower)) signals.add("integration_test_changed");
  if (/(^|\/)(e2e|playwright|cypress)(\/|$)|playwright\.config|cypress\.config/.test(lower)) signals.add("e2e_test_changed");
  if (/(^|\/)(contracts?|pact)(\/|$)|contract\.(spec|test)\./.test(lower)) signals.add("contract_test_changed");
  if (/(^|\/)(fixtures?|testdata|test-data|__fixtures__)(\/|$)/.test(lower)) signals.add("fixture_changed");
  if (/(^|\/)(ui|web|client|frontend)(\/|.*tests?\/)/.test(lower) && /(\.spec\.|\.(test|tests)\.)/.test(lower)) {
    signals.add("frontend_test_changed");
  }

  if (/(^|\/)(docs?|documentation)(\/|$)|\.(md|mdx|rst|adoc)$/.test(lower)) signals.add("docs_changed");
  if (/(^|\/)readme(\.|$)/.test(lower)) signals.add("readme_changed");
  if (/(^|\/)(adr|adrs|architecture|design-docs?)(\/|$)/.test(lower)) signals.add("adr_or_design_doc_changed");
  if (/(^|\/)changelog(\.|$)|(^|\/)changes(\/|$)/.test(lower)) signals.add("changelog_changed");

  return [...signals];
}
