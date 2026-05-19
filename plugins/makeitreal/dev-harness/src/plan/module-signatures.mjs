import { humanizeIdentifier, pascalName } from "./heuristics.mjs";

export function surfaceNameFor({ usesOpenApi, slug, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return `${apiProfile.method.toUpperCase()} ${apiProfile.routePath}`;
  }
  if (componentProfile) {
    return `${componentProfile.componentName}.props`;
  }
  return moduleProfile?.surfaceName ?? `${slug}.execute`;
}

function apiModuleName(apiProfile, fallbackSlug) {
  const resource = String(apiProfile?.routePath ?? "")
    .split("/")
    .filter((part) => part && !/^v\d+$/i.test(part) && part.toLowerCase() !== "api")
    .filter((part) => !part.startsWith(":"))
    .at(-1);
  return `${humanizeIdentifier(resource || fallbackSlug)} API`;
}

export function moduleDisplayNameFor({ title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return apiModuleName(apiProfile, slug);
  }
  return componentProfile?.componentName ?? moduleProfile?.moduleName ?? title;
}

export function moduleSignatureFor({ contractId, owns, title, usesOpenApi, slug, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    return {
      inputs: [
        ...apiProfile.headers.map((header) => ({
          name: `header.${header}`,
          type: "string",
          required: true,
          description: `Required ${header} header declared by the OpenAPI contract.`
        })),
        ...(apiProfile.requestBodyRequired ? [{
          name: "requestBody",
          type: "object",
          required: true,
          fields: apiProfile.requestFields,
          description: `Payload accepted by ${apiProfile.method.toUpperCase()} ${apiProfile.routePath}.`
        }] : [{
          name: "requestContext",
          type: "http request context",
          required: true,
          description: `Declared request metadata accepted by ${apiProfile.method.toUpperCase()} ${apiProfile.routePath}; no JSON request body is allowed for this contract.`
        }])
      ],
      outputs: [
        {
          name: `${apiProfile.successStatus} response`,
          type: "object",
          description: "Successful response body defined by the OpenAPI contract."
        }
      ],
      errors: [
        ...apiProfile.errorStatuses.map((status) => ({
          code: `${status}.DECLARED_ERROR`,
          when: `The implementation returns the declared ${status} response.`,
          handling: "Return only the declared OpenAPI error shape; do not invent fallback response bodies."
        })),
        {
          code: "CONTRACT_MISMATCH",
          when: "The implementation needs an input, output, status, or dependency not declared in the OpenAPI contract.",
          handling: "Fail fast and revise the Blueprint contract before implementation; do not hide the mismatch with fallback behavior."
        }
      ]
    };
  }

  if (componentProfile) {
    return {
      inputs: componentProfile.props,
      outputs: [
        {
          name: "renderedStates",
          type: "component render contract",
          description: `Rendered states must cover: ${componentProfile.capabilities.join(", ")}.`
        },
        {
          name: "storybookCoverage",
          type: "visual review surface",
          description: "Storybook or equivalent preview exposes the declared component states for review."
        }
      ],
      errors: [
        {
          code: "COMPONENT_STATE_UNDECLARED",
          when: "Implementation needs a prop, state, event, or visual variant not declared by the Blueprint.",
          handling: "Fail fast and revise the component contract before implementation."
        },
        {
          code: "A11Y_CONTRACT_MISMATCH",
          when: "Keyboard, focus, or ARIA behavior cannot satisfy the declared accessibility contract.",
          handling: "Fail fast with the concrete accessibility mismatch; do not hide it behind visual-only tests."
        }
      ]
    };
  }

  return {
    inputs: moduleProfile?.inputs ?? [{
      name: "request",
      type: "declared input",
      required: true,
      description: `Input accepted by ${title}.`
    }],
    outputs: moduleProfile?.outputs ?? [{
      name: "result",
      type: "module result",
      description: `Consumers may rely on ${contractId} without reading implementation internals.`
    }],
    errors: moduleProfile?.errors ?? [{
      code: "BOUNDARY_CONTRACT_VIOLATION",
      when: "The work requires undeclared paths, undeclared cross-module imports, or behavior outside the Blueprint.",
      handling: "Fail fast and revise the Blueprint; do not add speculative fallback branches."
    }]
  };
}

export function moduleInterfaceFor({ responsibilityUnitId, owner, owns, contractId, title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  const surfaceName = surfaceNameFor({ usesOpenApi, slug, apiProfile, componentProfile, moduleProfile });
  const moduleName = moduleDisplayNameFor({ title, slug, usesOpenApi, apiProfile, componentProfile, moduleProfile });
  return {
    responsibilityUnitId,
    owner,
    moduleName,
    purpose: usesOpenApi || componentProfile
      ? usesOpenApi
        ? `Own ${apiProfile.method.toUpperCase()} ${apiProfile.routePath} through declared paths, response statuses, and dependency contracts only.`
        : `Own delivery of "${title}" through declared paths and public surfaces only.`
      : moduleProfile?.purpose ?? `Own delivery of "${title}" through declared paths and public surfaces only.`,
    owns,
    publicSurfaces: [
      {
        name: surfaceName,
        kind: usesOpenApi ? "http" : componentProfile ? "component" : "module",
        description: usesOpenApi
          ? `HTTP contract surface for ${apiProfile.method.toUpperCase()} ${apiProfile.routePath}.`
          : componentProfile
            ? `Component contract surface for ${componentProfile.componentName}.`
            : `Module boundary surface for ${moduleName}.`,
        contractIds: [contractId],
        consumers: ["Declared downstream responsibility units and tests"],
        signature: moduleSignatureFor({ contractId, owns, title, usesOpenApi, slug, apiProfile, componentProfile, moduleProfile })
      }
    ],
    imports: apiProfile?.dependencies ?? []
  };
}

export function dependencyModuleInterfaceFor(dependency) {
  return {
    responsibilityUnitId: dependency.providerResponsibilityUnitId,
    owner: "external.provider",
    moduleName: dependency.surface,
    purpose: `Own the declared provider side of ${dependency.contractId}.`,
    owns: [`external contract surface: ${dependency.surface}`],
    publicSurfaces: [
      {
        name: dependency.surface,
        kind: "external-contract",
        description: dependency.allowedUse,
        contractIds: [dependency.contractId],
        consumers: ["implementation responsibility unit"],
        signature: {
          inputs: [
            {
              name: "declaredRequest",
              type: "contract input",
              required: true,
              description: `Input declared by ${dependency.contractId}.`
            }
          ],
          outputs: [
            {
              name: "declaredResult",
              type: "contract result",
              description: `Result declared by ${dependency.contractId}.`
            }
          ],
          errors: [
            {
              code: "DEPENDENCY_CONTRACT_MISMATCH",
              when: `The implementation needs behavior outside ${dependency.contractId}.`,
              handling: "Fail fast and revise the Blueprint; do not hide dependency mismatch behind fallback behavior."
            }
          ]
        }
      }
    ],
    imports: []
  };
}

export function callStacksFor({ moduleInterface, usesOpenApi, apiProfile, componentProfile, moduleProfile }) {
  if (usesOpenApi) {
    const calls = ["validate declared inputs"];
    for (const dependency of apiProfile.dependencies) {
      calls.push(`call ${dependency.surface} via ${dependency.contractId}`);
    }
    calls.push("execute owned responsibility unit");
    calls.push(`return ${apiProfile.successStatus} or declared errors ${apiProfile.errorStatuses.join(", ")}`);
    return [{ entrypoint: moduleInterface.publicSurfaces[0].name, calls }];
  }
  if (componentProfile) {
    return [{
      entrypoint: `${componentProfile.componentName}.props`,
      calls: [
        "validate declared props and controlled state",
        "render declared Storybook states",
        "apply keyboard map and ARIA checklist",
        "emit only declared callbacks"
      ]
    }];
  }
  return [
    { entrypoint: moduleInterface.publicSurfaces[0].name, calls: moduleProfile?.calls ?? ["validate declared inputs", "execute owned responsibility unit", "return declared outputs or fail fast"] }
  ];
}

export function sequencesFor({ workItemId, contractId, usesOpenApi, apiProfile, componentProfile }) {
  if (usesOpenApi) {
    const participants = ["Client", "Owned Service", ...apiProfile.dependencies.map((dependency) => dependency.surface)];
    const messages = [
      { from: "Client", to: "Owned Service", label: `${apiProfile.method.toUpperCase()} ${apiProfile.routePath}` },
      ...apiProfile.dependencies.map((dependency) => ({
        from: "Owned Service",
        to: dependency.surface,
        label: dependency.allowedUse
      })),
      { from: "Owned Service", to: "Client", label: `${apiProfile.successStatus} or ${apiProfile.errorStatuses.join("/")}` }
    ];
    return [{ title: `${apiProfile.method.toUpperCase()} ${apiProfile.routePath} contract sequence`, participants, messages }];
  }
  if (componentProfile) {
    return [{
      title: `${componentProfile.componentName} render and interaction sequence`,
      participants: ["Consumer", componentProfile.componentName, "Storybook/Tests"],
      messages: [
        { from: "Consumer", to: componentProfile.componentName, label: "pass declared props and controlled state" },
        { from: componentProfile.componentName, to: "Consumer", label: "render declared states and emit declared callbacks" },
        { from: "Storybook/Tests", to: componentProfile.componentName, label: "verify stories, ARIA checklist, keyboard map, and visual states" }
      ]
    }];
  }
  return [{
    title: "Plan to implementation handoff",
    participants: ["User", "Make It Real", "Implementation Responsibility Unit"],
    messages: [
      { from: "User", to: "Make It Real", label: "request planned work" },
      { from: "Make It Real", to: "Implementation Responsibility Unit", label: `assign ${workItemId} via ${contractId}` }
    ]
  }];
}
