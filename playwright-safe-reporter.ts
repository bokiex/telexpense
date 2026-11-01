import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

// Playwright's normal error output may include URLs, headers or page content.
// Only publish journey names and source locations; debug details stay local.
export default class SafeReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    const status = result.status === test.expectedStatus ? "PASS" : "FAIL";
    console.log(`${status} ${test.titlePath().slice(1).join(" › ")} (${test.location.file.split(/[\\/]/).pop()}:${test.location.line})`);
  }

  onError() {
    console.error("Playwright encountered an error outside a journey; reproduce locally using the E2E troubleshooting instructions.");
  }

  onEnd(result: FullResult) {
    console.log(`E2E run: ${result.status}`);
  }
}
