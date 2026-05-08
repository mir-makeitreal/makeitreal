import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDesignPack } from "../src/domain/design-pack.mjs";
import { readJsonFile } from "../src/io/json.mjs";

const designPackPath = new URL("../examples/canonical/.makeitreal/runs/feature-auth/design-pack.json", import.meta.url);

test("valid canonical design pack passes", async () => {
  const designPack = await readJsonFile(designPackPath);
  assert.deepEqual(validateDesignPack(designPack), { ok: true, errors: [] });
});

test("canonical sections are required", async () => {
  const designPack = await readJsonFile(designPackPath);
  for (const key of ["architecture", "stateFlow", "apiSpecs", "responsibilityBoundaries", "moduleInterfaces", "callStacks", "sequences"]) {
    const broken = { ...designPack };
    delete broken[key];
    const result = validateDesignPack(broken);
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "HARNESS_DESIGN_PACK_INVALID");
    assert.match(result.errors[0].reason, new RegExp(key));
  }
});

test("non-API work must explicitly declare apiSpecs kind none with reason", async () => {
  const designPack = await readJsonFile(designPackPath);
  const result = validateDesignPack({ ...designPack, apiSpecs: [{ kind: "none" }] });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].reason, /reason/);
});

test("module interfaces require public IO signatures", async () => {
  const designPack = await readJsonFile(designPackPath);
  const broken = {
    ...designPack,
    moduleInterfaces: [
      {
        ...designPack.moduleInterfaces[0],
        publicSurfaces: [
          {
            ...designPack.moduleInterfaces[0].publicSurfaces[0],
            signature: {
              inputs: [],
              outputs: [],
              errors: []
            }
          }
        ]
      }
    ]
  };
  const result = validateDesignPack(broken);
  assert.equal(result.ok, false);
  assert.equal(result.errors.filter((error) => /signature\.(inputs|outputs|errors)/.test(error.reason)).length, 3);
});

test("module interfaces require declared contract IDs for public surfaces", async () => {
  const designPack = await readJsonFile(designPackPath);
  const broken = {
    ...designPack,
    moduleInterfaces: [
      {
        ...designPack.moduleInterfaces[0],
        publicSurfaces: [
          {
            ...designPack.moduleInterfaces[0].publicSurfaces[0],
            contractIds: []
          }
        ]
      }
    ]
  };
  const result = validateDesignPack(broken);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].reason, /contractIds/);
});

test("architecture edges must reference declared contracts", async () => {
  const designPack = await readJsonFile(designPackPath);
  const broken = {
    ...designPack,
    architecture: {
      ...designPack.architecture,
      edges: [{ from: "auth-ui", to: "auth-service", contractId: "contract.missing" }]
    }
  };
  const result = validateDesignPack(broken);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "HARNESS_CONTRACT_REFERENCE_INVALID");
});
