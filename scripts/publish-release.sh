#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_REF:-}" != 'refs/heads/main' ]]; then
  echo 'Stable releases can only be published from main.' >&2
  exit 1
fi

: "${RELEASE_VERSION:?Missing validated RELEASE_VERSION}"
: "${GITHUB_SHA:?Missing workflow commit GITHUB_SHA}"

if [[ ! "$RELEASE_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo 'Stable release versions must use x.y.z format.' >&2
  exit 1
fi

for asset in main.js manifest.json styles.css release-notes.md; do
  if [[ ! -s "$asset" ]]; then
    echo "Missing or empty release file: $asset" >&2
    exit 1
  fi
done

commit="$(git rev-parse "${GITHUB_SHA}^{commit}")"
git fetch --tags origin

if git show-ref --verify --quiet "refs/tags/$RELEASE_VERSION"; then
  tagged_commit="$(git rev-parse "refs/tags/${RELEASE_VERSION}^{commit}")"
  if [[ "$tagged_commit" != "$commit" ]]; then
    echo "Tag $RELEASE_VERSION already belongs to another commit. Prepare a new release version." >&2
    exit 1
  fi
else
  git tag "$RELEASE_VERSION" "$commit"
fi

# Pushing the exact ref without force rejects concurrent conflicting tags.
git push origin "refs/tags/$RELEASE_VERSION"

# An existing tag on this commit is safe when retrying a failed release.
# Existing releases are never overwritten; gh reports them as an error.
gh release create "$RELEASE_VERSION" \
  --verify-tag \
  --title="$RELEASE_VERSION" \
  --notes-file=release-notes.md \
  main.js manifest.json styles.css
