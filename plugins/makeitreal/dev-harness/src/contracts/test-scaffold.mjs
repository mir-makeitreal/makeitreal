/**
 * Contract-derived test scaffold PROMPT builder.
 *
 * DOCTRINE: The LLM decides everything; the engine validates and saves only.
 *
 * The engine does NOT write tests. Writing a test means making judgment calls —
 * what example values are realistic, how to structure describe/test blocks, which
 * edge cases matter, how to assert behavior versus shape. Those are LLM decisions.
 *
 * This module therefore produces a PROMPT, not test code. Given a contract, it
 * returns a structured instruction string that hands the contract to Claude and
 * asks Claude to write the tests. It fabricates no example values, generates no
 * assertions, and makes no decisions about test structure.
 */

/**
 * Build the LLM prompt that asks Claude to write tests for a contract.
 *
 * The prompt embeds the full contract as JSON and tells the LLM where the test
 * files should live. It deliberately contains NO test code and NO fabricated
 * example values — those are the LLM's job.
 *
 * @param {object} contract - The contract definition (passed through verbatim).
 * @param {{ outputDir?: string }} [options]
 * @returns {string} A prompt string to pass to Claude.
 */
export function buildTestScaffoldPrompt(contract, options = {}) {
  const outputDir = options.outputDir ?? "test";
  const contractJson = JSON.stringify(contract, null, 2);

  return [
    "You are writing contract tests for a software module.",
    "",
    "Here is the contract definition. It is the single source of truth for what",
    "the implementation must satisfy:",
    "",
    "```json",
    contractJson,
    "```",
    "",
    "Write test files that verify an implementation against this contract.",
    "",
    "Requirements:",
    `- Place the test files under: ${outputDir}`,
    "- Use the project's standard test runner and assertion style.",
    "- Cover the contract's declared inputs, outputs, status codes, payload",
    "  shapes, and error conditions — whatever the contract above declares.",
    "- Choose realistic example values yourself; do not leave placeholders.",
    "- Tests must fail for the right reason when the implementation is missing or",
    "  wrong (module not found, unmet contract), never because the test is a stub.",
    "",
    "You decide the test structure, the example values, and which cases matter.",
    "Return the test file(s) you would create for this contract."
  ].join("\n");
}

/**
 * Stable-interface shim for callers that previously generated test files here.
 *
 * Generating tests requires the LLM. This function builds the prompt (so the
 * decision about *what to ask* is still derived from the contract) and then
 * throws, making the doctrine boundary explicit: the engine cannot produce the
 * test code itself.
 *
 * @param {object} contract - The contract definition.
 * @param {{ outputDir?: string }} [options]
 * @returns {never} Always throws.
 */
export function generateTestScaffold(contract, options = {}) {
  buildTestScaffoldPrompt(contract, options);
  throw new Error(
    "Test scaffold generation requires LLM. Use buildTestScaffoldPrompt() to get the prompt, then pass it to Claude."
  );
}
