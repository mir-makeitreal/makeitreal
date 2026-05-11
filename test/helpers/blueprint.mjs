import path from "node:path";
import { seedBlueprintReview, decideBlueprintReview } from "../../src/blueprint/review.mjs";
import { readJsonFile, writeJsonFile } from "../../src/io/json.mjs";

export async function approveRun(runDir, {
  reviewedBy = "operator:test",
  now = new Date("2026-05-06T00:00:00.000Z")
} = {}) {
  const seed = await seedBlueprintReview({ runDir, now });
  if (!seed.ok) {
    throw new Error(seed.errors.map((error) => `${error.code}: ${error.reason}`).join("\n"));
  }
  const approval = await decideBlueprintReview({
    runDir,
    status: "approved",
    reviewedBy,
    reviewSource: "makeitreal:plan approve",
    env: {},
    now
  });
  if (!approval.ok) {
    throw new Error(approval.errors.map((error) => `${error.code}: ${error.reason}`).join("\n"));
  }
  return approval;
}

export async function materializeBoardRunPacket(boardDir) {
  const board = await readJsonFile(path.join(boardDir, "board.json"));
  for (const workItem of board.workItems ?? []) {
    await writeJsonFile(path.join(boardDir, "work-items", `${workItem.id}.json`), {
      schemaVersion: "1.0",
      prdId: "prd.auth-kanban",
      ...workItem
    });
  }
  await writeJsonFile(path.join(boardDir, "contracts", "auth-login.openapi.json"), {
    openapi: "3.1.0",
    info: {
      title: "Auth Login Contract",
      version: "0.1.0"
    },
    paths: {
      "/auth/login": {
        post: {
          operationId: "login",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    email: { type: "string" },
                    password: { type: "string" }
                  },
                  required: ["email", "password"]
                }
              }
            }
          },
          responses: {
            200: {
              description: "Successful login",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: true,
                    properties: {
                      token: { type: "string" }
                    },
                    required: ["token"]
                  }
                }
              }
            },
            401: {
              description: "Invalid credentials",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      error: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          code: { type: "string" },
                          message: { type: "string" }
                        },
                        required: ["code", "message"]
                      }
                    },
                    required: ["error"]
                  }
                }
              }
            }
          }
        }
      }
    }
  });
}

export async function approveBoard(boardDir, options = {}) {
  await materializeBoardRunPacket(boardDir);
  return approveRun(boardDir, options);
}
