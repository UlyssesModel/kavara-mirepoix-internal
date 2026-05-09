# Kavara-Mirepoix Internal

The Kavara-confidential half of the Kavara-Mirepoix distribution. **Not for external distribution.**

## What this repository is

This repository hosts the `internal`-tagged extensions, skills, and configurations of the Kavara-Mirepoix distribution. Per [ADR-007](https://github.com/UlyssesModel/kavara-mirepoix/blob/main/docs/adrs/ADR-007-layered-distribution-and-license-tagging.md), Kavara-Mirepoix is split across two physical repositories:

The public surface lives at [`UlyssesModel/kavara-mirepoix`](https://github.com/UlyssesModel/kavara-mirepoix) and contains only `public`-tagged extensions, the public bundle manifest, and the architectural planning artifacts. Anything that has been deliberately promoted for external visibility lands there.

This repository — the private surface — contains the rest. The KServe-on-OCP provider that knows about Kavara's own model infrastructure. The Tiberius / Uhura / Kirk connectors. The substrate-matrix-aware skills for GCP Kata-VM and Azure TDX postures. The customer-deployment runbooks (templated; per-customer specifics live in their own Customer-X-Mirepoix repositories). The agent-team configurations that mirror Kavara's actual roles. The architecture-review meta-agent's domain-expert sub-agents tuned for Kavara-internal review patterns. Anything that encodes Kavara IP that we have not deliberately chosen to release.

The two repositories compose at build time. Kavara engineers running Mirepoix locally compose their working bundle from both. The bundler refuses to publish a bundle that mixes the wrong distribution tags into the wrong target, so the physical separation between the two repos is an additional defense on top of the build-time tag enforcement.

## Repository visibility

This repository **must be private** before any actual `internal`-tagged extension lands. The default for every extension authored here is `internal`, and the `internal` tag's contract is that the code is Kavara-confidential. A public repository named `kavara-mirepoix-internal` containing `internal` extensions defeats the architectural purpose of the tag.

If you are reading this and the repository is currently visible to anyone outside Kavara, the visibility should be flipped to private immediately. The repository may have been created with public default visibility for bootstrap convenience while empty; that window closes the moment any actual extension lands.

## Distribution tags in this repository

Every extension in this repository declares its distribution tag in `package.json` under `mirepoix.distribution` (or in a sibling `mirepoix-extension.json` for path-loaded extensions). Two tags are valid here:

`internal` is the default. Kavara-confidential. Never publishable to public NPM. Loadable only from this repository or from a path reference under a Kavara-internal checkout. The bundler refuses to include `internal`-tagged extensions in any bundle destined for a public registry or for unsigned customer distribution.

`customer-licensed` is for extensions that are intended to ship as part of a Kavara MaaS deliverable to a specific customer or class of customers, under Kavara's commercial license terms. They are bundled into customer-deliverable artifacts (signed appliance bundles, per ADR-005's session-log integrity model) but not into public NPM publications.

There is no `public` tag in this repository. Extensions promoted to `public` move physically to the public Kavara-Mirepoix repo via a manifest change, a commit, and a review. Promotion is an explicit governance act, never a default.

## Layout

The repository follows the same workspace structure as the public Kavara-Mirepoix monorepo:

```
extensions/        # one workspace package per internal extension
skills/            # internal Kavara-flavored skills (markdown)
presets/           # autonomy-preset definitions referencing internal extensions
bundles/           # bundle manifests for internal use (Kavara-engineer working bundles)
```

New extensions land under `extensions/<name>/` with their own `package.json` carrying `mirepoix.distribution: "internal"` (or `"customer-licensed"` if intended for a customer deliverable). The CI validates that no extension in this repo carries the `public` tag — those belong in the public repo.

## License

All content in this repository is the proprietary work of Kavara. All rights reserved. See [`LICENSE`](LICENSE) for the full notice.

## Access

Repository access is controlled by GitHub team membership under the `UlyssesModel` organization. If you are a Kavara engineer and you do not have access, file a request with the repository administrator. Customer-licensed bundles built from this repository are distributed as compiled artifacts under per-customer license terms; customers do not receive source access to this repository.

## Background

For the architectural framing — the three-layer Mirepoix model, the Software 3.0 OS distribution thesis, the implementation plan, and the full ADR set — see the documentation in the public [`UlyssesModel/kavara-mirepoix`](https://github.com/UlyssesModel/kavara-mirepoix) repository.
