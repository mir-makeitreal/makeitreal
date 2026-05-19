import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generatePlanRun } from "../plan/plan-generator.mjs";

const TEMPLATES = {
  "todo-app": {
    request: "Build a simple todo list module with add, remove, toggle, and list operations. Each todo has an id, title, and completed status.",
    packageJson: {
      name: "demo-todo-app",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node -e \"console.log('todo tests pass')\"" }
    },
    verificationCommands: [{ file: "node", args: ["-e", "console.log('todo tests pass')"] }],
    complexity: "simple"
  },
  "rest-api": {
    request: "Build a REST API for managing books with CRUD operations and authentication. The API should support listing, creating, reading, updating, and deleting books, with JWT-based auth middleware.",
    packageJson: {
      name: "demo-rest-api",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node -e \"console.log('api tests pass')\"" }
    },
    verificationCommands: [{ file: "node", args: ["-e", "console.log('api tests pass')"] }],
    complexity: "medium"
  },
  "auth-system": {
    request: "Build an authentication system as four explicit responsibility units. Unit 1 owns src/auth-system/user-store.mjs and test/auth-system/user-store.test.mjs and must export createUserStore(), registerUser(input). Contract: registerUser validates email/password and throws TypeError with code AUTH_USER_INVALID. Unit 2 owns src/auth-system/session-service.mjs and test/auth-system/session-service.test.mjs and must export loginUser(credentials), refreshSession(token), revokeSession(sessionId). It may use only Unit 1 createUserStore contract. Unit 3 owns src/auth-system/rbac.mjs and test/auth-system/rbac.test.mjs and must export authorizeSession(session, permission). It may use only Unit 2 loginUser contract. Unit 4 owns src/auth-system/audit-log.mjs and test/auth-system/audit-log.test.mjs and must export recordAuthAudit(event). It may use only Unit 3 authorizeSession contract. Include registration, login, password reset, email verification, role-based access control, session management, rate limiting, and audit logging.",
    packageJson: {
      name: "demo-auth-system",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node -e \"console.log('auth tests pass')\"" }
    },
    verificationCommands: [{ file: "node", args: ["-e", "console.log('auth tests pass')"] }],
    complexity: "complex"
  }
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([name, template]) => ({
    name,
    complexity: template.complexity,
    request: template.request
  }));
}

export async function runDemo({
  template = "rest-api",
  projectRoot = null,
  now = new Date()
} = {}) {
  const templateDef = TEMPLATES[template];
  if (!templateDef) {
    return {
      ok: false,
      command: "demo",
      template,
      availableTemplates: Object.keys(TEMPLATES),
      runDir: null,
      dashboardUrl: null,
      errors: [{
        code: "HARNESS_DEMO_TEMPLATE_UNKNOWN",
        reason: `Unknown demo template: ${template}. Available: ${Object.keys(TEMPLATES).join(", ")}`,
        contractId: null,
        ownerModule: null,
        evidence: ["--template"],
        recoverable: true
      }]
    };
  }

  const demoRoot = projectRoot ?? path.join(
    await mkdir(path.join(os.tmpdir(), `makeitreal-demo-${template}-`), { recursive: true })
      ? path.join(os.tmpdir(), `makeitreal-demo-${template}-${Date.now()}`)
      : path.join(os.tmpdir(), `makeitreal-demo-${template}-${Date.now()}`),
  );

  // Create a temp directory for the demo project
  const resolvedRoot = projectRoot ?? path.join(os.tmpdir(), `makeitreal-demo-${template}-${Date.now()}`);
  await mkdir(resolvedRoot, { recursive: true });

  // Write package.json
  await writeFile(
    path.join(resolvedRoot, "package.json"),
    JSON.stringify(templateDef.packageJson, null, 2)
  );

  // Generate plan using scripted-simulator mode
  const planResult = await generatePlanRun({
    projectRoot: resolvedRoot,
    request: templateDef.request,
    runId: `demo-${template}`,
    owner: "team.demo",
    allowedPaths: [`src/${template}/**`],
    verificationCommands: templateDef.verificationCommands,
    runnerMode: "scripted-simulator",
    now
  });

  if (!planResult.ok && !planResult.planOk) {
    return {
      ok: false,
      command: "demo",
      template,
      complexity: templateDef.complexity,
      projectRoot: resolvedRoot,
      runDir: planResult.runDir,
      dashboardUrl: null,
      planResult,
      errors: planResult.errors ?? []
    };
  }

  const previewIndexPath = planResult.runDir
    ? path.join(planResult.runDir, "preview", "index.html")
    : null;

  return {
    ok: planResult.ok,
    command: "demo",
    template,
    complexity: templateDef.complexity,
    request: templateDef.request,
    projectRoot: resolvedRoot,
    runDir: planResult.runDir,
    runId: planResult.runId,
    dashboardUrl: previewIndexPath,
    planOk: planResult.planOk,
    implementationReady: planResult.implementationReady,
    workItemId: planResult.workItemId,
    contractId: planResult.contractId,
    errors: planResult.errors ?? []
  };
}
