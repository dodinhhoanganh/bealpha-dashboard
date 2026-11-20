# BeAlpha organization and account model

Target use case, updated 2026-09-09 from user clarification. This is the intended model, not a claim that current code implements every rule. Latest clarification supersedes the earlier depth-based and one-person Artist assumptions.

## Less is more

One platform, one organization-management flow, existing role presets. No department module, custom permission builder, duplicated dashboards, or dummy intermediary organizations without a demonstrated need.

## Business units and creation

SUPER_ADMIN remains separate: exactly one platform-owner account. BeAlpha operations manages customer units.

| Managing unit | May create and invite managers for |
|---|---|
| BeAlpha | Distributor, Label, Artist |
| Distributor | Label, Artist |
| Label | Artist |
| Artist | No child business units |

- Business tier is semantic, not tree depth. A Label directly under BeAlpha is still a Label, never a Distributor.
- A creator must have management permission over the selected parent; lower tier alone never grants access to another branch or tenant.
- Same-tier creation, ancestor creation, cycles, and inactive-parent creation are rejected server-side.
- Actual parent relationships govern management scope. Skipping a tier never creates a fake ancestor.
- Catalog Label/Artist records remain metadata. A business Label/Artist unit is separate; metadata assignment never creates a login, membership, or authority.

## People and access

- Business unit, person, membership, job title, and role are distinct.
- Each business unit can have multiple members with individual logins. Artist cannot create child business units; that does not prohibit inviting authorized staff to its own unit.
- Job titles are free text: CEO, co-CEO, director, deputy director, producer, manager. Titles grant no permissions.
- Keep role presets: OWNER, ADMIN, REVIEWER, ACCOUNTANT, MEMBER. Role controls actions; tenant, branch, and explicit grants control data scope independently.
- Invite the initial owner, then authorized managers invite staff. Keep last-owner protection and prevent privilege escalation.
- Do not create a sub-business just to give an accountant or reviewer access. Do not impose a one-email cap on an organization or Artist business team.
- Artist metadata without a managed business workspace still needs no account.

## Tenant and white-label — minimal proposed implementation

- The first customer business unit directly under BeAlpha owns the tenant, whether Distributor, Label, or Artist. Descendants inherit that tenant; skipping a tier does not merge unrelated customers.
- Tenant isolation and branch isolation both apply. A shared ancestor is not permission to read a sibling's unreleased catalog, media, statements, or exports.
- Explicit catalog grants narrow access; metadata relationships alone never widen it. Finance and analytics obey the same authorized scope.
- One brand configuration per root tenant; descendants inherit. Brand is separate from business tier and membership.
- White-label uses verified domain, name, logo, semantic colors and support details. No arbitrary HTML/CSS/JS. DNS verification is not proof of TLS or edge readiness.
- Branding never changes DDEX sender identity, DPID, VEVO partnership, delivery credentials, or revenue ownership.

## Release workflow — proposed routing

- Draft belongs to an actual business unit. An authorized organizational reviewer approves its own work or submissions from its managed scope; Artist sends to its actual managing parent.
- Direct Artist under BeAlpha goes to BeAlpha review; no nonexistent Label/Distributor queue.
- Avoid redundant approval levels solely to mirror tree depth. Preserve BeAlpha QC and SUPER_ADMIN dispatch authority; changing existing review routing requires regression coverage.
- Rejection includes a reason and returns editable work to its owner. Approved, packaged, sent, ingested, and live are different evidence-backed states.

## Known implementation drift — work remains

- Catalog businessLevel currently derives from allowed entity-type paths; it cannot distinguish direct Label from Distributor or support all skip-tier cases.
- Identity SUB_ACCOUNT currently enforces OWNER-only and a single membership. Do not equate that implementation with the new Artist business unit.
- Auth claims/projections, catalogs, grants, review queues, white-label tenant lookup and UI options must evolve together. Do not broaden one guard without matching data scoping.
- Existing records need explicit backfill rules and an invalid-chain report. No blind reparenting, tenant merging, role expansion, or automatic deletion.
- Visual design documents and older repository guidance still contain superseded terminology; use this target model when planning their revision.

## Acceptance gates

1. All allowed creation pairs above succeed with authorized actors; same/higher tiers fail.
2. Direct Label and Artist retain their semantic tier through reload, invite, login and projections.
3. Multiple members work in one unit; accountant cannot review/dispatch; job-title changes do not change permissions.
4. Cross-tenant and sibling IDs fail for catalog, media, finance, analytics, invitation and export APIs.
5. Revoked memberships/grants stop access; no stale browser or domain cache restores it.
6. Skip-tier releases reach the real reviewer; no stuck or phantom approval queues.
7. Two white-label domains retain separate branding and data; token A on domain B fails.
8. Existing valid data retains IDs, ownership, scope and media links after migration.

Sources: user requirements in this thread; research/2026-09-08-distribution-operating-model.md and research/2026-09-08-white-label.md. Product hierarchy is BeAlpha's choice, not a universal music-industry standard.