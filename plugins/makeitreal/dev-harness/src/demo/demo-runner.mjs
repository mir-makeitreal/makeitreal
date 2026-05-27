import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateBlueprintProposal } from "../plan/blueprint-validator.mjs";
import { normalizeBlueprintProposal, writeBlueprintArtifacts } from "../plan/blueprint-normalizer.mjs";
import { materializeLaunchBoard } from "../plan/artifact-assembly.mjs";
import { seedBlueprintReview } from "../blueprint/review.mjs";
import { renderDesignPreview } from "../preview/render-preview.mjs";
import { runGates } from "../gates/index.mjs";

// ─── Hand-crafted BlueprintProposal templates ─────────────────────────────────
// These are showcase examples of what GOOD architecture looks like.
// Claude Code produces JSON like this; the engine validates and saves.

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
      intent: {
        title: "Todo List Module",
        summary: "A pure-function todo store with add, remove, toggle, and list operations. Each todo has an auto-generated id, a title, and a completed boolean.",
        goals: [
          "Implement createTodoStore() returning an isolated store instance.",
          "Expose addTodo(title), removeTodo(id), toggleTodo(id), and listTodos() on the store.",
          "Verify all operations with node --test test/todo-store.test.mjs."
        ],
        userVisibleBehavior: [
          "addTodo(title) creates a new todo with { id, title, completed: false } and returns it.",
          "removeTodo(id) deletes the todo or throws TypeError with code TODO_NOT_FOUND.",
          "toggleTodo(id) flips completed and returns the updated todo.",
          "listTodos() returns a frozen array of all todos."
        ],
        acceptanceCriteria: [
          { id: "AC-001", statement: "createTodoStore() is the only public surface for the todo-store responsibility unit." },
          { id: "AC-002", statement: "addTodo validates title is a non-empty string; throws TypeError with code TODO_TITLE_INVALID otherwise." },
          { id: "AC-003", statement: "removeTodo and toggleTodo throw TypeError with code TODO_NOT_FOUND for unknown ids." },
          { id: "AC-004", statement: "listTodos returns a frozen snapshot that cannot mutate internal state." },
          { id: "AC-005", statement: "All operations are tested with at least one happy-path and one error-path case." }
        ],
        nonGoals: ["Persistence", "Network transport", "UI rendering"]
      },
      architecture: {
        nodes: [
          { id: "ru.todo-store", label: "Todo Store", responsibilityUnitId: "ru.todo-store" }
        ],
        edges: []
      },
      responsibilityUnits: [{
        id: "ru.todo-store",
        label: "Todo Store",
        owner: "team.demo",
        owns: ["src/todo-app/todo-store.mjs", "test/todo-store.test.mjs"],
        mustProvideContracts: ["contract.todo-store"],
        mayUseContracts: [],
        publicSurfaces: [{
          name: "createTodoStore",
          kind: "module",
          contractIds: ["contract.todo-store"],
          signature: {
            inputs: [],
            outputs: [{ name: "store", type: "{ addTodo, removeTodo, toggleTodo, listTodos }" }],
            errors: []
          }
        }],
        responsibility: "Owns the in-memory todo store with CRUD+toggle operations."
      }],
      contracts: [{
        contractId: "contract.todo-store",
        kind: "none",
        title: "Todo Store Module Contract"
      }],
      workItems: [{
        id: "wi.todo-store",
        title: "Implement todo store with add, remove, toggle, list",
        responsibilityUnitId: "ru.todo-store",
        contractIds: ["contract.todo-store"],
        dependsOn: [],
        allowedPaths: ["src/todo-app/todo-store.mjs", "test/todo-store.test.mjs"],
        acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-003", "AC-004", "AC-005"],
        verificationCommands: [{ command: { file: "node", args: ["--test", "test/todo-store.test.mjs"] }, purpose: "Unit tests for todo store" }],
        kind: "implementation"
      }],
      sequences: [{
        title: "Add and list todos",
        participants: ["Caller", "TodoStore"],
        steps: [
          { from: "Caller", to: "TodoStore", action: "createTodoStore()" },
          { from: "Caller", to: "TodoStore", action: "addTodo('Buy milk')" },
          { from: "Caller", to: "TodoStore", action: "addTodo('Write tests')" },
          { from: "Caller", to: "TodoStore", action: "listTodos() → [todo1, todo2]" }
        ]
      }]
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
      intent: {
        title: "Books REST API",
        summary: "A REST API for managing a book catalog with JWT-based authentication. Supports listing, creating, reading, updating, and deleting books.",
        goals: [
          "Expose POST /api/books, GET /api/books, GET /api/books/:id, PUT /api/books/:id, DELETE /api/books/:id.",
          "Protect mutation endpoints with JWT auth middleware that validates Bearer tokens.",
          "Persist books in an in-memory repository with a clean contract boundary.",
          "Verify all routes and auth with node --test test/**/*.test.mjs."
        ],
        userVisibleBehavior: [
          "GET /api/books returns 200 with { books: [...] } array.",
          "POST /api/books with valid JWT and { title, author, isbn } returns 201 with the created book.",
          "POST /api/books without Authorization header returns 401 with { error: { code: 'AUTH_TOKEN_MISSING' } }.",
          "GET /api/books/:id returns 200 with the book or 404 with { error: { code: 'BOOK_NOT_FOUND' } }.",
          "PUT /api/books/:id with valid JWT updates and returns 200; without auth returns 401.",
          "DELETE /api/books/:id with valid JWT returns 204; without auth returns 401."
        ],
        acceptanceCriteria: [
          { id: "AC-001", statement: "POST /api/books is the only write endpoint; it validates title, author, isbn and returns 201 or 400." },
          { id: "AC-002", statement: "GET /api/books returns all books as a JSON array; GET /api/books/:id returns one book or 404." },
          { id: "AC-003", statement: "Auth middleware rejects requests without valid JWT Bearer token with 401." },
          { id: "AC-004", statement: "Book repository is the only persistence surface; route handlers depend only on its contract." },
          { id: "AC-005", statement: "DELETE /api/books/:id returns 204 on success, 404 if not found, 401 if unauthorized." },
          { id: "AC-006", statement: "OpenAPI contract matches implemented request/response schemas." },
          { id: "AC-007", statement: "Ready gate passes before implementation starts." }
        ],
        nonGoals: ["Database persistence", "User registration", "Rate limiting"]
      },
      architecture: {
        nodes: [
          { id: "ru.book-routes", label: "Book Routes", responsibilityUnitId: "ru.book-routes" },
          { id: "ru.book-repository", label: "Book Repository", responsibilityUnitId: "ru.book-repository" },
          { id: "ru.auth-middleware", label: "Auth Middleware", responsibilityUnitId: "ru.auth-middleware" }
        ],
        edges: [
          { from: "ru.book-repository", to: "ru.book-routes", contractId: "contract.book-repository" },
          { from: "ru.auth-middleware", to: "ru.book-routes", contractId: "contract.auth-middleware" }
        ]
      },
      responsibilityUnits: [
        {
          id: "ru.book-repository",
          label: "Book Repository",
          owner: "team.demo",
          owns: ["src/rest-api/book-repository.mjs", "test/rest-api/book-repository.test.mjs"],
          mustProvideContracts: ["contract.book-repository"],
          mayUseContracts: [],
          publicSurfaces: [
            { name: "createBookRepository", kind: "module", contractIds: ["contract.book-repository"], signature: { inputs: [], outputs: [{ name: "repository", type: "{ create, findAll, findById, update, remove }" }], errors: [] } },
            { name: "create", kind: "module", contractIds: ["contract.book-repository"], signature: { inputs: [{ name: "bookData", type: "{ title: string, author: string, isbn: string }" }], outputs: [{ name: "book", type: "{ id, title, author, isbn, createdAt }" }], errors: [{ code: "BOOK_VALIDATION_FAILED", when: "Missing required fields" }] } }
          ],
          responsibility: "In-memory book persistence with CRUD operations."
        },
        {
          id: "ru.auth-middleware",
          label: "Auth Middleware",
          owner: "team.demo",
          owns: ["src/rest-api/auth-middleware.mjs", "test/rest-api/auth-middleware.test.mjs"],
          mustProvideContracts: ["contract.auth-middleware"],
          mayUseContracts: [],
          publicSurfaces: [
            { name: "requireAuth", kind: "module", contractIds: ["contract.auth-middleware"], signature: { inputs: [{ name: "request", type: "{ headers: { authorization?: string } }" }], outputs: [{ name: "claims", type: "{ sub: string, role: string }" }], errors: [{ code: "AUTH_TOKEN_MISSING", when: "No Authorization header" }, { code: "AUTH_TOKEN_INVALID", when: "JWT verification fails" }] } }
          ],
          responsibility: "JWT Bearer token validation middleware."
        },
        {
          id: "ru.book-routes",
          label: "Book Routes",
          owner: "team.demo",
          owns: ["src/rest-api/book-routes.mjs", "test/rest-api/book-routes.test.mjs"],
          mustProvideContracts: ["contract.books-api"],
          mayUseContracts: ["contract.book-repository", "contract.auth-middleware"],
          publicSurfaces: [
            { name: "POST /api/books", kind: "http", contractIds: ["contract.books-api"], signature: { inputs: [{ name: "requestBody", type: "{ title, author, isbn }" }], outputs: [{ name: "201 response", type: "{ id, title, author, isbn, createdAt }" }], errors: [{ code: "400", when: "Validation fails" }, { code: "401", when: "Missing or invalid JWT" }] } },
            { name: "GET /api/books", kind: "http", contractIds: ["contract.books-api"], signature: { inputs: [], outputs: [{ name: "200 response", type: "{ books: Book[] }" }], errors: [] } }
          ],
          responsibility: "HTTP route handlers for book CRUD operations."
        }
      ],
      contracts: [
        {
          contractId: "contract.books-api",
          kind: "openapi",
          title: "Books API",
          surface: {
            method: "POST",
            path: "/api/books",
            requestSchema: { type: "object", properties: { title: { type: "string" }, author: { type: "string" }, isbn: { type: "string" } }, required: ["title", "author", "isbn"] },
            responseSchema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, author: { type: "string" }, isbn: { type: "string" } }, required: ["id", "title"] },
            errorCodes: [400, 401, 404]
          }
        },
        { contractId: "contract.book-repository", kind: "none", title: "Book Repository Contract" },
        { contractId: "contract.auth-middleware", kind: "none", title: "Auth Middleware Contract" }
      ],
      workItems: [
        {
          id: "wi.book-repository",
          title: "Implement in-memory book repository with CRUD operations",
          responsibilityUnitId: "ru.book-repository",
          contractIds: ["contract.book-repository"],
          dependsOn: [],
          allowedPaths: ["src/rest-api/book-repository.mjs", "test/rest-api/book-repository.test.mjs"],
          acceptanceCriteriaIds: ["AC-004"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/rest-api/book-repository.test.mjs"] }, purpose: "Repository unit tests" }],
          kind: "implementation"
        },
        {
          id: "wi.auth-middleware",
          title: "Implement JWT auth middleware with Bearer token validation",
          responsibilityUnitId: "ru.auth-middleware",
          contractIds: ["contract.auth-middleware"],
          dependsOn: [],
          allowedPaths: ["src/rest-api/auth-middleware.mjs", "test/rest-api/auth-middleware.test.mjs"],
          acceptanceCriteriaIds: ["AC-003"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/rest-api/auth-middleware.test.mjs"] }, purpose: "Auth middleware tests" }],
          kind: "implementation"
        },
        {
          id: "wi.book-routes",
          title: "Implement book CRUD routes with auth and repository dependencies",
          responsibilityUnitId: "ru.book-routes",
          contractIds: ["contract.books-api", "contract.book-repository", "contract.auth-middleware"],
          dependsOn: ["wi.book-repository", "wi.auth-middleware"],
          allowedPaths: ["src/rest-api/book-routes.mjs", "test/rest-api/book-routes.test.mjs"],
          acceptanceCriteriaIds: ["AC-001", "AC-002", "AC-005", "AC-006", "AC-007"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/rest-api/book-routes.test.mjs"] }, purpose: "Route integration tests" }],
          kind: "implementation"
        }
      ],
      sequences: [
        {
          title: "Create a book with authentication",
          participants: ["Client", "AuthMiddleware", "BookRoutes", "BookRepository"],
          steps: [
            { from: "Client", to: "BookRoutes", action: "POST /api/books with Bearer token" },
            { from: "BookRoutes", to: "AuthMiddleware", action: "requireAuth(request)" },
            { from: "AuthMiddleware", to: "BookRoutes", action: "returns { sub, role }" },
            { from: "BookRoutes", to: "BookRepository", action: "create({ title, author, isbn })" },
            { from: "BookRepository", to: "BookRoutes", action: "returns { id, title, author, isbn, createdAt }" },
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
      intent: {
        title: "Authentication System",
        summary: "A four-unit authentication system: user store for registration/lookup, session service for login/refresh/revoke, role-based access control for permission checks, and audit logging for security events.",
        goals: [
          "Implement createUserStore() with registerUser(input) and findUserByEmail(email).",
          "Implement session service with loginUser(credentials), refreshSession(token), revokeSession(sessionId).",
          "Implement RBAC with authorizeSession(session, permission) checking role-permission matrix.",
          "Implement audit logging with recordAuthAudit(event) producing structured audit records.",
          "Verify each unit with node --test test/auth-system/**/*.test.mjs."
        ],
        userVisibleBehavior: [
          "registerUser({ email, password }) returns { userId, email } or throws AUTH_USER_INVALID.",
          "loginUser({ email, password }) returns { sessionId, token, expiresAt } or throws AUTH_CREDENTIALS_INVALID.",
          "refreshSession(token) returns a new session or throws AUTH_SESSION_EXPIRED.",
          "revokeSession(sessionId) invalidates the session.",
          "authorizeSession(session, permission) returns { authorized: true } or throws AUTH_PERMISSION_DENIED.",
          "recordAuthAudit(event) persists { eventType, userId, timestamp, metadata } and returns the audit record."
        ],
        acceptanceCriteria: [
          { id: "AC-001", statement: "createUserStore() is the only public surface for user persistence; registerUser validates email format and password length >= 8." },
          { id: "AC-002", statement: "loginUser uses only the user store createUserStore contract; it does not read user internals directly." },
          { id: "AC-003", statement: "refreshSession validates token expiry and returns a new token with extended lifetime." },
          { id: "AC-004", statement: "authorizeSession checks session validity then evaluates the role-permission matrix." },
          { id: "AC-005", statement: "recordAuthAudit accepts login, logout, permission-denied, and registration event types." },
          { id: "AC-006", statement: "Each unit is tested independently; cross-unit calls use only declared contracts." },
          { id: "AC-007", statement: "Ready gate passes before implementation starts." }
        ],
        nonGoals: ["HTTP transport", "Database persistence", "OAuth/OIDC", "Email delivery"]
      },
      architecture: {
        nodes: [
          { id: "ru.user-store", label: "User Store", responsibilityUnitId: "ru.user-store" },
          { id: "ru.session-service", label: "Session Service", responsibilityUnitId: "ru.session-service" },
          { id: "ru.rbac", label: "RBAC", responsibilityUnitId: "ru.rbac" },
          { id: "ru.audit-log", label: "Audit Log", responsibilityUnitId: "ru.audit-log" }
        ],
        edges: [
          { from: "ru.user-store", to: "ru.session-service", contractId: "contract.user-store" },
          { from: "ru.session-service", to: "ru.rbac", contractId: "contract.session-service" },
          { from: "ru.rbac", to: "ru.audit-log", contractId: "contract.rbac" }
        ]
      },
      responsibilityUnits: [
        {
          id: "ru.user-store",
          label: "User Store",
          owner: "team.demo",
          owns: ["src/auth-system/user-store.mjs", "test/auth-system/user-store.test.mjs"],
          mustProvideContracts: ["contract.user-store"],
          mayUseContracts: [],
          publicSurfaces: [
            { name: "createUserStore", kind: "module", contractIds: ["contract.user-store"], signature: { inputs: [], outputs: [{ name: "store", type: "{ registerUser, findUserByEmail }" }], errors: [] } },
            { name: "registerUser", kind: "module", contractIds: ["contract.user-store"], signature: { inputs: [{ name: "input", type: "{ email: string, password: string }" }], outputs: [{ name: "user", type: "{ userId: string, email: string }" }], errors: [{ code: "AUTH_USER_INVALID", when: "Email format invalid or password < 8 chars" }, { code: "AUTH_USER_EXISTS", when: "Email already registered" }] } }
          ],
          responsibility: "User registration and lookup with password hashing."
        },
        {
          id: "ru.session-service",
          label: "Session Service",
          owner: "team.demo",
          owns: ["src/auth-system/session-service.mjs", "test/auth-system/session-service.test.mjs"],
          mustProvideContracts: ["contract.session-service"],
          mayUseContracts: ["contract.user-store"],
          imports: [{ contractId: "contract.user-store", surface: "createUserStore" }],
          publicSurfaces: [
            { name: "loginUser", kind: "module", contractIds: ["contract.session-service"], signature: { inputs: [{ name: "credentials", type: "{ email: string, password: string }" }], outputs: [{ name: "session", type: "{ sessionId, token, expiresAt }" }], errors: [{ code: "AUTH_CREDENTIALS_INVALID", when: "Email not found or password mismatch" }] } },
            { name: "refreshSession", kind: "module", contractIds: ["contract.session-service"], signature: { inputs: [{ name: "token", type: "string" }], outputs: [{ name: "session", type: "{ sessionId, token, expiresAt }" }], errors: [{ code: "AUTH_SESSION_EXPIRED", when: "Token expired or revoked" }] } },
            { name: "revokeSession", kind: "module", contractIds: ["contract.session-service"], signature: { inputs: [{ name: "sessionId", type: "string" }], outputs: [{ name: "result", type: "{ revoked: true }" }], errors: [] } }
          ],
          responsibility: "Session lifecycle: login, refresh, revoke."
        },
        {
          id: "ru.rbac",
          label: "RBAC",
          owner: "team.demo",
          owns: ["src/auth-system/rbac.mjs", "test/auth-system/rbac.test.mjs"],
          mustProvideContracts: ["contract.rbac"],
          mayUseContracts: ["contract.session-service"],
          imports: [{ contractId: "contract.session-service", surface: "loginUser" }],
          publicSurfaces: [
            { name: "authorizeSession", kind: "module", contractIds: ["contract.rbac"], signature: { inputs: [{ name: "session", type: "{ sessionId, role: string }" }, { name: "permission", type: "string" }], outputs: [{ name: "result", type: "{ authorized: boolean }" }], errors: [{ code: "AUTH_PERMISSION_DENIED", when: "Role does not have the requested permission" }] } }
          ],
          responsibility: "Role-based access control with a role-permission matrix."
        },
        {
          id: "ru.audit-log",
          label: "Audit Log",
          owner: "team.demo",
          owns: ["src/auth-system/audit-log.mjs", "test/auth-system/audit-log.test.mjs"],
          mustProvideContracts: ["contract.audit-log"],
          mayUseContracts: ["contract.rbac"],
          imports: [{ contractId: "contract.rbac", surface: "authorizeSession" }],
          publicSurfaces: [
            { name: "recordAuthAudit", kind: "module", contractIds: ["contract.audit-log"], signature: { inputs: [{ name: "event", type: "{ eventType: string, userId: string, metadata?: object }" }], outputs: [{ name: "record", type: "{ auditId, eventType, userId, timestamp, metadata }" }], errors: [{ code: "AUDIT_EVENT_INVALID", when: "eventType not in allowed set" }] } }
          ],
          responsibility: "Structured audit logging for authentication events."
        }
      ],
      contracts: [
        { contractId: "contract.user-store", kind: "none", title: "User Store Contract" },
        { contractId: "contract.session-service", kind: "none", title: "Session Service Contract" },
        { contractId: "contract.rbac", kind: "none", title: "RBAC Contract" },
        { contractId: "contract.audit-log", kind: "none", title: "Audit Log Contract" }
      ],
      workItems: [
        {
          id: "wi.user-store",
          title: "Implement user store with registration and email lookup",
          responsibilityUnitId: "ru.user-store",
          contractIds: ["contract.user-store"],
          dependsOn: [],
          allowedPaths: ["src/auth-system/user-store.mjs", "test/auth-system/user-store.test.mjs"],
          acceptanceCriteriaIds: ["AC-001", "AC-006"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/auth-system/user-store.test.mjs"] }, purpose: "User store unit tests" }],
          kind: "implementation"
        },
        {
          id: "wi.session-service",
          title: "Implement session service with login, refresh, and revoke",
          responsibilityUnitId: "ru.session-service",
          contractIds: ["contract.session-service"],
          dependsOn: ["wi.user-store"],
          allowedPaths: ["src/auth-system/session-service.mjs", "test/auth-system/session-service.test.mjs"],
          acceptanceCriteriaIds: ["AC-002", "AC-003", "AC-006"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/auth-system/session-service.test.mjs"] }, purpose: "Session service tests" }],
          kind: "implementation"
        },
        {
          id: "wi.rbac",
          title: "Implement role-based access control with permission matrix",
          responsibilityUnitId: "ru.rbac",
          contractIds: ["contract.rbac"],
          dependsOn: ["wi.session-service"],
          allowedPaths: ["src/auth-system/rbac.mjs", "test/auth-system/rbac.test.mjs"],
          acceptanceCriteriaIds: ["AC-004", "AC-006"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/auth-system/rbac.test.mjs"] }, purpose: "RBAC tests" }],
          kind: "implementation"
        },
        {
          id: "wi.audit-log",
          title: "Implement structured audit logging for auth events",
          responsibilityUnitId: "ru.audit-log",
          contractIds: ["contract.audit-log"],
          dependsOn: ["wi.rbac"],
          allowedPaths: ["src/auth-system/audit-log.mjs", "test/auth-system/audit-log.test.mjs"],
          acceptanceCriteriaIds: ["AC-005", "AC-006"],
          verificationCommands: [{ command: { file: "node", args: ["--test", "test/auth-system/audit-log.test.mjs"] }, purpose: "Audit log tests" }],
          kind: "implementation"
        }
      ],
      sequences: [
        {
          title: "Login and authorize a protected action",
          participants: ["Client", "SessionService", "UserStore", "RBAC", "AuditLog"],
          steps: [
            { from: "Client", to: "SessionService", action: "loginUser({ email, password })" },
            { from: "SessionService", to: "UserStore", action: "findUserByEmail(email)" },
            { from: "UserStore", to: "SessionService", action: "returns user with hashed password" },
            { from: "SessionService", to: "Client", action: "returns { sessionId, token, expiresAt }" },
            { from: "Client", to: "RBAC", action: "authorizeSession(session, 'admin:write')" },
            { from: "RBAC", to: "Client", action: "returns { authorized: true }" },
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

  // Write package.json
  await writeFile(
    path.join(resolvedRoot, "package.json"),
    JSON.stringify(templateDef.packageJson, null, 2)
  );

  // Validate the proposal
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

  // Normalize and write artifacts
  const runId = `demo-${template}`;
  const runDir = path.join(resolvedRoot, ".makeitreal", "runs", runId);
  await mkdir(runDir, { recursive: true });

  const normalized = normalizeBlueprintProposal(templateDef.proposal);
  await writeBlueprintArtifacts(normalized, runDir, runId);

  const slug = (templateDef.proposal.intent.title)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  const launchBoard = await materializeLaunchBoard({
    runDir,
    runId,
    slug,
    workItems: normalized.workItems,
    workItemDag: normalized.workItemDag,
    runnerMode: "scripted-simulator"
  });

  const blueprintReview = await seedBlueprintReview({ runDir, now });
  const preview = await renderDesignPreview({ runDir, now });

  // Run Ready gate to surface approval-pending errors
  const readyGate = await runGates({ runDir, target: "Ready" });

  const previewIndexPath = path.join(runDir, "preview", "index.html");
  const workItemCount = await readWorkItemCount(runDir);

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
    contractId: templateDef.proposal.contracts?.[0]?.contractId ?? null,
    errors: [
      ...(launchBoard.errors ?? []),
      ...(blueprintReview.errors ?? []),
      ...(preview.errors ?? []),
      ...(readyGate.errors ?? [])
    ]
  };
}
