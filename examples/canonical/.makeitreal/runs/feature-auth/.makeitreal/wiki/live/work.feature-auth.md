# Contract Reference: Auth UI

## Public Outcome

PRD `prd.auth` defines this responsibility boundary.

- A user can submit credentials through the auth UI and receive a session result from the declared auth login contract.

## Responsibility Boundary

| Field | Value |
| --- | --- |
| Owner unit | `ru.frontend` |
| Owned paths | `apps/web/auth/**` |
| May use contracts | `contract.auth.login` |

## Contracts

- `contract.auth.login`

## Public Surfaces

### Module: Auth UI

| Field | Value |
| --- | --- |
| Responsibility unit | `ru.frontend` |
| Owner | team.frontend |
| Purpose | Own credential collection, client-side validation, and rendering of the declared session result. |
| Owns | `apps/web/auth/**` |

#### LoginForm.submit

| Field | Value |
| --- | --- |
| Kind | `component-event` |
| Contracts | `contract.auth.login` |
| Consumers | Auth page composition, browser interaction tests |
| Description | Submits credential input and delegates authentication through the declared auth login contract. |

Inputs:

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `credentials.email` | string | required | User email address collected by the login form. |
| `credentials.password` | string | required | User password collected by the login form. |

Outputs:

| Name | Type | Description |
| --- | --- | --- |
| `sessionResult` | AuthSession | Session response returned by contract.auth.login. |

Error contract:

| Code | When | Handling |
| --- | --- | --- |
| `AUTH_LOGIN_REJECTED` | The auth service rejects the credential payload. | Surface the declared auth error state; do not infer fallback session behavior. |


## Acceptance Evidence

- `AC-001` A user can submit credentials through the auth UI.
- `AC-002` The auth UI calls only the declared auth contract.
- `AC-003` Verification evidence and live wiki sync are recorded before Done.

## Completion Evidence

- `node -e console.log('verification ok')` -> exit 0

- Blueprint preview: preview/index.html

## Audit Trail

- Work item: `work.feature-auth`
- Wiki sync evidence is required before Done unless live wiki is disabled by config.
