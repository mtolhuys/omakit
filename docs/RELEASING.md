# Releasing omakit

A push to `main` runs CI. Publishing is deliberate: update `package.json` to a
new version, add release notes at `docs/releases/<version>.md`, commit it on
`main`, and push the matching `v<version>` tag. The notes are included before
the archive checksums in the GitHub Release. Never
reuse a version or move a release tag. For example, after a version bump and
commit have passed the checks:

```bash
git push origin main
git tag v0.1.2
git push origin v0.1.2
```

Use the next unused version for subsequent releases. The tag must match the
package version and its commit must be on `main`. The release workflow verifies
the marketplace pin, runs the tests, checks the packaged file list and size,
publishes the exact tarball, checks its integrity on npm, and creates the GitHub
Release. A failure stops the release; it never reports missing authentication as
a successful skip. An existing npm version is accepted only if its bytes match.

Unreleased work goes under the next unused version in `CHANGELOG.md`, with
the package version unchanged. The next section after 0.5.0 is 0.5.1
(unreleased). Move the notes into `docs/releases/<version>.md` and bump the
package only when deliberately preparing that release; an unreleased
changelog entry does not publish anything.

## Authentication

npm Trusted Publishing is configured for GitHub Actions, repository
`mtolhuys/omakit`, workflow `release.yml`, with no environment restriction and
`npm publish` allowed. The publish job uses `id-token: write` on a GitHub-hosted
runner with Node 24 and npm >=11.5.1. No npm token, local login, or interactive
authentication is needed for tag releases. Local credential files do not
participate. Do not add token-based authentication to this workflow.

## Checking and recovering a release

Watch the Release workflow in GitHub Actions. Its npm verification step must
succeed. The new version must also be visible with:

```bash
npm view omakit version dist.integrity --registry https://registry.npmjs.org
```

For a transient registry or runner failure, rerun only the failed jobs of the
same workflow run. It reuses the exact prepared artifacts, retained for one day.
If those artifacts have expired, investigate before rebuilding: a rebuilt
package may have different bytes. Never replace an existing npm version.

Authentication failures should be investigated in the trusted publisher settings:
check the repository owner, workflow filename, environment restriction, and direct
publish permission. Do not work around them with a stored token. Renaming the
repository or release workflow requires updating the npm trusted publisher.
