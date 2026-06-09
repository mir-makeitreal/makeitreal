import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateBlueprintProposal } from "../plan/blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "../plan/blueprint-normalizer.mjs";
import { materializeLaunchBoard } from "../plan/artifact-assembly.mjs";
import { seedBlueprintReview } from "../blueprint/review.mjs";
import { renderDesignPreview } from "../preview/render-preview.mjs";
import { runGates } from "../gates/index.mjs";

// Canonical doctrine state flow shared by every demo blueprint. The Ready gate
// requires designPack.stateFlow with non-empty lanes and transitions.
const DOCTRINE_STATE_FLOW = {
  lanes: [
    "Intake", "Discovery", "Scoped", "Blueprint Bound",
    "Contract Frozen", "Ready", "Claimed", "Running",
    "Verifying", "Human Review", "Done"
  ],
  transitions: [
    { from: "Contract Frozen", to: "Ready", gate: "design-pack" },
    { from: "Human Review", to: "Done", gate: "wiki" }
  ]
};

const TEMPLATES = {
  "todo-app": {
    complexity: "simple",
    request: "Build a simple todo list module with add, remove, toggle, and list operations.",
    packageJson: {
      name: "demo-todo-app",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test test/todo-store.test.mjs" }
    },
    proposal: {
      title: "Todo List Module",
      summary: "A pure-function todo store with add, remove, toggle, and list operations. Each todo has an auto-generated id, a title, and a completed boolean.",
      goals: [
        "Implement createTodoStore() returning an isolated store instance.",
        "Expose addTodo, removeTodo, toggleTodo, and listTodos on the store.",
        "Verify all operations with node --test test/todo-store.test.mjs."
      ],
      nonGoals: ["Persistence", "Network transport", "UI rendering"],
      acceptanceCriteria: [
        "createTodoStore() is the only public surface for the todo-store responsibility unit.",
        "addTodo validates title is a non-empty string; throws TypeError with code TODO_TITLE_INVALID otherwise.",
        "removeTodo and toggleTodo throw TypeError with code TODO_NOT_FOUND for unknown ids.",
        "listTodos returns a frozen snapshot that cannot mutate internal state.",
        "All operations are tested with at least one happy-path and one error-path case."
      ],
      assumptions: [],
      stateFlow: DOCTRINE_STATE_FLOW,
      modules: [
        {
          name: "todo-store",
          purpose: "Owns the in-memory todo store with CRUD+toggle operations.",
          owner: "team.core",
          ownedPaths: ["src/todo-app/**", "test/todo-store.test.mjs"],
          dependsOn: [],
          contracts: [
            {
              name: "createTodoStore",
              type: "function",
              inputs: [{ name: "options", type: "object" }],
              outputs: [{ name: "store", type: "{ addTodo, removeTodo, toggleTodo, listTodos }" }],
              errors: [{ code: "TODO_TITLE_INVALID", when: "Title is not a non-empty string" }]
            }
          ]
        }
      ],
      workItems: [
        {
          module: "todo-store",
          title: "Implement todo store with add, remove, toggle, list",
          dependsOn: [],
          verifyCommand: "node --test test/todo-store.test.mjs",
          complexity: "small",
          implementationPrompt: "Implement the todo-store responsibility unit in src/todo-app/. Expose createTodoStore() returning { addTodo, removeTodo, toggleTodo, listTodos }. addTodo throws TypeError code TODO_TITLE_INVALID for non-string/empty titles; removeTodo and toggleTodo throw TypeError code TODO_NOT_FOUND for unknown ids; listTodos returns a frozen snapshot. Cover every operation in {{boardDir}} tests with happy-path and error-path cases.",
          requiredReviewRoles: ["code-quality", "contract-conformance"],
          reviewerPrompts: {
            "code-quality": "Review the todo-store implementation for clarity, immutability of returned snapshots, and absence of shared mutable state across createTodoStore() instances.",
            "contract-conformance": "Verify createTodoStore() matches the declared contract: error codes TODO_TITLE_INVALID and TODO_NOT_FOUND are thrown as TypeError, and listTodos cannot mutate internal state."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.todo-store.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.todo-store.wiki-sync.json" }
          ]
        }
      ],
      scenarios: [
        {
          title: "Add and list todos",
          steps: [
            { from: "Caller", to: "TodoStore", action: "createTodoStore()" },
            { from: "Caller", to: "TodoStore", action: "addTodo('Buy milk')" },
            { from: "Caller", to: "TodoStore", action: "listTodos()" }
          ]
        }
      ]
    }
  },

  "rest-api": {
    complexity: "medium",
    request: "Build a REST API for managing books with CRUD operations and JWT auth.",
    packageJson: {
      name: "demo-rest-api",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test test/**/*.test.mjs" }
    },
    proposal: {
      title: "Books REST API",
      summary: "A REST API for managing a book catalog with JWT-based authentication. Supports listing, creating, reading, updating, and deleting books.",
      goals: [
        "Expose CRUD endpoints for books.",
        "Protect mutation endpoints with JWT auth middleware.",
        "Persist books in an in-memory repository with a clean contract boundary."
      ],
      nonGoals: ["Database persistence", "User registration", "Rate limiting"],
      acceptanceCriteria: [
        "POST /api/books validates title, author, isbn and returns 201 or 400.",
        "GET /api/books returns all books; GET /api/books/:id returns one or 404.",
        "Auth middleware rejects requests without valid JWT Bearer token with 401.",
        "Book repository is the only persistence surface; routes depend only on its contract.",
        "DELETE /api/books/:id returns 204 on success, 404 if not found, 401 if unauthorized.",
        "OpenAPI contract matches implemented request/response schemas.",
        "Ready gate passes before implementation starts."
      ],
      assumptions: ["Express-style HTTP routing"],
      stateFlow: DOCTRINE_STATE_FLOW,
      modules: [
        {
          name: "book-repository",
          purpose: "In-memory book persistence with CRUD operations.",
          owner: "team.data",
          ownedPaths: ["src/rest-api/book-repository.mjs", "test/rest-api/book-repository.test.mjs"],
          dependsOn: [],
          contracts: [
            {
              name: "createBookRepository",
              type: "function",
              inputs: [],
              outputs: [{ name: "repository", type: "{ create, findAll, findById, update, remove }" }],
              errors: [{ code: "BOOK_VALIDATION_FAILED", when: "Missing required fields" }]
            }
          ]
        },
        {
          name: "auth-middleware",
          purpose: "JWT Bearer token validation middleware.",
          owner: "team.security",
          ownedPaths: ["src/rest-api/auth-middleware.mjs", "test/rest-api/auth-middleware.test.mjs"],
          dependsOn: [],
          contracts: [
            {
              name: "requireAuth",
              type: "function",
              inputs: [{ name: "request", type: "{ headers: { authorization?: string } }" }],
              outputs: [{ name: "claims", type: "{ sub: string, role: string }" }],
              errors: [
                { code: "AUTH_TOKEN_MISSING", when: "No Authorization header" },
                { code: "AUTH_TOKEN_INVALID", when: "JWT verification fails" }
              ]
            }
          ]
        },
        {
          name: "book-routes",
          purpose: "HTTP route handlers for book CRUD operations.",
          owner: "team.api",
          ownedPaths: ["src/rest-api/book-routes.mjs", "test/rest-api/book-routes.test.mjs"],
          dependsOn: ["book-repository", "auth-middleware"],
          contracts: [
            {
              name: "POST /api/books",
              type: "http",
              inputs: [
                { name: "title", type: "string", required: true },
                { name: "author", type: "string", required: true },
                { name: "isbn", type: "string", required: true }
              ],
              outputs: [{ name: "book", type: "{ id, title, author, isbn, createdAt }" }],
              errors: [
                { code: "400", when: "Validation fails" },
                { code: "401", when: "Missing or invalid JWT" }
              ]
            }
          ]
        }
      ],
      workItems: [
        {
          module: "book-repository",
          title: "Implement in-memory book repository with CRUD operations",
          dependsOn: [],
          verifyCommand: "node --test test/rest-api/book-repository.test.mjs",
          complexity: "small",
          implementationPrompt: "Implement createBookRepository() in src/rest-api/book-repository.mjs exposing { create, findAll, findById, update, remove }. create validates title, author, isbn and throws code BOOK_VALIDATION_FAILED when any required field is missing. Persist books in an in-memory map; do not add network or database code. Cover happy-path and validation-failure cases in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "contract-conformance"],
          reviewerPrompts: {
            "code-quality": "Review the repository for encapsulation of internal storage and absence of leaked mutable references from findAll/findById.",
            "contract-conformance": "Confirm createBookRepository() provides exactly { create, findAll, findById, update, remove } and raises BOOK_VALIDATION_FAILED on missing required fields."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.book-repository.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.book-repository.wiki-sync.json" }
          ]
        },
        {
          module: "auth-middleware",
          title: "Implement JWT auth middleware with Bearer token validation",
          dependsOn: [],
          verifyCommand: "node --test test/rest-api/auth-middleware.test.mjs",
          complexity: "small",
          implementationPrompt: "Implement requireAuth(request) in src/rest-api/auth-middleware.mjs. Read the Authorization header, throw code AUTH_TOKEN_MISSING when absent and AUTH_TOKEN_INVALID when JWT verification fails, and return { sub, role } claims on success. Keep the verifier dependency-injectable so tests can stub it. Cover missing-token, invalid-token, and valid-token cases in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "security"],
          reviewerPrompts: {
            "code-quality": "Review the middleware for clear separation between header parsing and token verification, and injectable verification for testability.",
            "security": "Verify tokens are never trusted without verification, error paths do not leak token contents, and both AUTH_TOKEN_MISSING and AUTH_TOKEN_INVALID are raised as specified."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.auth-middleware.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.auth-middleware.wiki-sync.json" }
          ]
        },
        {
          module: "book-routes",
          title: "Implement book CRUD routes with auth and repository dependencies",
          dependsOn: ["book-repository", "auth-middleware"],
          verifyCommand: "node --test test/rest-api/book-routes.test.mjs",
          complexity: "medium",
          implementationPrompt: "Implement the book CRUD route handlers in src/rest-api/book-routes.mjs, consuming book-repository and auth-middleware only through their declared contracts. POST /api/books returns 201 or 400; GET returns books or 404; DELETE returns 204/404/401. Mutation routes call requireAuth and return 401 on failure. Cover each status code in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "contract-conformance"],
          reviewerPrompts: {
            "code-quality": "Review the routes for thin handlers that delegate to the repository and middleware contracts rather than reimplementing persistence or auth.",
            "contract-conformance": "Confirm routes depend only on the book-repository and auth-middleware contracts and return the exact status codes declared in the acceptance criteria (201/400/401/404/204)."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.book-routes.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.book-routes.wiki-sync.json" }
          ]
        }
      ],
      scenarios: [
        {
          title: "Create a book with authentication",
          steps: [
            { from: "Client", to: "BookRoutes", action: "POST /api/books with Bearer token" },
            { from: "BookRoutes", to: "AuthMiddleware", action: "requireAuth(request)" },
            { from: "BookRoutes", to: "BookRepository", action: "create({ title, author, isbn })" },
            { from: "BookRoutes", to: "Client", action: "201 Created with book JSON" }
          ]
        }
      ]
    }
  },

  "auth-system": {
    complexity: "complex",
    request: "Build an authentication system with user store, session service, RBAC, and audit logging.",
    packageJson: {
      name: "demo-auth-system",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node --test test/auth-system/**/*.test.mjs" }
    },
    proposal: {
      title: "Authentication System",
      summary: "A four-unit authentication system: user store, session service, RBAC, and audit logging.",
      goals: [
        "Implement user store with registration and lookup.",
        "Implement session service with login, refresh, and revoke.",
        "Implement RBAC with authorization checks.",
        "Implement structured audit logging for auth events."
      ],
      nonGoals: ["HTTP transport", "Database persistence", "OAuth/OIDC", "Email delivery"],
      acceptanceCriteria: [
        "createUserStore validates email format and password length >= 8.",
        "loginUser uses only the user store contract; it does not read user internals directly.",
        "refreshSession validates token expiry and returns a new token.",
        "authorizeSession evaluates the role-permission matrix.",
        "recordAuthAudit accepts login, logout, permission-denied, and registration event types.",
        "Each unit is tested independently; cross-unit calls use only declared contracts.",
        "Ready gate passes before implementation starts."
      ],
      assumptions: [],
      stateFlow: DOCTRINE_STATE_FLOW,
      modules: [
        {
          name: "user-store",
          purpose: "User registration and lookup with password hashing.",
          owner: "team.identity",
          ownedPaths: ["src/auth-system/user-store.mjs", "test/auth-system/user-store.test.mjs"],
          dependsOn: [],
          contracts: [
            {
              name: "registerUser",
              type: "function",
              inputs: [
                { name: "email", type: "string", required: true },
                { name: "password", type: "string", required: true }
              ],
              outputs: [{ name: "user", type: "{ userId, email }" }],
              errors: [
                { code: "AUTH_USER_INVALID", when: "Email format invalid or password < 8 chars" },
                { code: "AUTH_USER_EXISTS", when: "Email already registered" }
              ]
            }
          ]
        },
        {
          name: "session-service",
          purpose: "Session lifecycle: login, refresh, revoke.",
          owner: "team.identity",
          ownedPaths: ["src/auth-system/session-service.mjs", "test/auth-system/session-service.test.mjs"],
          dependsOn: ["user-store"],
          contracts: [
            {
              name: "loginUser",
              type: "function",
              inputs: [
                { name: "email", type: "string", required: true },
                { name: "password", type: "string", required: true }
              ],
              outputs: [{ name: "session", type: "{ sessionId, token, expiresAt }" }],
              errors: [{ code: "AUTH_CREDENTIALS_INVALID", when: "Email not found or password mismatch" }]
            }
          ]
        },
        {
          name: "rbac",
          purpose: "Role-based access control with a role-permission matrix.",
          owner: "team.security",
          ownedPaths: ["src/auth-system/rbac.mjs", "test/auth-system/rbac.test.mjs"],
          dependsOn: ["session-service"],
          contracts: [
            {
              name: "authorizeSession",
              type: "function",
              inputs: [
                { name: "session", type: "{ sessionId, role: string }", required: true },
                { name: "permission", type: "string", required: true }
              ],
              outputs: [{ name: "result", type: "{ authorized: boolean }" }],
              errors: [{ code: "AUTH_PERMISSION_DENIED", when: "Role does not have the requested permission" }]
            }
          ]
        },
        {
          name: "audit-log",
          purpose: "Structured audit logging for authentication events.",
          owner: "team.platform",
          ownedPaths: ["src/auth-system/audit-log.mjs", "test/auth-system/audit-log.test.mjs"],
          dependsOn: ["rbac"],
          contracts: [
            {
              name: "recordAuthAudit",
              type: "function",
              inputs: [{ name: "event", type: "{ eventType, userId, metadata? }", required: true }],
              outputs: [{ name: "record", type: "{ auditId, eventType, userId, timestamp, metadata }" }],
              errors: [{ code: "AUDIT_EVENT_INVALID", when: "eventType not in allowed set" }]
            }
          ]
        }
      ],
      workItems: [
        {
          module: "user-store",
          title: "Implement user store with registration and email lookup",
          dependsOn: [],
          verifyCommand: "node --test test/auth-system/user-store.test.mjs",
          complexity: "small",
          implementationPrompt: "Implement registerUser and email lookup in src/auth-system/user-store.mjs. registerUser validates email format and password length >= 8, throwing code AUTH_USER_INVALID otherwise and AUTH_USER_EXISTS for a duplicate email. Hash passwords; never store plaintext. Return { userId, email }. Cover validation, duplicate, and happy-path cases in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "security"],
          reviewerPrompts: {
            "code-quality": "Review the user store for a clean public surface and no leakage of password hashes through lookup results.",
            "security": "Confirm passwords are hashed (never stored or returned in plaintext) and that AUTH_USER_INVALID and AUTH_USER_EXISTS are raised exactly as specified."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.user-store.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.user-store.wiki-sync.json" }
          ]
        },
        {
          module: "session-service",
          title: "Implement session service with login, refresh, and revoke",
          dependsOn: ["user-store"],
          verifyCommand: "node --test test/auth-system/session-service.test.mjs",
          complexity: "medium",
          implementationPrompt: "Implement loginUser, refreshSession, and revoke in src/auth-system/session-service.mjs, using only the user-store contract to read users. loginUser throws code AUTH_CREDENTIALS_INVALID for unknown email or password mismatch and returns { sessionId, token, expiresAt }. refreshSession validates token expiry and issues a new token. Cover login success/failure, refresh, and revoke in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "contract-conformance"],
          reviewerPrompts: {
            "code-quality": "Review the session service for clear lifecycle handling and no direct access to user-store internals beyond its declared contract.",
            "contract-conformance": "Confirm loginUser consumes only the user-store contract, raises AUTH_CREDENTIALS_INVALID as specified, and returns { sessionId, token, expiresAt }."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.session-service.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.session-service.wiki-sync.json" }
          ]
        },
        {
          module: "rbac",
          title: "Implement role-based access control with permission matrix",
          dependsOn: ["session-service"],
          verifyCommand: "node --test test/auth-system/rbac.test.mjs",
          complexity: "medium",
          implementationPrompt: "Implement authorizeSession in src/auth-system/rbac.mjs. Evaluate a role-permission matrix and return { authorized: boolean }, throwing code AUTH_PERMISSION_DENIED when the session role lacks the requested permission. Keep the matrix data-driven so roles/permissions can be extended without code changes. Cover allowed and denied permissions in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "security"],
          reviewerPrompts: {
            "code-quality": "Review the RBAC implementation for a data-driven, extensible role-permission matrix rather than hardcoded conditionals.",
            "security": "Confirm authorization defaults to deny, AUTH_PERMISSION_DENIED is raised for missing permissions, and no permission is granted implicitly."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.rbac.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.rbac.wiki-sync.json" }
          ]
        },
        {
          module: "audit-log",
          title: "Implement structured audit logging for auth events",
          dependsOn: ["rbac"],
          verifyCommand: "node --test test/auth-system/audit-log.test.mjs",
          complexity: "small",
          implementationPrompt: "Implement recordAuthAudit in src/auth-system/audit-log.mjs. Accept event types login, logout, permission-denied, and registration, throwing code AUDIT_EVENT_INVALID for any other type. Return a structured record { auditId, eventType, userId, timestamp, metadata }. Cover each valid event type and the invalid-type error in {{boardDir}} tests.",
          requiredReviewRoles: ["code-quality", "contract-conformance"],
          reviewerPrompts: {
            "code-quality": "Review the audit logger for consistent structured records and clear handling of optional metadata.",
            "contract-conformance": "Confirm recordAuthAudit accepts only the allowed event-type set, raises AUDIT_EVENT_INVALID otherwise, and returns the declared record shape."
          },
          doneEvidence: [
            { kind: "verification", path: "evidence/work.audit-log.verification.json" },
            { kind: "wiki-sync", path: "evidence/work.audit-log.wiki-sync.json" }
          ]
        }
      ],
      scenarios: [
        {
          title: "Login and authorize a protected action",
          steps: [
            { from: "Client", to: "SessionService", action: "loginUser({ email, password })" },
            { from: "SessionService", to: "UserStore", action: "findUserByEmail(email)" },
            { from: "Client", to: "RBAC", action: "authorizeSession(session, 'admin:write')" },
            { from: "Client", to: "AuditLog", action: "recordAuthAudit({ eventType: 'login', userId })" }
          ]
        }
      ]
    }
  }
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([name, template]) => ({
    name,
    complexity: template.complexity,
    request: template.request
  }));
}

async function readWorkItemCount(runDir) {
  if (!runDir) return 0;
  try {
    const board = JSON.parse(await readFile(path.join(runDir, "board.json"), "utf8"));
    return Array.isArray(board.workItems) ? board.workItems.length : 0;
  } catch {
    return 0;
  }
}

export async function cleanDemoDirs({ tmpDir = os.tmpdir() } = {}) {
  const entries = await readdir(tmpDir, { withFileTypes: true });
  let removedCount = 0;
  const removedDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("makeitreal-demo-")) continue;
    const dirPath = path.join(tmpDir, entry.name);
    await rm(dirPath, { recursive: true, force: true });
    removedCount += 1;
    removedDirs.push(dirPath);
  }
  return { ok: true, command: "demo clean", tmpDir, removedCount, removedDirs, errors: [] };
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

  const resolvedRoot = projectRoot ?? path.join(os.tmpdir(), `makeitreal-demo-${template}-${Date.now()}`);
  await mkdir(resolvedRoot, { recursive: true });

  await writeFile(
    path.join(resolvedRoot, "package.json"),
    JSON.stringify(templateDef.packageJson, null, 2)
  );

  const validation = validateBlueprintProposal(templateDef.proposal);
  if (!validation.ok) {
    return {
      ok: false,
      command: "demo",
      template,
      complexity: templateDef.complexity,
      projectRoot: resolvedRoot,
      runDir: null,
      errors: validation.errors
    };
  }

  const runId = `demo-${template}`;
  const runDir = path.join(resolvedRoot, ".makeitreal", "runs", runId);
  await mkdir(runDir, { recursive: true });

  const normalized = normalizeBlueprintProposal(templateDef.proposal);
  await writeBlueprintArtifacts(normalized, runDir, runId);

  const slug = templateDef.proposal.title
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  const launchBoard = await materializeLaunchBoard({
    runDir,
    runId,
    slug,
    workItems: normalized.workItems,
    workItemDag: normalized.workItemDag,
    runnerMode: "scripted-simulator",
    availableLanes: normalized.designPack?.stateFlow?.lanes ?? []
  });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir, now });

  const readyGate = await runGates({ runDir, target: "Ready" });

  const previewIndexPath = path.join(runDir, "preview", "index.html");
  const workItemCount = await readWorkItemCount(runDir);

  const firstContract = normalized.contracts[0]?.contract?.contractId ?? null;

  return {
    ok: true,
    command: "demo",
    template,
    complexity: templateDef.complexity,
    request: templateDef.request,
    projectRoot: resolvedRoot,
    runDir,
    runId,
    dashboardUrl: previewIndexPath,
    planOk: true,
    implementationReady: readyGate.ok,
    workItemCount,
    workItemId: normalized.workItems[0]?.id ?? null,
    contractId: firstContract,
    errors: [
      ...(launchBoard.errors ?? []),
      ...(blueprintReview.errors ?? []),
      ...(preview.errors ?? []),
      ...(readyGate.errors ?? [])
    ]
  };
}
